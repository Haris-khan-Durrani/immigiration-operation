import {internalWorkRoutes} from './internal-work.js';
import {statusReminderRoutes} from './status-reminders.js';
import {emailTemplateRoutes} from './email-templates.js';
import {agreementTemplateRoutes} from './agreement-templates.js';
import {passwordResetRoutes} from './password-reset.js';
import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import {authenticate,permit,login,logout,hashPassword,validUser} from './auth.js';
import {fileURLToPath} from 'node:url';
import {db} from './db.js';
import {encrypt,decrypt} from './crypto.js';
import {routes} from './routes.js';
import {catalog} from './catalog.js';
import {publicRoutes,handoff} from './integrations.js';
import {fail,json} from './domain.js';
import {transaction} from './workflow.js';
import {runJobs} from './jobs.js';
import {emailRoutes} from './email-routes.js';
import {emailSettings} from './email.js';
import {connectionRoutes} from './connection-routes.js';
import {contractSecret} from './connection.js';
import {fileManagement} from './file-management.js';
import {configureProxy} from './proxy.js';
export const app=express();
configureProxy(app);
app.use(helmet());
app.use(express.json({limit:'256kb',verify(req,res,buffer){req.rawBody=buffer;}}));
app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
app.get(/^\/(?:login|reset-password|dashboard|new-clients|file-review|document-review|my-tasks|file-statuses|automations|team|settings|activity-log|notifications|account|categories(?:\/\d+)?|client-files(?:\/\d+(?:\/client-view)?(?:\/(?:overview|tracking|documents|information|internal|tasks|activity))?)?)\/?$/,(_req,res)=>{res.set('Cache-Control','no-store');res.sendFile(fileURLToPath(new URL('../public/index.html',import.meta.url)));});
app.use('/api',rateLimit({windowMs:60000,limit:180,message:{error:'Too many requests. Please wait a minute and try again.'}}));
app.post('/api/integrations/contracts/events',async(req,res,next)=>{try{await handoff(req,res);}catch(error){try{await db.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',['contract-manager','CONTRACT_WEBHOOK_REJECTED',JSON.stringify({message:error.status&&error.status<500?error.message:'Receiver unavailable; check server configuration.'})]);}catch{}next(error);}});
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD'].includes(req.method)&&req.headers['x-ops-request']!=='1')return res.status(403).json({error:'Invalid application request.'});next();});
app.post('/api/auth/login',rateLimit({windowMs:15*60000,limit:15,message:{error:'Too many sign-in attempts. Please wait before trying again.'}}),login);
app.use('/api',passwordResetRoutes);
app.use('/api',publicRoutes);
app.use('/api',authenticate);
app.use('/api',emailRoutes);
app.use('/api',emailTemplateRoutes);
app.use('/api',agreementTemplateRoutes);
app.use('/api',connectionRoutes);
app.get('/api/auth/me',(req,res)=>res.json(req.user));
app.post('/api/auth/logout',logout);
app.use('/api',routes);
app.use('/api',catalog);
app.use('/api',internalWorkRoutes);app.use('/api',statusReminderRoutes);app.use('/api',fileManagement);
app.use('/api/settings',permit('ADMIN'));
app.use('/api/users',permit('ADMIN'));
app.get('/api/users',async(req,res)=>{const [rows]=await db.query('SELECT id,name,email,role,active,team_id,created_at FROM users ORDER BY id DESC');res.json(rows);});
app.post('/api/users',async(req,res)=>{
 if(!validUser(req.body))fail('Provide name, email, staff role, and a password of 12–128 characters.');
 const {name,email,password,role,teamId}=req.body;
 const id=await transaction(async c=>{if(teamId){const [teams]=await c.execute('SELECT id FROM teams WHERE id=?',[Number(teamId)]);if(!teams.length)fail('Team not found.');}const [r]=await c.execute('INSERT INTO users (name,email,password_hash,role,team_id) VALUES (?,?,?,?,?)',[name.trim(),email.trim().toLowerCase(),await hashPassword(password),role,teamId || null]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'USER_CREATED',JSON.stringify({userId:r.insertId,role})]);return r.insertId;});res.status(201).json({id});
});
app.get('/api/settings/workflow',async(req,res)=>{const [rows]=await db.query('SELECT settings FROM application_settings WHERE id=1');const {contractConnection,...settings}=json(rows[0].settings);res.json({...settings,emailDeliveryEnabled:!!(await emailSettings()).enabled,webhookConfigured:!!(await contractSecret())});});
app.put('/api/settings/workflow',async(req,res)=>{
 const {activationDate,allowedPipelines,defaultCategoryId,defaultAgentId,ghlMediaCopy,mediaPrivacyVerified,compressCopies,mediaFolderId}=req.body;
 if(activationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(activationDate)||isNaN(Date.parse(activationDate)))||!Array.isArray(allowedPipelines)||allowedPipelines.length>100||allowedPipelines.some(p=>typeof p!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(p))||ghlMediaCopy&&!mediaPrivacyVerified)fail('Set valid onboarding rules. GHL copying requires confirmed media privacy.');
 if(defaultCategoryId){const [rows]=await db.execute("SELECT id FROM categories WHERE id=? AND status='PUBLISHED'",[Number(defaultCategoryId)]);if(!rows.length)fail('Default category must be published.');}
 if(defaultAgentId){const [rows]=await db.execute("SELECT id FROM users WHERE id=? AND active=1 AND role!='CLIENT'",[Number(defaultAgentId)]);if(!rows.length)fail('Default agent must be active staff.');}
 if(mediaFolderId && (typeof mediaFolderId!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(mediaFolderId)))fail('Invalid GHL Media folder ID.');
 const settings={activationDate:activationDate || null,allowedPipelines,defaultCategoryId:defaultCategoryId || null,defaultAgentId:defaultAgentId || null,ghlMediaCopy:!!ghlMediaCopy,mediaPrivacyVerified:!!mediaPrivacyVerified,compressCopies:!!compressCopies,mediaFolderId:mediaFolderId || null};
 await transaction(async c=>{await c.execute("UPDATE application_settings SET settings=JSON_MERGE_PATCH(settings,JSON_EXTRACT(?,'$')) WHERE id=1",[JSON.stringify(settings)]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'WORKFLOW_SETTINGS_UPDATED',JSON.stringify(settings)]);});res.json({saved:true});
});
app.get('/api/settings/crm',async(req,res)=>{const [rows]=await db.query('SELECT location_id,updated_at FROM integration_settings WHERE id=1');res.json({locationId:rows[0]?.location_id || '',hasToken:!!rows.length,updatedAt:rows[0]?.updated_at});});
app.put('/api/settings/crm',async(req,res)=>{
 const {locationId,privateToken}=req.body;
 if(typeof locationId!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(locationId))fail('Enter a valid location ID.');
 if(privateToken!==undefined&&(typeof privateToken!=='string'||privateToken.length>4096||/\s/.test(privateToken)))fail('Enter a valid private token.');
 await transaction(async c=>{const [rows]=await c.query('SELECT * FROM integration_settings WHERE id=1 FOR UPDATE');if(!privateToken&&(!rows.length||rows[0].location_id!==locationId))fail('Provide a private token for a new location.');const token=privateToken?encrypt(privateToken):rows[0].token_encrypted;await c.execute('INSERT INTO integration_settings (id,location_id,token_encrypted) VALUES (1,?,?) ON DUPLICATE KEY UPDATE location_id=?,token_encrypted=?',[locationId,token,locationId,token]);if(rows[0]?.location_id!==locationId)await c.query("UPDATE application_settings SET settings=JSON_SET(settings,'$.ghlMediaCopy',false,'$.mediaPrivacyVerified',false) WHERE id=1");await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'CRM_SETTINGS_UPDATED',JSON.stringify({locationId,tokenReplaced:!!privateToken})]);});res.json({saved:true});
});
app.post('/api/settings/crm/test',async(req,res)=>{
 const [rows]=await db.query('SELECT * FROM integration_settings WHERE id=1');if(!rows.length)fail('Save CRM credentials first.');
 const response=await fetch('https://services.leadconnectorhq.com/locations/'+encodeURIComponent(rows[0].location_id),{headers:{Authorization:'Bearer '+decrypt(rows[0].token_encrypted),Version:'2021-07-28',Accept:'application/json'},signal:AbortSignal.timeout(10000)});
 if(!response.ok)return res.status(502).json({error:`CRM returned HTTP ${response.status}. Check location, token and locations.readonly permission.`});res.json({connected:true,message:'Location access verified. Messaging and media permissions are checked when used.'});
});
app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found.'}));
app.use((err,req,res,next)=>{if(err.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'File exceeds the 10 MB upload limit.'});if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'This record already exists.'});if(err.status)return res.status(err.status).json({error:err.message});console.error('Request failed:',err.code || err.name,req.method,req.path);if(err.code==='ER_PARSE_ERROR')return res.status(503).json({error:'A database query is incompatible with this server. Update the application and check the database version; see server logs for the failing endpoint.'});res.status(503).json({error:'Request failed. Check database, storage and CRM configuration.'});});
if(process.env.NODE_ENV!=='test'){
 app.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log('Operations application: http://localhost:'+(process.env.PORT || 3000)));
 let running=false;const timer=setInterval(async()=>{if(running)return;running=true;try{await runJobs();}catch(e){console.error('Maintenance failed:',e.code || e.name);}finally{running=false;}},60000);timer.unref();
}
