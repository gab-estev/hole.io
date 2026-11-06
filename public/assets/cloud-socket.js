// Live match state is carried exclusively over the native WebSocket connection.
export class CloudSocket {
 constructor(){
  this.handlers=new Map();this.pending=new Map();this.connection=crypto.randomUUID();this.counter=0;
  this.connected=false;this.running=false;this.input={x:0,y:0};
  this.lastRoomId=null;this.startedId=null;this.resultId=null;this.waitingId=null;this.rematchKey=null;
  this.active=false;this.rematchWatch=false;this.lastSync=0;this.inflight=false;this.retryTimer=null;
  this.volatile={emit:(event,payload)=>this.emit(event,payload)};
 }
 on(name,fn){if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push(fn);return this;}
 fire(name,data){for(const fn of this.handlers.get(name)||[])fn(data);}
 timeout(ms){return {emit:(event,payload,callback)=>{if(typeof payload==='function'){callback=payload;payload={};}this.send(event,payload||{},callback,ms);}};}
 emit(event,payload,callback){
  if(event==='input'){this.input=payload;return this;}
  if(typeof payload==='function'){callback=payload;payload={};}
  this.send(event,payload||{},callback,5000);return this;
 }
 handleRematch(match){
  if(!match)return;
  const rematch=match.rematch||null;
  const key=rematch?`${match.id}:${rematch.requesterId}:${rematch.acceptedAt||''}`:null;
  if(key===this.rematchKey)return;
  this.rematchKey=key;
  this.fire('match:rematch-state',{matchId:match.id,rematch});
 }
 handle(view){
  if(!view)return;
  if('lobby' in view)this.fire('lobby',view.lobby);
  const ended=view.finished||(view.match?.status==='finished'?view.match:null);
  if(ended)this.handleRematch(ended);
  if(ended&&ended.id!==this.resultId){
   this.resultId=ended.id;this.active=false;this.rematchWatch=true;this.lastRoomId=null;this.startedId=null;this.waitingId=null;
   this.fire('match:ended',ended);
  }
  const m=view.match;
  if(!m)return;
  this.handleRematch(m);
  if(m.status==='finished')return;
  this.lastRoomId=m.id;this.active=true;this.rematchWatch=false;
  if(m.status==='waiting'&&this.waitingId!==m.id){this.waitingId=m.id;this.fire('match:waiting',m);}
  if(m.status==='playing'){
   if(this.startedId!==m.id){this.startedId=m.id;this.fire('match:start',m);}
   else this.fire('state',m);
  }
 }
 connect(){
  if(this.running)return;this.running=true;this.connectWebSocket();
  this.timer=setInterval(()=>{if(!this.connected)return;const now=performance.now();if(now-this.lastSync<(this.active||this.rematchWatch?50:1000))return;this.lastSync=now;this.send('sync',{input:this.input});},25);
 }
 connectWebSocket(){
  if(!this.running)return;
  const protocol=location.protocol==='https:'?'wss:':'ws:';
  try{this.ws=new WebSocket(protocol+'//'+location.host+'/api/live?connection='+this.connection);}
  catch(error){this.fire('connect_error',new Error('WebSocket connection is unavailable. Check your connection and reload the game.'));this.scheduleRetry();return;}
  this.ws.onopen=()=>{this.connected=true;this.fire('connect');this.send('sync',{});};
  this.ws.onmessage=event=>{
   let packet;try{packet=JSON.parse(event.data);}catch{return;}
   if(packet.event)this.fire(packet.event);
   if(packet.ack){const task=this.pending.get(packet.ack);if(task){clearTimeout(task.timer);this.pending.delete(packet.ack);task.callback?.(packet.error?new Error(packet.error):null,packet.data);}}
   this.handle(packet.view);
  };
  this.ws.onerror=()=>{};
  this.ws.onclose=()=>{if(this.running)this.drop('transport close');};
 }
 send(event,payload={},callback,timeout=5000){
  if(!this.connected){callback?.(new Error('Not connected.'));return;}
  if(event==='sync'&&this.inflight)return;
  if(this.ws?.readyState!==WebSocket.OPEN)return;
  const id=String(++this.counter);if(event==='sync')this.inflight=true;
  const timer=setTimeout(()=>{this.pending.delete(id);if(event==='sync')this.inflight=false;callback?.(new Error('Request timed out.'));},timeout);
  this.pending.set(id,{timer,callback:(error,result)=>{if(event==='sync')this.inflight=false;callback?.(error,result);}});
  this.ws.send(JSON.stringify({id,event,payload,lastRoomId:this.lastRoomId}));
 }
 scheduleRetry(){
  if(this.running)this.retryTimer=setTimeout(()=>{this.connection=crypto.randomUUID();this.lastRoomId=null;this.startedId=null;this.waitingId=null;this.rematchKey=null;this.connectWebSocket();},1500);
 }
 drop(reason){
  const wasConnected=this.connected;this.connected=false;this.active=false;
  for(const task of this.pending.values()){clearTimeout(task.timer);task.callback?.(new Error('Connection closed.'));}
  this.pending.clear();this.inflight=false;
  if(wasConnected)this.fire('disconnect',reason);
  this.scheduleRetry();
 }
 disconnect(){
  if(!this.running)return;this.running=false;clearInterval(this.timer);clearTimeout(this.retryTimer);
  if(this.ws){this.ws.onclose=null;this.ws.close();}
  this.drop('io client disconnect');
 }
}


