import { hashPassword,verifyPassword,validateCredentials,getSession,newSession,sessionCookie,digest } from './cloud-auth.js';
import { arenaCommand,revokeArenaSession } from './cloud-arena.js';
const SITE='https://void-arena-online-ec26.morg63952.chatgpt.site';
const DUMMY='scrypt$0123456789abcdef0123456789abcdef$ca87996483d8d3c58cd1532b16178b9d9a2d986a1febe7404b8af335de4f01179b6b85e56d79b77a5a1cf53e7c5c993687161089f2e01f3d3e3394fed450fd3f';
const headers={
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'strict-origin-when-cross-origin',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
};
function json(data,status=200,extra={}){return Response.json(data,{status,headers:{...headers,...extra}});}
function goodOrigin(request){
 const actual=request.headers.get('origin');
 return actual===SITE||actual===new URL(request.url).origin;
}
async function body(request){
 if(Number(request.headers.get('content-length')||0)>8192)throw new Error('Invalid or oversized request.');
 const text=await request.text();if(text.length>8192)throw new Error('Invalid or oversized request.');
 try{return JSON.parse(text);}catch{throw new Error('Invalid JSON request.');}
}
async function limit(db,request){
 const now=Date.now(),window=Math.floor(now/900_000),ip=digest(request.headers.get('cf-connecting-ip')||'unknown');
 const count=await db.prepare('INSERT INTO game_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(ip+':'+window,now+900_000).first();
 return count.count<=30;
}
async function stats(db,id){
 return await db.prepare("SELECT COUNT(*) AS games,COALESCE(MAX(score),0) AS best,COALESCE(SUM(result='win'),0) AS wins FROM game_scores WHERE user_id=?").bind(id).first();
}
async function logout(request,db,user){
 if(user){await db.prepare('DELETE FROM game_sessions WHERE token_hash=?').bind(user.tokenHash).run();await revokeArenaSession(db,user);}
 return json({ok:true},200,{'Set-Cookie':sessionCookie(request)});
}
async function connectWebSocket(request,db,user){
 const connection=new URL(request.url).searchParams.get('connection');
 if(!/^[a-f0-9-]{36}$/.test(connection||''))return json({error:'Invalid connection.'},400);
 const pair=new WebSocketPair(),client=pair[0],server=pair[1];server.accept();
 let busy=false,closed=false,lastPacket=0;let chain=Promise.resolve();
 const send=value=>{try{if(!closed)server.send(JSON.stringify(value));}catch{}};
 server.addEventListener('message',event=>{
  if(typeof event.data!=='string'||event.data.length>4096){server.close(1009,'Message too large');return;}
  let packet;try{packet=JSON.parse(event.data);}catch{return;}
  if(packet.event==='ping:check'){send({ack:packet.id,data:{ok:true}});return;}
  if(!['sync','match:join','match:leave'].includes(packet.event))return;
  const now=Date.now();if(packet.event==='sync'&&(busy||now-lastPacket<35))return;lastPacket=now;
  chain=chain.then(async()=>{
   busy=true;
   try{
    const current=await getSession(request,db);
    if(!current){send({event:'session:expired'});server.close(4001,'Session expired');closed=true;return;}
    const result=await arenaCommand(db,current,connection,packet.event,packet.payload,packet.lastRoomId);
    send({ack:packet.id,data:result,view:result});
   }catch(error){console.error('Arena socket failure',error);send({ack:packet.id,error:'The arena is temporarily unavailable. Please reconnect.'});}
   finally{busy=false;}
  }).catch(error=>console.error('Socket handler failed',error));
 });
 server.addEventListener('close',()=>{
  closed=true;
  chain=chain.then(()=>arenaCommand(db,user,connection,'match:leave')).catch(error=>console.error('Socket cleanup failed',error));
 });
 server.addEventListener('error',()=>{closed=true;try{server.close(1011,'Connection interrupted');}catch{}});
 return new Response(null,{status:101,webSocket:client});
}
export async function gameRequest(request,env,landing,arenaHtml){
 const url=new URL(request.url),path=url.pathname;
 if(!['/','/game'].includes(path)&&!path.startsWith('/api/'))return null;
 const db=env.DB;if(!db)return json({error:'The cloud database is not configured.'},503);
 try{
  if(path==='/api/health')return json({ok:true,cloud:true,transport:'websocket-with-http-fallback'});
  const user=await getSession(request,db);
  if(path==='/')return user?Response.redirect(url.origin+'/game',302):new Response(landing,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
  if(path==='/game')return user?new Response(arenaHtml,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}}):Response.redirect(url.origin+'/',302);
  if(path==='/api/live'){
   if(request.headers.get('upgrade')?.toLowerCase()!=='websocket')return json({error:'WebSocket upgrade required.'},426);
   if(!goodOrigin(request))return json({error:'Invalid website origin.'},403);
   if(!user)return json({error:'Please sign in to play.'},401);
   return connectWebSocket(request,db,user);
  }
  if(request.method==='POST'&&!goodOrigin(request))return json({error:'This request must come from the game website.'},403);
  if(['/api/register','/api/login'].includes(path)&&request.method==='POST'){
   if(!await limit(db,request))return json({error:'Too many sign-in attempts. Try again in 15 minutes.'},429);
   const input=await body(request),error=validateCredentials(input);if(error)return json({error},400);
   const username=input.username.toLowerCase();
   let account=await db.prepare('SELECT * FROM game_users WHERE username=?').bind(username).first();
   if(path==='/api/register'){
    if(account)return json({error:'That username is already taken.'},409);
    const hash=await hashPassword(input.password);
    try{account=await db.prepare('INSERT INTO game_users(username,password_hash,created_at) VALUES (?,?,?) RETURNING id,username').bind(username,hash,Date.now()).first();}
    catch(error){const existing=await db.prepare('SELECT id FROM game_users WHERE username=?').bind(username).first();if(existing)return json({error:'That username is already taken.'},409);throw error;}
   }else{
    const valid=await verifyPassword(input.password,account?.password_hash||DUMMY);
    if(!account||!valid)return json({error:'Incorrect username or password.'},401);
   }
   if(user){await db.prepare('DELETE FROM game_sessions WHERE token_hash=?').bind(user.tokenHash).run();await revokeArenaSession(db,user);}
   const cookie=await newSession(request,db,account.id);
   return json({user:{id:account.id,username:account.username}},path==='/api/register'?201:200,{'Set-Cookie':cookie});
  }
  if(path==='/api/logout'&&request.method==='POST')return logout(request,db,user);
  if(!user)return json({error:'Please sign in to continue.'},401);
  if(path==='/api/me'&&request.method==='GET')return json({user:{id:user.id,username:user.username},stats:await stats(db,user.id)});
  if(path==='/api/history'&&request.method==='GET'){
   const history=await db.prepare('SELECT m.id,m.map,m.reason,m.duration_seconds,m.ended_at,s.score,s.radius,s.result FROM game_scores s JOIN game_matches m ON m.id=s.match_id WHERE s.user_id=? ORDER BY m.ended_at DESC,m.id DESC LIMIT 20').bind(user.id).all();
   return json({matches:history.results,stats:await stats(db,user.id)});
  }
  if(path==='/api/arena'&&request.method==='POST'){
   const packet=await body(request);
   if(packet.event==='ping:check')return json({ok:true});
   return json(await arenaCommand(db,user,packet.connection,packet.event,packet.payload,packet.lastRoomId));
  }
  return json({error:'Page not found.'},404);
 }catch(error){
  if(error.message?.startsWith('Invalid'))return json({error:error.message},400);
  console.error('Game request failed',error);
  return json({error:'The cloud service is temporarily unavailable. Please try again.'},500);
 }
}
