import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {db} from './db.js';
import {encrypt} from './crypto.js';
import {hashPassword} from './auth.js';
import {json,canAccess,completion,normalizeFields,fail} from './domain.js';
import {portalBase} from './connection.js';
export async function transaction(callback) {const c=await db.getConnection();try{await c.beginTransaction();const result=await callback(c);await c.commit();return result;}catch(e){await c.rollback();throw e;}finally{c.release();}}
export async function loadCase(c,id,user,lock=false) {
 const [rows]=await c.execute('SELECT * FROM cases WHERE id=?'+(lock?' FOR UPDATE':''),[id]);
 if(!rows.length||rows[0].status==='DELETED')fail('Client file not found.',404);
 if(user && !canAccess(user,rows[0]))fail('You do not have access to this client file.',403);
 return rows[0];
}
export async function event(c,caseId,user,action,description,visible=false) {
 const [result]=await c.execute('INSERT INTO case_events (case_id,actor_id,action,description,client_visible) VALUES (?,?,?,?,?)',[caseId,user?.id || null,action,description,visible]);
 await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[user?.email || 'contract-integration',action,JSON.stringify({caseId,eventId:result.insertId})]);
 return result.insertId;
}
export async function notify(c,userId,caseId,key,description) {if(userId&&caseId){const [rows]=await c.execute('SELECT u.role,c.client_notifications_enabled FROM users u JOIN cases c ON c.id=? WHERE u.id=?',[caseId,userId]);if(rows[0]?.role==='CLIENT'&&rows[0].client_notifications_enabled===0)return;}if(userId)await c.execute('INSERT IGNORE INTO notifications (user_id,case_id,event_key,description) VALUES (?,?,?,?)',[userId,caseId,key,description]);}
export async function managers(c,caseId,key,description) {
 const [users]=await c.execute("SELECT u.id FROM users u JOIN cases c ON c.id=? WHERE u.active=1 AND (u.role='ADMIN' OR (u.role='MANAGER' AND u.team_id=c.team_id))",[caseId]);
 for(const u of users)await notify(c,u.id,caseId,key,description);
}
export async function queueEmail(c,file,key,subject,message) {
 const [settings]=await c.execute('SELECT client_notifications_enabled FROM cases WHERE id=?',[file.id]);if(settings[0]?.client_notifications_enabled===0)return false;
 await c.execute('INSERT IGNORE INTO email_outbox (case_id,recipient_contact_id,payload_encrypted,event_key) VALUES (?,?,?,?)',[file.id,file.ghl_contact_id || null,encrypt(JSON.stringify({subject,message,emailTo:file.client_email})),key]);
}
export async function refresh(c,file,user) {
 const [requirements]=await c.execute('SELECT * FROM requirements WHERE case_id=?',[file.id]);
 const [documents]=await c.execute('SELECT v.* FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE r.case_id=?',[file.id]);
 const progress=completion(requirements,documents);
 if(!progress.ready && file.status!=='COLLECTING'){
  await c.execute("UPDATE cases SET status='COLLECTING',approved_at=NULL,approved_by=NULL WHERE id=?",[file.id]);
  await event(c,file.id,user,'COLLECTION_REOPENED','Additional or changed requirements need attention.',true);
 } else if(progress.ready && file.status==='COLLECTING'){
  await c.execute("UPDATE cases SET status='READY_FOR_MANAGER_REVIEW' WHERE id=?",[file.id]);
  const e=await event(c,file.id,user,'FILE_READY_FOR_REVIEW','All mandatory requirements are satisfied. Awaiting manager review.',true);
  await managers(c,file.id,`ready:${e}`,'Client file is ready for manager review.');
 }
 return progress;
}
export function expandFields(fields,applicants) {
 const expanded=[];
 for(const f of fields) for(const applicant of (f.applicantSpecific?applicants:[null])) {
  const suffix=applicant?'_'+applicant.key:'';
  const condition=f.condition?{...f.condition,key:f.condition.key+(fields.find(v=>v.key===f.condition.key)?.applicantSpecific?suffix:'')}:undefined;
  if(!f.applicantSpecific&&f.condition&&fields.find(v=>v.key===f.condition.key)?.applicantSpecific)fail('Shared fields cannot depend on applicant-specific fields.');
  for(let index=1;index<=(f.type==='file'?f.fileCount || 1:1);index++)expanded.push({...f,key:f.key+suffix+(f.fileCount>1?'_file'+index:''),label:f.label+(applicant?' — '+applicant.name:'')+(f.fileCount>1?' · File '+index:''),condition});
 }
 return expanded;
}
export async function createCase(c,input,user) {
 if(typeof input.clientName!=='string'||!input.clientName.trim()||input.clientName.length>200||typeof input.clientEmail!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.clientEmail)||input.clientEmail.length>254)fail('Enter client name and email.');
 const [cats]=await c.execute("SELECT * FROM categories WHERE id=? AND status='PUBLISHED'",[Number(input.categoryId)||0]);
 if(!cats.length)fail('Select a published category.');
 let assigned=null;
 if(input.assignedTo){const [users]=await c.execute("SELECT id,team_id FROM users WHERE id=? AND active=1 AND role IN ('AGENT','MANAGER','ADMIN')",[Number(input.assignedTo)]);if(!users.length)fail('Select an active staff assignee.');assigned=users[0];}
 const teamId=assigned?.team_id || input.teamId || user?.team_id || null;
 if(user?.role==='MANAGER' && (teamId===null||Number(teamId)!==Number(user.team_id)))fail('Managers can create files within their own team.',403);
 if(teamId){const [teams]=await c.execute('SELECT id FROM teams WHERE id=?',[Number(teamId)]);if(!teams.length)fail('Team not found.');}
 const applicants=(input.applicants || [{name:input.clientName}]).map(a=>({key:randomBytes(4).toString('hex'),name:a.name}));
 if(!applicants.length||applicants.length>20||applicants.some(a=>typeof a.name!=='string'||!a.name.trim()||a.name.length>120))fail('Provide 1–20 named applicants.');
 const category=cats[0], fields=expandFields(normalizeFields(json(category.fields)),applicants);
 const [clientUsers]=await c.execute("SELECT id,role FROM users WHERE email=?",[input.clientEmail.trim().toLowerCase()]);
 if(clientUsers.length&&clientUsers[0].role!=='CLIENT')fail('This email belongs to a staff account. Use the client’s own email address before initiating the file; staff accounts cannot be converted to client logins.',409);
 const [result]=await c.execute('INSERT INTO cases (source_contract_id,ghl_contact_id,client_name,client_email,category_id,requirements_snapshot,category_version,assigned_to,team_id,due_at,opportunity_id,summary_json,applicants,client_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[input.contractId || 'manual:'+randomUUID(),input.contactId || null,input.clientName.trim(),input.clientEmail.trim().toLowerCase(),category.id,JSON.stringify(fields),category.version,assigned?.id || null,teamId,input.dueAt?new Date(input.dueAt):null,input.dossier?null:input.opportunityId || null,JSON.stringify(input.summary || {}),JSON.stringify(applicants),clientUsers[0]?.id || null]);
 for(const f of fields)await c.execute('INSERT INTO requirements (case_id,field_key,definition) VALUES (?,?,?)',[result.insertId,f.key,JSON.stringify(f)]);
 const file=await loadCase(c,result.insertId,null);
 if(input.contractUrl){if(typeof input.contractUrl!=='string'||!/^https:\/\/[^\s]+$/.test(input.contractUrl))fail('Signed contract link must use HTTPS.');await c.execute('UPDATE cases SET contract_url=? WHERE id=?',[input.contractUrl,file.id]);file.contract_url=input.contractUrl;}
 await event(c,file.id,user,'CASE_CREATED','Your application file has been opened and documents requested.',true);
 await notify(c,file.assigned_to,file.id,`new-case:${file.id}`,'A new client file has been assigned to you.');
 await refresh(c,file,user);return file;
}
export async function sendClientAccess(c,file,user) {
 if(file.client_notifications_enabled===0)return false;
 const portalUrl=new URL('/',await portalBase()).href;
 let text;
 if(file.client_user_id){text=`Your new application file is ready.\nPortal: ${portalUrl}\nEmail: ${file.client_email}\nLog in using your existing password.`;}
 else {const password=randomBytes(18).toString('base64url');const [result]=await c.execute("INSERT INTO users (name,email,password_hash,role,must_change_password) VALUES (?,?,?,'CLIENT',1)",[file.client_name,file.client_email,await hashPassword(password)]);await c.execute('UPDATE cases SET client_user_id=? WHERE id=?',[result.insertId,file.id]);text=`Your application file is ready.\nPortal: ${portalUrl}\nEmail: ${file.client_email}\nTemporary password: ${password}\nPlease change this password after your first login, then complete your information and upload the requested documents.`;}
 await queueEmail(c,file,`client-access:${file.id}`,'Your client portal login details',text);
 await event(c,file.id,user,'CLIENT_ACCESS_SENT','Client portal login details queued for email delivery.',false);return true;
}
export async function invite(c,file,user) {
 if(file.client_notifications_enabled===0)fail('Client notifications are stopped. Enable them in Reminders & expiry before sending portal access.',409);
 if(file.client_user_id)fail('Client already has an account. Use password reset if needed.');
 const token=randomBytes(32).toString('hex'), hash=createHash('sha256').update(token).digest('hex');
 await c.execute('DELETE FROM invitations WHERE case_id=? AND used_at IS NULL',[file.id]);
 await c.execute('INSERT INTO invitations (token_hash,case_id,email,expires_at) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 48 HOUR))',[hash,file.id,file.client_email]);
 const url=new URL('/?invite='+token,await portalBase()).href;
 const e=await event(c,file.id,user,'PORTAL_INVITATION_CREATED','Secure portal access invitation created.',false);
 await queueEmail(c,file,`invite:${e}`,'Activate your client portal',`Create your client portal password using this link (valid for 48 hours): ${url}`);
 return url;
}
