import {randomBytes, scrypt, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {db} from './db.js';
const derive=promisify(scrypt);
export const roles=['ADMIN','MANAGER','AGENT'];
export function validUser({name,email,password,role}) {
 return typeof name==='string' && name.trim().length>0 && name.length<=120 && typeof email==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length<=254 && typeof password==='string' && password.length>=12 && password.length<=128 && roles.includes(role);
}
export async function hashPassword(password) {const salt=randomBytes(16).toString('hex');return salt+':'+(await derive(password,salt,64)).toString('hex');}
export async function verifyPassword(password,hash) {const [salt,value]=hash.split(':');const expected=Buffer.from(value,'hex'), actual=await derive(password,salt,64);return actual.length===expected.length && timingSafeEqual(actual,expected);}
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function authenticate(req,res,next) {
 const token=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('ops_session='))?.slice(12);
 if(!token) return res.status(401).json({error:'Please log in.'});
 const [rows]=await db.execute('SELECT u.id,u.name,u.email,u.role,u.team_id,u.must_change_password FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.active=1',[digest(token)]);
 if(!rows.length) return res.status(401).json({error:'Your session has expired. Please log in.'});
 req.user=rows[0];if(req.user.must_change_password && !['/auth/me','/auth/password','/auth/logout'].includes(req.path))return res.status(403).json({error:'Change your temporary password to continue.',code:'PASSWORD_CHANGE_REQUIRED'});next();
}
export const permit=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:'You do not have permission for this action.'});
export async function login(req,res) {
 const {email,password}=req.body;
 if(typeof email!=='string'||typeof password!=='string'||password.length>128) return res.status(400).json({error:'Enter your email and password.'});
 const [rows]=await db.execute('SELECT * FROM users WHERE email=? AND active=1',[email.trim().toLowerCase()]);
 // Run the same password operation for unknown accounts to avoid a quick account-discovery path.
 const fallback='00'.repeat(16)+':'+ '00'.repeat(64);
 const valid=await verifyPassword(password,rows[0]?.password_hash || fallback);
 if(!valid || !rows.length) return res.status(401).json({error:'Invalid email or password.'});
 const token=randomBytes(32).toString('hex');
 await db.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 8 HOUR))',[digest(token),rows[0].id]);
 res.cookie('ops_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000,path:'/'});
 const {id,name,role,must_change_password}=rows[0];res.json({id,name,email:rows[0].email,role,must_change_password});
}
export async function logout(req,res) {
 const token=req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('ops_session='))?.slice(12);
 if(token) await db.execute('DELETE FROM sessions WHERE token_hash=?',[digest(token)]);
 res.clearCookie('ops_session',{path:'/'});res.json({loggedOut:true});
}
