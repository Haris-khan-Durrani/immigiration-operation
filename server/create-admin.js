import {db} from './db.js';
import {hashPassword,validUser} from './auth.js';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
const user={name:process.env.INITIAL_ADMIN_NAME || 'Administrator',email:process.env.INITIAL_ADMIN_EMAIL,password:process.env.INITIAL_ADMIN_PASSWORD,role:'ADMIN'};
try {
 const [rows]=await db.query('SELECT id FROM users WHERE role="ADMIN"');
 if(rows.length) throw new Error('An administrator already exists. Use Users in the application to add accounts.');
 if(!validUser(user)&&process.stdin.isTTY){let muted=false;const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});const rl=createInterface({input:process.stdin,output,terminal:true});try{user.name=(await rl.question('Administrator name: ')).trim() || 'Administrator';user.email=(await rl.question('Email: ')).trim();const question=rl.question('Password (12–128 characters, hidden): ');muted=true;user.password=await question;muted=false;process.stdout.write('\n');}finally{rl.close();}}
 if(!validUser(user)) throw new Error('Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD (12–128 characters) in .env, or run this command in an interactive terminal.');
 await db.execute('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)',[user.name,user.email.trim().toLowerCase(),await hashPassword(user.password),user.role]);
 console.log('Administrator created. Remove INITIAL_ADMIN_PASSWORD from .env.');
} finally {await db.end();}
