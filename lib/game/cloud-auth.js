import { randomBytes, scrypt as rawScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt=promisify(rawScrypt);
const params={N:32768,r:8,p:1,maxmem:64*1024*1024};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const SESSION_MS=7*24*60*60*1000;
export const isLocal=request=>['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
const cookieName=request=>isLocal(request)?'void_session':'__Host-void_session';
export async function hashPassword(password,salt=randomBytes(16).toString('hex')){
 const key=Buffer.from(await scrypt(password,salt,64,params)).toString('hex');
 return 'scrypt$'+salt+'$'+key;
}
export async function verifyPassword(password,hash){
 const [,salt,hex]=hash.split('$');
 const actual=Buffer.from(await scrypt(password,salt,64,params)),expected=Buffer.from(hex,'hex');
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export function validateCredentials(body){
 if(!body||typeof body.username!=='string'||typeof body.password!=='string')return 'Enter a username and password.';
 if(!/^[a-zA-Z0-9_]{3,20}$/.test(body.username))return 'Use 3–20 letters, numbers, or underscores.';
 if(body.password.length<10||body.password.length>128)return 'Use a password between 10 and 128 characters.';
 return null;
}
export function tokenFrom(request){
 const name=cookieName(request);
 const part=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
 const token=part?.slice(name.length+1);
 return token&&/^[a-f0-9]{64}$/.test(token)?token:null;
}
export async function getSession(request,db){
 const token=tokenFrom(request);if(!token)return null;
 const tokenHash=digest(token);
 const user=await db.prepare('SELECT u.id,u.username,s.expires_at FROM game_sessions s JOIN game_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(tokenHash,Date.now()).first();
 return user?{...user,tokenHash}:null;
}
export function sessionCookie(request,token='',maxAge=SESSION_MS/1000){
 return cookieName(request)+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(token?maxAge:0)+(isLocal(request)?'':'; Secure');
}
export async function newSession(request,db,id){
 const token=randomBytes(32).toString('hex');
 await db.prepare('INSERT INTO game_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').bind(digest(token),id,Date.now()+SESSION_MS).run();
 return sessionCookie(request,token);
}
