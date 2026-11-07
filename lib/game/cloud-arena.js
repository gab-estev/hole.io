import {WORLD,MAPS,makePlayer,makeRoom,setInput,stepRoom,snapshot} from './engine.js';
const STALE_MS=10_000;
const empty=()=>({status:'empty',players:[]});
const resultView=room=>({...snapshot(room),winnerId:room.winnerId,reason:room.reason,saved:true,rematch:room.rematch||null});
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
async function write(storage,version,room){
 const current=await storage.get('arena-state');
 if((current?.version??0)!==version)return false;
 await storage.put('arena-state',{version:version+1,room});
 return true;
}
async function load(storage){
 let row=await storage.get('arena-state');
 if(!row){row={version:0,room:empty()};await storage.put('arena-state',row);}
 return row;
}
async function persistFinished(db,room){
 const duration=Math.max(0,Math.floor((room.endedAt-room.startedAt)/1000));
 const queries=[db.prepare('INSERT OR IGNORE INTO game_matches(id,map,reason,duration_seconds,ended_at,final_state) VALUES (?,?,?,?,?,?)').bind(room.id,room.map,room.reason,duration,room.endedAt,JSON.stringify(room))];
 for(const player of room.players){
  const result=room.winnerId===null?'draw':room.winnerId===player.userId?'win':'loss';
  queries.push(db.prepare('INSERT OR IGNORE INTO game_scores(match_id,user_id,score,radius,result) VALUES (?,?,?,?,?)').bind(room.id,player.userId,player.score,player.radius,result));
 }
 await db.batch(queries);
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
export async function arenaCommand(storage,db,user,connection,event,payload={},lastRoomId=null){
 if(!/^[a-f0-9-]{36}$/.test(connection||''))return {error:'Invalid connection.'};
 for(let retry=0;retry<8;retry++){
  const {version,room:original}=await load(storage),before=JSON.stringify(original),wasFinished=original.status==='finished',now=Date.now();
  let room=clean(original,now),error=null,me=room.players?.find(p=>p.userId===user.id&&p.socketId===connection);
  if(event==='match:join'){
   const map=payload?.map;
   if(typeof map!=='string'||!Object.hasOwn(MAPS,map))error='Choose a valid map.';
   else if(me&&['waiting','playing'].includes(room.status))error='You are already in the arena.';
   else if(room.players?.some(p=>p.userId===user.id)&&['waiting','playing'].includes(room.status))error='This account is already playing in another tab.';
   else if(room.status==='finished'&&room.rematch&&!room.rematch.acceptedAt)error='A rematch request is waiting for the winner.';
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
  }else if(event==='match:rematch-request'){
   if(!me||room.status!=='finished')error='There is no finished match to replay.';
   else if(room.winnerId===user.id)error='Only the losing player can request a rematch.';
   else if(room.winnerId===null)error='Either player can start a new round after a draw.';
   else if(room.rematch)error='A rematch has already been requested.';
   else room.rematch={requesterId:user.id,requestedAt:now,acceptedAt:null};
  }else if(event==='match:rematch-accept'){
   if(!me||room.status!=='finished')error='There is no finished match to replay.';
   else if(room.winnerId!==user.id)error='Only the winner can accept the rematch.';
   else if(!room.rematch||room.rematch.requesterId===user.id)error='There is no rematch request to accept.';
   else{
    const oldRoom=room;oldRoom.rematch.acceptedAt=now;
    const participants=oldRoom.players.map((player,index)=>{
     const fresh=makePlayer({id:player.userId,username:player.username,tokenHash:player.sessionHash},player.socketId,index);
     fresh.lastSeen=now;fresh.sessionHash=player.sessionHash;return fresh;
    });
    room=makeRoom(oldRoom.map,participants[0]);room.players.push(participants[1]);
    room.status='playing';room.startedAt=now;room.lastTick=now;room.deadline=now+120_000;
   }
  }else return {error:'Unknown arena command.'};
  advance(room,now);
  if(JSON.stringify(room)!==before){
   if(room.status==='finished'&&!wasFinished)await persistFinished(db,room);
   if(!await write(storage,version,room))continue;
  }
  const response=view(room,user,connection);
  if(lastRoomId&&room.id!==lastRoomId){
   const finished=await db.prepare('SELECT m.final_state FROM game_matches m JOIN game_scores s ON s.match_id=m.id WHERE m.id=? AND s.user_id=?').bind(lastRoomId,user.id).first();
   if(finished){const final=JSON.parse(finished.final_state);response.finished=resultView({...final,players:final.players.map(p=>{const {lastSeen,sessionHash,...safe}=p;return safe;})});}
  }
  return {...response,...(error?{error}:{}),ok:!error};
 }
 return {error:'The arena is busy. Try again.',retry:true};
}
export async function revokeArenaSession(storage,db,user){
 for(let attempt=0;attempt<8;attempt++){
  const {version,room}=await load(storage);
  const wasFinished=room.status==='finished';
  const me=room.players?.find(p=>p.userId===user.id&&p.sessionHash===user.tokenHash);
  if(!me||!['waiting','playing'].includes(room.status))return;
  let next=room;
  if(room.status==='waiting')next=empty();else finish(room,room.players.find(p=>p.userId!==user.id).userId,'opponent_left',Date.now());
  if(next.status==='finished'&&!wasFinished)await persistFinished(db,next);
  if(await write(storage,version,next))return;
 }
}




