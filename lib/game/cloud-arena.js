import {WORLD,MAPS,makePlayer,makeRoom,setInput,stepRoom,snapshot} from './engine.js';
const STALE_MS=10_000;
const empty=()=>({status:'empty',players:[]});
const resultView=room=>({...snapshot(room),winnerId:room.winnerId,reason:room.reason,saved:true});
function finish(room,winnerId,reason,now){
 room.status='finished';room.winnerId=winnerId;room.reason=reason;room.endedAt=now;
}
function clean(room,now){
 if(!['waiting','playing'].includes(room.status))return room;
 const stale=room.players.filter(p=>now-(p.lastSeen||0)>STALE_MS);
 if(stale.length){
  if(room.status==='waiting')return empty();
  const alive=room.players.filter(p=>!stale.includes(p));
  finish(room,alive.length===1?alive[0].userId:null,'opponent_left',now);
 }
 return room;
}
function advance(room,now){
 if(room.status!=='playing')return;
 let delta=Math.min(.3,Math.max(0,(now-(room.lastTick||now))/1000));
 while(delta>0){
  const result=stepRoom(room,Math.min(delta,1/30),now);delta-=1/30;
  if(result){finish(room,result.winnerId,result.reason,now);break;}
 }
 room.lastTick=now;
}
async function write(db,version,room){
 const queries=[db.prepare('UPDATE game_arena SET version=version+1,state=? WHERE id=1 AND version=?').bind(JSON.stringify(room),version)];
 if(room.status==='finished'){
  // A losing proposal cannot write its result. Inserts derive from the committed CAS state.
  queries.push(db.prepare(`INSERT OR IGNORE INTO game_matches(id,map,reason,duration_seconds,ended_at,final_state)
   SELECT json_extract(state,'$.id'),json_extract(state,'$.map'),json_extract(state,'$.reason'),
   MAX(0,(json_extract(state,'$.endedAt')-json_extract(state,'$.startedAt'))/1000),json_extract(state,'$.endedAt'),state
   FROM game_arena WHERE id=1 AND version=? AND json_extract(state,'$.id')=? AND json_extract(state,'$.status')='finished'`).bind(version+1,room.id));
  queries.push(db.prepare(`INSERT OR IGNORE INTO game_scores(match_id,user_id,score,radius,result)
   SELECT m.id,json_extract(p.value,'$.userId'),json_extract(p.value,'$.score'),json_extract(p.value,'$.radius'),
   CASE WHEN json_extract(m.final_state,'$.winnerId') IS NULL THEN 'draw'
   WHEN json_extract(m.final_state,'$.winnerId')=json_extract(p.value,'$.userId') THEN 'win' ELSE 'loss' END
   FROM game_matches m,json_each(m.final_state,'$.players') p WHERE m.id=?`).bind(room.id));
 }
 const results=await db.batch(queries);return results[0].meta.changes===1;
}
async function load(db){
 let row=await db.prepare('SELECT version,state FROM game_arena WHERE id=1').first();
 if(!row){await db.prepare('INSERT OR IGNORE INTO game_arena(id,version,state) VALUES (1,0,?)').bind(JSON.stringify(empty())).run();row=await db.prepare('SELECT version,state FROM game_arena WHERE id=1').first();}
 return {version:row.version,room:JSON.parse(row.state)};
}
function view(room,user,connection){
 const joined=room.players?.some(p=>p.userId===user.id&&p.socketId===connection);
 const publicPlayer=p=>{const {lastSeen,sessionHash,...other}=p;return other;};
 const safeRoom={...room,players:room.players.map(publicPlayer)};
 return {
  lobby:['waiting','playing'].includes(room.status)?{map:room.map,players:room.players.length,status:room.status}:null,
  match:joined?room.status==='finished'?resultView(safeRoom):{...snapshot(safeRoom),world:WORLD,objects:room.objects,removed:room.removed}:null
 };
}
export async function arenaCommand(db,user,connection,event,payload={},lastRoomId=null){
 if(!/^[a-f0-9-]{36}$/.test(connection||''))return {error:'Invalid connection.'};
 for(let retry=0;retry<8;retry++){
  const {version,room:original}=await load(db),before=JSON.stringify(original),now=Date.now();
  let room=clean(original,now),error=null,me=room.players?.find(p=>p.userId===user.id&&p.socketId===connection);
  if(event==='match:join'){
   const map=payload?.map;
   if(typeof map!=='string'||!Object.hasOwn(MAPS,map))error='Choose a valid map.';
   else if(me&&['waiting','playing'].includes(room.status))error='You are already in the arena.';
   else if(room.players?.some(p=>p.userId===user.id)&&['waiting','playing'].includes(room.status))error='This account is already playing in another tab.';
   else if(room.status==='playing')error='The arena is full. Wait for this round to finish.';
   else if(room.status==='waiting'&&room.map!==map)error='A player is waiting in '+MAPS[room.map].label+'. Choose that map to join.';
   else{
    const p=makePlayer(user,connection,room.status==='waiting'?1:0);p.lastSeen=now;p.sessionHash=user.tokenHash;
    if(room.status!=='waiting')room=makeRoom(map,p);else room.players.push(p);
    if(room.players.length===2){room.status='playing';room.startedAt=now;room.lastTick=now;room.deadline=now+120_000;}
    me=p;
   }
  }else if(event==='match:leave'){
   if(me&&room.status==='waiting')room=empty();
   else if(me&&room.status==='playing')finish(room,room.players.find(p=>p.userId!==user.id).userId,'opponent_left',now);
  }else if(event==='sync'){
   if(me&&['waiting','playing'].includes(room.status)){me.lastSeen=now;if(payload?.input)setInput(me,payload.input,now);}
  }else return {error:'Unknown arena command.'};
  advance(room,now);
  if(JSON.stringify(room)!==before&&!await write(db,version,room))continue;
  const response=view(room,user,connection);
  if(lastRoomId&&room.id!==lastRoomId){
   const finished=await db.prepare('SELECT m.final_state FROM game_matches m JOIN game_scores s ON s.match_id=m.id WHERE m.id=? AND s.user_id=?').bind(lastRoomId,user.id).first();
   if(finished){const final=JSON.parse(finished.final_state);response.finished=resultView({...final,players:final.players.map(p=>{const {lastSeen,sessionHash,...safe}=p;return safe;})});}
  }
  return {...response,...(error?{error}:{}),ok:!error};
 }
 return {error:'The arena is busy. Try again.',retry:true};
}
export async function revokeArenaSession(db,user){
 for(let attempt=0;attempt<8;attempt++){
  const {version,room}=await load(db);
  const me=room.players?.find(p=>p.userId===user.id&&p.sessionHash===user.tokenHash);
  if(!me||!['waiting','playing'].includes(room.status))return;
  let next=room;
  if(room.status==='waiting')next=empty();else finish(room,room.players.find(p=>p.userId!==user.id).userId,'opponent_left',Date.now());
  if(await write(db,version,next))return;
 }
}
