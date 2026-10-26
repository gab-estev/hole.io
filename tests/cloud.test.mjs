import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {arenaCommand} from '../lib/game/cloud-arena.js';
import {gameRequest} from '../lib/game/cloud-api.js';
function database(){
 const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON;');raw.exec(readFileSync(new URL('../drizzle/0000_wooden_fixer.sql',import.meta.url),'utf8'));
 const wrap=stmt=>({bind(...values){return wrap(stmt.bind(...values));}});
 // D1-compatible facade with native SQLite and atomic batch writes.
 function prepare(sql,values=[]){return {bind(...next){return prepare(sql,next);},async first(){return raw.prepare(sql).get(...values)||null;},async all(){return {results:raw.prepare(sql).all(...values)};},async run(){return {meta:raw.prepare(sql).run(...values)};},_sql:sql,_values:values};}
 const db={prepare,async batch(statements){raw.exec('BEGIN');try{const results=statements.map(s=>({meta:raw.prepare(s._sql).run(...s._values)}));raw.exec('COMMIT');return results;}catch(e){raw.exec('ROLLBACK');throw e;}}};
 return {raw,db};
}
test('cloud authentication, access control and persistent session revocation',async()=>{
 const {raw,db}=database(),base='http://localhost:4174';
 async function call(path,body,cookie){const headers={Origin:base,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})};return gameRequest(new Request(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),{DB:db},'<html>login</html>','<html>game</html>');}
 assert.equal((await call('/api/me')).status,401);assert.equal((await call('/game')).status,302);
 const registered=await call('/api/register',{username:'Alpha',password:'cloud-password-alpha'});assert.equal(registered.status,201);
 const cookie=registered.headers.get('set-cookie').split(';')[0];assert.match(cookie,/^void_session=/);
 assert.equal((await call('/api/register',{username:'ALPHA',password:'cloud-password-alpha'})).status,409);
 assert.equal((await call('/api/me',null,cookie)).status,200);
 assert.equal((await call('/api/login',{username:'alpha',password:'wrong-password'})).status,401);
 const fake=new Request(base+'/api/logout',{method:'POST',headers:{Origin:'https://evil.example',Cookie:cookie}});assert.equal((await gameRequest(fake,{DB:db},'', '')).status,403);
 assert.equal((await call('/api/logout',{},cookie)).status,200);assert.equal((await call('/api/me',null,cookie)).status,401);raw.close();
});
test('two cloud players join across competing requests; capacity and map matching are enforced',async()=>{
 const {raw,db}=database();for(const [id,name] of [[1,'alpha'],[2,'bravo'],[3,'charlie']])raw.prepare('INSERT INTO game_users VALUES (?,?,?,?)').run(id,name,'test',0);
 const a={id:1,username:'alpha',tokenHash:'a'},b={id:2,username:'bravo',tokenHash:'b'},c={id:3,username:'charlie',tokenHash:'c'},ac=randomUUID(),bc=randomUUID(),cc=randomUUID();
 assert.equal((await arenaCommand(db,a,ac,'match:join',{map:{}})).ok,false);
 assert.equal((await arenaCommand(db,a,ac,'match:join',{map:'city'})).match.status,'waiting');
 assert.match((await arenaCommand(db,b,bc,'match:join',{map:'space'})).error,/City/);
 assert.match((await arenaCommand(db,a,randomUUID(),'match:join',{map:'city'})).error,/another tab/);
 const start=await arenaCommand(db,b,bc,'match:join',{map:'city'});assert.equal(start.match.players.length,2);
 assert.match((await arenaCommand(db,c,cc,'match:join',{map:'city'})).error,/full/);
 await new Promise(resolve=>setTimeout(resolve,40));
 const [one,two]=await Promise.all([arenaCommand(db,a,ac,'sync',{input:{x:1,y:0,score:999999,radius:99999}}),arenaCommand(db,b,bc,'sync',{input:{x:-1,y:0}})]);
 assert.equal(one.match.id,two.match.id);assert.ok(one.match.players[0].x>220);assert.ok(two.match.players[0].radius<=190);
 assert.ok(!JSON.stringify(one).includes('sessionHash'));assert.ok(!JSON.stringify(one).includes('socketId'));
 const ended=await arenaCommand(db,a,ac,'match:leave');assert.equal(ended.match.status,'finished');assert.equal(ended.match.winnerId,2);
 assert.equal(raw.prepare('SELECT COUNT(*) n FROM game_scores').get().n,2);
 // The winner receives the durable result even if the other player creates a rematch first.
 await arenaCommand(db,a,ac,'match:join',{map:'forest'});
 const oldResult=await arenaCommand(db,b,bc,'sync',{},start.match.id);assert.equal(oldResult.finished.id,start.match.id);
 assert.equal(oldResult.finished.winnerId,2);raw.close();
});
test('simultaneous entrants never create more than two slots',async()=>{
 const {raw,db}=database();const users=[1,2,3].map(id=>({id,username:'user'+id,tokenHash:'t'+id}));
 users.forEach(u=>raw.prepare('INSERT INTO game_users VALUES (?,?,?,?)').run(u.id,u.username,'test',0));
 const results=await Promise.all(users.map(u=>arenaCommand(db,u,randomUUID(),'match:join',{map:'space'})));
 const room=JSON.parse(raw.prepare('SELECT state FROM game_arena WHERE id=1').get().state);assert.equal(room.players.length,2);assert.equal(results.filter(r=>r.ok).length,2);raw.close();
});
