// The hosted edition uses native WebSockets and a same-origin HTTP fallback.
export class CloudSocket {
 constructor(){
  this.handlers=new Map();this.pending=new Map();this.connection=crypto.randomUUID();this.counter=0;
  this.connected=false;this.running=false;this.mode='websocket';this.input={x:0,y:0};
  this.lastRoomId=null;this.startedId=null;this.resultId=null;this.waitingId=null;
  this.active=false;this.lastSync=0;this.inflight=false;this.retryTimer=null;
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
 handle(view){
  if(!view)return;
  if('lobby' in view)this.fire('lobby',view.lobby);
  const ended=view.finished||(view.match?.status==='finished'?view.match:null);
  if(ended&&ended.id!==this.resultId){
   this.resultId=ended.id;this.active=false;this.lastRoomId=null;this.startedId=null;this.waitingId=null;
   this.fire('match:ended',ended);
  }
  const m=view.match;
  if(!m||m.status==='finished')return;
  this.lastRoomId=m.id;this.active=true;
  if(m.status==='waiting'&&this.waitingId!==m.id){this.waitingId=m.id;this.fire('match:waiting',m);}
  if(m.status==='playing'){
   if(this.startedId!==m.id){this.startedId=m.id;this.fire('match:start',m);}
   else this.fire('state',m);
  }
 }
 connect(){
  if(this.running)return;this.running=true;this.connectWebSocket();
  this.timer=setInterval(()=>{if(!this.connected)return;const now=performance.now();if(now-this.lastSync<(this.active?50:1000))return;this.lastSync=now;this.send('sync',{input:this.input});},50);
 }
 connectWebSocket(){
  const protocol=location.protocol==='https:'?'wss:':'ws:';
  this.mode='websocket';this.ws=new WebSocket(protocol+'//'+location.host+'/api/live?connection='+this.connection);
  let opened=false;
  const fallback=setTimeout(()=>{if(!opened&&this.running){this.ws.onclose=null;this.ws.close();this.connectHttp();}},3000);
  this.ws.onopen=()=>{opened=true;clearTimeout(fallback);this.connected=true;this.fire('connect');this.send('sync',{});};
  this.ws.onmessage=event=>{
   let packet;try{packet=JSON.parse(event.data);}catch{return;}
   if(packet.event)this.fire(packet.event);
   if(packet.ack){const task=this.pending.get(packet.ack);if(task){clearTimeout(task.timer);this.pending.delete(packet.ack);task.callback?.(packet.error?new Error(packet.error):null,packet.data);}}
   this.handle(packet.view);
  };
  this.ws.onerror=()=>{};
  this.ws.onclose=()=>{clearTimeout(fallback);if(!this.running)return;
   if(!opened){this.connectHttp();return;}
   this.drop('transport close');
  };
 }
 async connectHttp(){
  if(!this.running)return;this.mode='http';
  try{const view=await this.http('sync',{});this.connected=true;this.fire('connect');this.handle(view);}
  catch(error){this.fire('connect_error',error);this.retryTimer=setTimeout(()=>this.connectHttp(),2000);}
 }
 async http(event,payload){
  const res=await fetch('/api/arena',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({connection:this.connection,event,payload,lastRoomId:this.lastRoomId})});
  if(res.status===401){this.fire('session:expired');throw new Error('Please sign in to play.');}
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Connection failed.');return data;
 }
 send(event,payload={},callback,timeout=5000){
  if(!this.connected){callback?.(new Error('Not connected.'));return;}
  if(event==='sync'&&this.inflight)return;
  if(this.mode==='http'){
   if(event==='sync')this.inflight=true;
   this.http(event,payload).then(view=>{callback?.(null,view);this.handle(view);}).catch(error=>{callback?.(error);if(event==='sync')this.drop('transport close');}).finally(()=>{if(event==='sync')this.inflight=false;});
   return;
  }
  if(this.ws?.readyState!==WebSocket.OPEN)return;
  const id=String(++this.counter);if(event==='sync')this.inflight=true;
  const timer=setTimeout(()=>{this.pending.delete(id);if(event==='sync')this.inflight=false;callback?.(new Error('Request timed out.'));},timeout);
  this.pending.set(id,{timer,callback:(error,result)=>{if(event==='sync')this.inflight=false;callback?.(error,result);}});
  this.ws.send(JSON.stringify({id,event,payload,lastRoomId:this.lastRoomId}));
 }
 drop(reason){
  const wasConnected=this.connected;this.connected=false;this.active=false;
  for(const task of this.pending.values()){clearTimeout(task.timer);task.callback?.(new Error('Connection closed.'));}
  this.pending.clear();this.inflight=false;
  if(wasConnected)this.fire('disconnect',reason);
  if(this.running)this.retryTimer=setTimeout(()=>{this.connection=crypto.randomUUID();this.lastRoomId=null;this.startedId=null;this.waitingId=null;this.connectWebSocket();},1500);
 }
 disconnect(){
  if(!this.running)return;this.running=false;clearInterval(this.timer);clearTimeout(this.retryTimer);
  if(this.mode==='http'&&this.connected)fetch('/api/arena',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({connection:this.connection,event:'match:leave'})}).catch(()=>{});
  if(this.ws){this.ws.onclose=null;this.ws.close();}
  this.drop('io client disconnect');
 }
}
