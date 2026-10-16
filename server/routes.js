import {Router} from 'express';
import multer from 'multer';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {db} from './db.js';
import {hashPassword,verifyPassword,permit,validUser} from './auth.js';
import {encrypt,decrypt} from './crypto.js';
import {json,fail,canAccess,normalizeFields,applicable,validValue,completion} from './domain.js';
import {transaction,loadCase,event,notify,managers,queueEmail,refresh,createCase,invite,sendClientAccess} from './workflow.js';
import {credentials,crm,verifyContact} from './crm.js';
import {runJobs} from './jobs.js';
import {emailSettings} from './email.js';
import {optimize} from './optimize.js';
import {uploadMedia,readDocument} from './storage.js';
import {saveFilePreferences} from './file-management.js';
export const routes=Router();
const staffOnly=permit('ADMIN','MANAGER','AGENT'), manage=permit('ADMIN','MANAGER');
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:0}});
const directory=path.resolve(process.env.UPLOAD_DIR || 'private-uploads');
function scope(user,alias='c') {if(user.role==='ADMIN')return ['1=1',[]];if(user.role==='MANAGER')return [`${alias}.team_id=?`,[user.team_id || 0]];if(user.role==='CLIENT')return [`${alias}.client_user_id=?`,[user.id]];return [`${alias}.assigned_to=?`,[user.id]];}
async function assignee(c,id,file,user) {const [rows]=await c.execute("SELECT id,team_id FROM users WHERE id=? AND active=1 AND role IN ('ADMIN','MANAGER','AGENT')",[Number(id)||0]);if(!rows.length)fail('Select an active staff user.');if(user.role==='MANAGER'&&Number(rows[0].team_id)!==Number(user.team_id))fail('Select staff within your team.',403);return rows[0];}
function writable(file,user) {if(['COMPLETED','SUBMITTED','CANCELLED'].includes(file.status))fail('This file is closed for collection. Reopen it before changing requirements.',409);}
routes.get('/staff',staffOnly,async(req,res)=>{const [users]=await db.execute("SELECT id,name,role,team_id FROM users WHERE active=1 AND role!='CLIENT'"+(req.user.role==='ADMIN'?'':' AND (team_id=? OR id=?)'),req.user.role==='ADMIN'?[]:[req.user.team_id || 0,req.user.id]);res.json(users);});
routes.get('/teams',staffOnly,async(req,res)=>{const [rows]=await db.query('SELECT * FROM teams ORDER BY name');res.json(rows);});
routes.post('/teams',permit('ADMIN'),async(req,res)=>{if(typeof req.body.name!=='string'||!req.body.name.trim()||req.body.name.length>120)fail('Enter team name.');const [r]=await db.execute('INSERT INTO teams (name) VALUES (?)',[req.body.name.trim()]);res.status(201).json({id:r.insertId});});
routes.patch('/users/:id',permit('ADMIN'),async(req,res)=>{
 const {name,role,active,teamId,password}=req.body;
 if(typeof name!=='string'||!name.trim()||name.length>120||!['ADMIN','MANAGER','AGENT','CLIENT'].includes(role)||typeof active!=='boolean'||password!==undefined&&(typeof password!=='string'||password.length<12||password.length>128))fail('Invalid account update.');
 await transaction(async c=>{
  const [admins]=await c.query("SELECT id FROM users WHERE role='ADMIN' AND active=1 FOR UPDATE");
  const [rows]=await c.execute('SELECT * FROM users WHERE id=? FOR UPDATE',[req.params.id]);if(!rows.length)fail('User not found.',404);const existing=rows[0];
  if(Number(req.params.id)===req.user.id&&(!active||role!=='ADMIN'))fail('You cannot deactivate or demote your current account.');
  if(existing.role==='ADMIN'&&existing.active&&admins.length<=1&&(!active||role!=='ADMIN'))fail('Keep at least one active administrator.');
  if((existing.role==='CLIENT')!==(role==='CLIENT'))fail('Staff and client accounts cannot be converted.');
  if(teamId){const [teams]=await c.execute('SELECT id FROM teams WHERE id=?',[Number(teamId)]);if(!teams.length)fail('Team not found.');}
  await c.execute('UPDATE users SET name=?,role=?,active=?,team_id=? WHERE id=?',[name.trim(),role,active,teamId || null,req.params.id]);
  if(password)await c.execute('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?',[await hashPassword(password),req.params.id]);
  await c.execute('DELETE FROM sessions WHERE user_id=?',[req.params.id]);
  await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'USER_UPDATED',JSON.stringify({id:req.params.id,role,active,passwordReset:!!password})]);
 });res.json({saved:true});
});
routes.post('/auth/password',async(req,res)=>{const {currentPassword,password}=req.body;if(typeof currentPassword!=='string'||currentPassword.length>128||typeof password!=='string'||password.length<12||password.length>128)fail('Provide your current password and a new password of 12–128 characters.');await transaction(async c=>{const [rows]=await c.execute('SELECT password_hash FROM users WHERE id=? FOR UPDATE',[req.user.id]);if(!await verifyPassword(currentPassword,rows[0].password_hash))fail('Current password is incorrect.',403);await c.execute('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?',[await hashPassword(password),req.user.id]);await c.execute('DELETE FROM sessions WHERE user_id=?',[req.user.id]);});res.clearCookie('ops_session',{path:'/'});res.json({changed:true});});
routes.get('/cases',async(req,res)=>{const [where,args]=scope(req.user);const [rows]=await db.execute(`SELECT c.id,c.client_name,c.status,c.assigned_to,c.team_id,c.due_at,c.created_at,u.name AS agent_name,cat.name AS category_name,fs.name AS operational_status_name,fs.color AS operational_status_color FROM cases c LEFT JOIN users u ON u.id=c.assigned_to LEFT JOIN categories cat ON cat.id=c.category_id LEFT JOIN file_statuses fs ON fs.id=c.operational_status_id WHERE ${where} ORDER BY c.id DESC`,args);res.json(rows);});
routes.post('/cases',staffOnly,(req,res)=>res.status(409).json({error:'Start a file from New clients after Contract Manager completes the Client Summary.'}));
routes.get('/intake',staffOnly,async(req,res)=>{const [where,args]=scope(req.user);const [rows]=await db.execute(`SELECT i.id,i.contract_id,i.opportunity_id,i.client_name,i.client_email,i.received_at,i.case_id FROM contract_intake i LEFT JOIN cases c ON c.id=i.case_id WHERE i.case_id IS NULL OR (${where}) ORDER BY i.id DESC`,args);res.json(rows);});
routes.get('/intake/:id',staffOnly,async(req,res)=>{const [rows]=await db.execute('SELECT * FROM contract_intake WHERE id=?',[req.params.id]);if(!rows.length)fail('Incoming client not found.',404);if(rows[0].case_id)await loadCase(db,rows[0].case_id,req.user);const [accounts]=await db.execute('SELECT role FROM users WHERE email=?',[rows[0].client_email]);res.json({...rows[0],payload:json(rows[0].payload),emailConflict:!!accounts.length&&accounts[0].role!=='CLIENT'});});
routes.patch('/intake/:id/client-email',staffOnly,async(req,res)=>{const {email,reason}=req.body;if(typeof email!=='string'||email.length>254||!/^([^\s@]+)@([^\s@]+)\.[^\s@]+$/.test(email)||typeof reason!=='string'||!reason.trim()||reason.length>1000)fail('Enter the client’s email and a reason for correcting it.');await transaction(async c=>{const [rows]=await c.execute('SELECT * FROM contract_intake WHERE id=? FOR UPDATE',[req.params.id]);if(!rows.length)fail('Incoming client not found.',404);if(rows[0].case_id)fail('The file is already initiated. Its login email cannot be changed here.',409);const [accounts]=await c.execute('SELECT role FROM users WHERE email=?',[email.trim().toLowerCase()]);if(accounts.some(a=>a.role!=='CLIENT'))fail('That email belongs to staff. Use the client’s own email address.',409);await c.execute('UPDATE contract_intake SET client_email=? WHERE id=?',[email.trim().toLowerCase(),rows[0].id]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'INTAKE_EMAIL_CORRECTED',JSON.stringify({intakeId:rows[0].id,oldEmail:rows[0].client_email,email:email.trim().toLowerCase(),reason:reason.trim()})]);});res.json({saved:true});});
routes.post('/intake/:id/initiate',staffOnly,async(req,res)=>{const id=await transaction(async c=>{const [rows]=await c.execute('SELECT * FROM contract_intake WHERE id=? FOR UPDATE',[req.params.id]);if(!rows.length)fail('Incoming client not found.',404);const incoming=rows[0];if(incoming.case_id)fail('A file has already been initiated for this client.',409);const assignedTo=req.user.role==='AGENT'?req.user.id:Number(req.body.assignedTo)||req.user.id;const file=await createCase(c,{...json(incoming.payload),clientEmail:incoming.client_email,categoryId:Number(req.body.categoryId),assignedTo,dueAt:req.body.dueAt || null},req.user);await saveFilePreferences(c,file,req.body,req.user);await sendClientAccess(c,file,req.user);await c.execute('UPDATE contract_intake SET case_id=?,initiated_by=?,initiated_at=NOW() WHERE id=?',[file.id,req.user.id,incoming.id]);return file.id;});res.status(201).json({id,credentialsQueued:true});});
async function caseDetails(req,res,clientPreview=false){
 const file=await loadCase(db,req.params.id,req.user);
 const [details]=await db.execute('SELECT cat.name AS category_name,u.name AS owner_name FROM cases c LEFT JOIN categories cat ON cat.id=c.category_id LEFT JOIN users u ON u.id=c.assigned_to WHERE c.id=?',[file.id]);Object.assign(file,details[0]);
 const [requirements]=await db.execute('SELECT * FROM requirements WHERE case_id=? ORDER BY id',[file.id]);
 const [documents]=await db.execute('SELECT v.id,v.requirement_id,v.version,v.original_name,v.mime,v.byte_size,v.status,v.reason,v.reviewed_at,v.created_at FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE r.case_id=? ORDER BY v.id DESC',[file.id]);
 const [events]=await db.execute('SELECT e.id,e.actor_id,e.action,e.description,e.created_at,u.name AS actor_name,u.role AS actor_role FROM case_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.case_id=?'+((clientPreview||req.user.role==='CLIENT')?' AND client_visible=1':'')+' ORDER BY e.id DESC',[file.id]);
 const [tasks]=(clientPreview||req.user.role==='CLIENT')?[[]]:await db.execute('SELECT t.*,u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE case_id=? ORDER BY t.id DESC',[file.id]);
 const [emails]=(clientPreview||req.user.role==='CLIENT')?[[]]:await db.execute('SELECT id,status,attempts,last_error,created_at,sent_at,next_attempt_at,payload_encrypted FROM email_outbox WHERE case_id=? ORDER BY id DESC',[file.id]);
 for(const email of emails){const payload=JSON.parse(decrypt(email.payload_encrypted));email.subject=payload.subject;email.recipient=payload.emailTo || file.client_email;delete email.payload_encrypted;}
 const [expiries]=await db.execute('SELECT * FROM case_expiries WHERE case_id=? ORDER BY expires_on,id',[file.id]);const [customStatuses]=file.operational_status_id?await db.execute('SELECT name,color FROM file_statuses WHERE id=?',[file.operational_status_id]):[[]];file.operational_status_name=customStatuses[0]?.name || null;file.operational_status_color=customStatuses[0]?.color || '#137f75';
 const [publishedGuides]=await db.execute('SELECT version,fields FROM category_versions WHERE category_id=? ORDER BY version DESC LIMIT 1',[file.category_id]);
 const categoryInstructions=(publishedGuides.length?json(publishedGuides[0].fields):requirements.map(r=>json(r.definition))).filter(f=>f.instructionRole);
 const safeFile={id:file.id,client_user_id:file.client_user_id,client_name:file.client_name,status:file.status,due_at:file.due_at,category_version:file.category_version,applicants:json(file.applicants),approved_at:file.approved_at};
 res.json({categoryInstructions,instructionsVersion:publishedGuides[0]?.version || file.category_version,expiries,file:(clientPreview||req.user.role==='CLIENT')?safeFile:{...file,summary_json:json(file.summary_json)},requirements:requirements.map(r=>({...r,definition:json(r.definition),value_json:json(r.value_json),applicable:applicable(r,requirements)})),documents,events,tasks,emails,progress:completion(requirements,documents)});
}
routes.get('/cases/:id',async(req,res)=>caseDetails(req,res));
routes.get('/cases/:id/client-preview',staffOnly,async(req,res)=>{await loadCase(db,req.params.id,req.user);await db.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'CLIENT_VIEW_PREVIEWED',JSON.stringify({caseId:req.params.id,mode:'READ_ONLY'})]);await caseDetails(req,res,true);});
routes.post('/cases/:id/invite',manage,async(req,res)=>{const url=await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);return invite(c,file,req.user);});res.json({url});});
routes.patch('/cases/:id/assignment',manage,async(req,res)=>{await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true),agent=await assignee(c,req.body.assignedTo,file,req.user);await c.execute('UPDATE cases SET assigned_to=?,team_id=?,due_at=? WHERE id=?',[agent.id,agent.team_id,req.body.dueAt?new Date(req.body.dueAt):null,file.id]);const e=await event(c,file.id,req.user,'CASE_ASSIGNED','Client file assignment updated.');await notify(c,agent.id,file.id,`assigned:${e}`,'Client file assigned to you.');});res.json({saved:true});});
routes.post('/cases/:id/requirements',staffOnly,async(req,res)=>{const [definition]=normalizeFields([req.body.field]);await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);writable(file,req.user);if(typeof req.body.reason!=='string'||!req.body.reason.trim())fail('Explain why this extra field is requested.');if(definition.condition)fail('Custom requests must be unconditional.');await c.execute('INSERT INTO requirements (case_id,field_key,definition) VALUES (?,?,?)',[file.id,definition.key,JSON.stringify(definition)]);const e=await event(c,file.id,req.user,'REQUIREMENT_ADDED',definition.label+' requested: '+req.body.reason,true);await queueEmail(c,file,`requirement:${e}`,'Additional information requested',definition.label+'\n'+definition.guide+'\n'+req.body.reason);await refresh(c,file,req.user);});res.status(201).json({saved:true});});
routes.post('/cases/:id/requirements/:rid/waive',manage,async(req,res)=>{if(typeof req.body.reason!=='string'||!req.body.reason.trim())fail('A waiver reason is required.');await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);writable(file,req.user);const [rows]=await c.execute('SELECT * FROM requirements WHERE id=? AND case_id=?',[req.params.rid,file.id]);if(!rows.length)fail('Requirement not found.',404);await c.execute('UPDATE requirements SET waived=1 WHERE id=?',[req.params.rid]);await event(c,file.id,req.user,'REQUIREMENT_WAIVED',json(rows[0].definition).label+' waived: '+req.body.reason,true);await refresh(c,file,req.user);});res.json({saved:true});});
routes.put('/cases/:id/values',async(req,res)=>{
 const values=req.body.values;if(!values||typeof values!=='object'||Array.isArray(values))fail('Invalid field values.');
 await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);writable(file,req.user);const [requirements]=await c.execute('SELECT * FROM requirements WHERE case_id=?',[file.id]);
  for(const [id,value] of Object.entries(values)){const r=requirements.find(v=>String(v.id)===id);if(!r||r.waived||['file','heading','paragraph','divider'].includes(json(r.definition).type))fail('Invalid field selection.');if(!validValue({...json(r.definition),required:false},value))fail('Invalid value for '+json(r.definition).label);r.value_json=value;await c.execute('UPDATE requirements SET value_json=? WHERE id=?',[JSON.stringify(value),id]);}
  if(file.status==='APPROVED'){await c.execute("UPDATE cases SET status='COLLECTING',approved_at=NULL,approved_by=NULL WHERE id=?",[file.id]);file.status='COLLECTING';await event(c,file.id,req.user,'APPROVAL_INVALIDATED','Information changed after approval. Manager must review again.',true);}
  await event(c,file.id,req.user,'FORM_SAVED','Application information updated.',true);await refresh(c,file,req.user);
 });res.json({saved:true});
});
routes.post('/cases/:id/requirements/:rid/upload',async(req,res,next)=>{await loadCase(db,req.params.id,req.user);next();},upload.single('file'),async(req,res)=>{
 if(!req.file)fail('Choose a file.');const file=req.file;
 const detected=file.buffer.subarray(0,5).toString()==='%PDF-'?'pdf':file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':file.buffer[0]===255&&file.buffer[1]===216&&file.buffer[2]===255?'jpg':null;
 if(!detected)fail('Upload a valid PDF, JPG or PNG file.');
 const key=randomUUID();
 await transaction(async c=>{
  const caseFile=await loadCase(c,req.params.id,req.user,true);writable(caseFile,req.user);
  const [requirements]=await c.execute('SELECT * FROM requirements WHERE case_id=?',[caseFile.id]);const requirement=requirements.find(r=>String(r.id)===req.params.rid);
  if(!requirement||requirement.waived||!applicable(requirement,requirements)||json(requirement.definition).type!=='file')fail('File requirement is not available.');
  const definition=json(requirement.definition);if(!definition.formats.includes(detected)||file.size>definition.maxMB*1024*1024)fail('File does not meet the format or size requirements.');
  const [versions]=await c.execute('SELECT version,status FROM document_versions WHERE requirement_id=? ORDER BY version DESC',[requirement.id]);
  if(versions[0]?.status==='ACCEPTED'&&req.user.role==='CLIENT')fail('This document is already accepted. Ask Operations to request a replacement.',409);
  const mime={pdf:'application/pdf',jpg:'image/jpeg',png:'image/png'}[detected];
  const media=await uploadMedia(file.buffer,mime,`OPS-${caseFile.id}-${key}.${detected}`);
  const name=path.basename(file.originalname).replace(/[\r\n\x00-\x1f]/g,'').slice(0,240);
  const [result]=await c.execute('INSERT INTO document_versions (requirement_id,version,original_name,storage_key,mime,byte_size,sha256,uploaded_by,storage_provider,ghl_media_id,ghl_media_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[requirement.id,(versions[0]?.version || 0)+1,name,key,{pdf:'application/pdf',jpg:'image/jpeg',png:'image/png'}[detected],file.size,createHash('sha256').update(file.buffer).digest('hex'),req.user.id,'GHL',media.fileId,media.url]);
  const e=await event(c,caseFile.id,req.user,'DOCUMENT_UPLOADED',definition.label+' uploaded — pending review.',true);
  await notify(c,caseFile.assigned_to,caseFile.id,`uploaded:${e}`,'Document awaiting review: '+definition.label);await refresh(c,caseFile,req.user);
  return result.insertId;
 });res.status(201).json({uploaded:true});
});
routes.get('/documents/:id/file',async(req,res)=>{
 const [rows]=await db.execute('SELECT v.*,r.case_id FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE v.id=?',[req.params.id]);if(!rows.length)fail('Document not found.',404);const v=rows[0];await loadCase(db,v.case_id,req.user);
 if(v.status==='REMOVED')fail('This document was removed.',410);
 const buffer=await readDocument(v);
 await transaction(c=>event(c,v.case_id,req.user,'DOCUMENT_VIEWED',`Document version ${v.id} viewed/downloaded.`));
 res.set({'Content-Type':v.mime,'Content-Disposition':`${req.query.preview==='1'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(v.original_name)}`,'Content-Security-Policy':"default-src 'none'; sandbox; frame-ancestors 'self'",'Cache-Control':'no-store'});res.send(buffer);
});
routes.post('/documents/:id/ghl-copy',staffOnly,async(req,res)=>{
 const [settings]=await db.query('SELECT settings FROM application_settings WHERE id=1');const policy=json(settings[0].settings);if(!policy.ghlMediaCopy||!policy.mediaPrivacyVerified)fail('Enable GHL Media copies only after verifying location media privacy.',409);
 const [rows]=await db.execute('SELECT v.*,r.case_id FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE v.id=?',[req.params.id]);if(!rows.length)fail('Document not found.',404);const v=rows[0];await loadCase(db,v.case_id,req.user);if(v.ghl_media_id)return res.json({copied:true});
 const original=Buffer.from(decrypt(await readFile(path.join(directory,v.storage_key+'.enc'),'utf8')),'base64');const bytes=policy.compressCopies?await optimize(original,v.mime):original;const body=new FormData();body.set('file',new Blob([bytes],{type:v.mime}),v.original_name);body.set('hosted','false');if(policy.mediaFolderId)body.set('parentId',policy.mediaFolderId);body.set('name',`OPS-${v.case_id}-v${v.version}-${v.original_name}`);
 const result=await crm('/medias/upload-file',{method:'POST',body});if(!result.fileId||!result.url)fail('CRM did not confirm media storage.',502);
 await transaction(async c=>{await loadCase(c,v.case_id,req.user,true);await c.execute('UPDATE document_versions SET ghl_media_id=?,ghl_media_url=? WHERE id=?',[result.fileId,result.url,v.id]);await event(c,v.case_id,req.user,'GHL_MEDIA_COPIED',`Document copied to CRM media storage (${original.length} original bytes; ${bytes.length} copy bytes).`);});res.json({copied:true,compressed:bytes.length<original.length});
});
routes.delete('/documents/:id',staffOnly,async(req,res)=>{
 const reason=req.body.reason;if(typeof reason!=='string'||!reason.trim()||reason.length>1000)fail('Enter a reason for removing this document.');
 await transaction(async c=>{
  const [lookup]=await c.execute('SELECT r.case_id FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE v.id=?',[req.params.id]);if(!lookup.length)fail('Document not found.',404);
  const file=await loadCase(c,lookup[0].case_id,req.user,true);writable(file,req.user);
  const [rows]=await c.execute('SELECT * FROM document_versions WHERE id=? FOR UPDATE',[req.params.id]);const v=rows[0];
  if(v.status==='REMOVED')return;
  const [latest]=await c.execute('SELECT id FROM document_versions WHERE requirement_id=? ORDER BY version DESC LIMIT 1',[v.requirement_id]);if(Number(latest[0].id)!==Number(v.id))fail('Only the latest document can be removed.',409);
  if(v.ghl_media_id){const config=await credentials();try{await crm('/medias/'+encodeURIComponent(v.ghl_media_id)+'?altType=location&altId='+encodeURIComponent(config.locationId),{method:'DELETE'});}catch(e){if(e.providerStatus!==404)throw e;}}
  if(v.storage_provider!=='GHL')await unlink(path.join(directory,v.storage_key+'.enc')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  await c.execute("UPDATE document_versions SET status='REMOVED',reason=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?",[reason.trim(),req.user.id,v.id]);
  if(file.status==='APPROVED'){await c.execute("UPDATE cases SET status='COLLECTING',approved_at=NULL,approved_by=NULL WHERE id=?",[file.id]);file.status='COLLECTING';}
  await event(c,file.id,req.user,'DOCUMENT_REMOVED',`Document version ${v.version} removed: ${reason.trim()}`,true);await refresh(c,file,req.user);
 });res.json({removed:true});
});
routes.post('/documents/:id/review',staffOnly,async(req,res)=>{
 const {status,reason}=req.body;if(!['ACCEPTED','REJECTED'].includes(status)||status==='REJECTED'&&(typeof reason!=='string'||!reason.trim()||reason.length>5000))fail('Choose accept/reject; rejection requires a reason.');
 await transaction(async c=>{
  const [lookup]=await c.execute('SELECT r.case_id FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE v.id=?',[req.params.id]);if(!lookup.length)fail('Document not found.',404);
  const file=await loadCase(c,lookup[0].case_id,req.user,true);writable(file,req.user);
  const [rows]=await c.execute('SELECT v.*,r.definition FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE v.id=? FOR UPDATE',[req.params.id]);const v=rows[0];
  const [latest]=await c.execute('SELECT id FROM document_versions WHERE requirement_id=? ORDER BY version DESC LIMIT 1',[v.requirement_id]);
  if(Number(latest[0].id)!==Number(v.id)||v.status!=='PENDING')fail('Only the latest pending version can be reviewed.',409);
  await c.execute('UPDATE document_versions SET status=?,reason=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?',[status,status==='REJECTED'?reason.trim():null,req.user.id,v.id]);
  const label=json(v.definition).label,description=label+' '+status.toLowerCase()+' (version '+v.version+').'+(status==='REJECTED'?' Reason: '+reason:'');
  const e=await event(c,file.id,req.user,'DOCUMENT_'+status,description,true);await notify(c,file.client_user_id,file.id,`review:${e}`,description);await queueEmail(c,file,`review:${v.id}`,status==='REJECTED'?'Document needs correction':'Document approved',description+(status==='REJECTED'?' Please upload a corrected version in your client portal.':''));await refresh(c,file,req.user);
 });res.json({reviewed:true});
});
routes.post('/cases/:id/status',manage,async(req,res)=>{
 const {status,reason}=req.body;if(!['COLLECTING','APPROVED','SUBMITTED','COMPLETED','CANCELLED'].includes(status))fail('Invalid processing status.');
 await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);const progress=await refresh(c,file,req.user);const current=(await loadCase(c,file.id,null)).status;
  if(status==='APPROVED'&&(!progress.ready||current!=='READY_FOR_MANAGER_REVIEW'))fail('All mandatory requirements must be satisfied before manager approval.',409);
  if(status==='SUBMITTED'&&current!=='APPROVED'||status==='COMPLETED'&&current!=='SUBMITTED')fail('Approve, then submit, then complete the file.',409);
  if(['COLLECTING','CANCELLED'].includes(status)&&(typeof reason!=='string'||!reason.trim()))fail('Provide a reason.');
  await c.execute('UPDATE cases SET status=?,approved_by=?,approved_at=? WHERE id=?',[status,status==='APPROVED'?req.user.id:status==='COLLECTING'?null:file.approved_by,status==='APPROVED'?new Date():status==='COLLECTING'?null:file.approved_at,file.id]);
  await event(c,file.id,req.user,'CASE_'+status,'Application status: '+status+(reason?' — '+reason:''),true);
 });res.json({saved:true});
});
routes.post('/cases/:id/tasks',staffOnly,async(req,res)=>{if(typeof req.body.title!=='string'||!req.body.title.trim()||req.body.title.length>240)fail('Enter task title.');await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);let agent=null;if(req.body.assignedTo){agent=await assignee(c,req.body.assignedTo,file,req.user);if(req.user.role==='AGENT'&&agent.id!==req.user.id)fail('Agents can assign tasks to themselves only.',403);}const [r]=await c.execute('INSERT INTO tasks (case_id,title,assigned_to,due_at,created_by) VALUES (?,?,?,?,?)',[file.id,req.body.title,agent?.id || file.assigned_to,req.body.dueAt?new Date(req.body.dueAt):null,req.user.id]);await event(c,file.id,req.user,'TASK_CREATED',req.body.title);await notify(c,agent?.id || file.assigned_to,file.id,`task:${r.insertId}`,'Task assigned: '+req.body.title);});res.status(201).json({saved:true});});
routes.patch('/tasks/:id',staffOnly,async(req,res)=>{if(!['OPEN','DONE'].includes(req.body.status))fail('Invalid task status.');await transaction(async c=>{const [rows]=await c.execute('SELECT * FROM tasks WHERE id=?',[req.params.id]);if(!rows.length)fail('Task not found.',404);await loadCase(c,rows[0].case_id,req.user,true);await c.execute('UPDATE tasks SET status=? WHERE id=?',[req.body.status,req.params.id]);await event(c,rows[0].case_id,req.user,'TASK_UPDATED',rows[0].title+' — '+req.body.status);});res.json({saved:true});});
routes.get('/tasks',staffOnly,async(req,res)=>{const [where,args]=scope(req.user);const [rows]=await db.execute(`SELECT t.*,c.client_name FROM tasks t JOIN cases c ON c.id=t.case_id WHERE ${where} ORDER BY t.status,t.due_at`,args);res.json(rows);});
routes.get('/documents/inbox',staffOnly,async(req,res)=>{const [where,args]=scope(req.user);const [rows]=await db.execute(`SELECT v.id,v.original_name,v.created_at,r.case_id,r.definition,c.client_name FROM document_versions v JOIN requirements r ON r.id=v.requirement_id JOIN cases c ON c.id=r.case_id WHERE ${where} AND v.status='PENDING' AND r.waived=0 AND v.version=(SELECT MAX(v2.version) FROM document_versions v2 WHERE v2.requirement_id=r.id) ORDER BY v.created_at`,args);res.json(rows.map(r=>({...r,definition:json(r.definition)})));});
routes.get('/communications',staffOnly,async(req,res)=>{const [where,args]=scope(req.user);const [rows]=await db.execute(`SELECT e.id,e.case_id,e.status,e.attempts,e.last_error,e.created_at,c.client_name FROM email_outbox e JOIN cases c ON c.id=e.case_id WHERE ${where} ORDER BY e.id DESC LIMIT 250`,args);res.json(rows);});
routes.post('/cases/:id/notes',staffOnly,async(req,res)=>{if(typeof req.body.message!=='string'||!req.body.message.trim()||req.body.message.length>10000)fail('Enter an internal note.');await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);await event(c,file.id,req.user,'INTERNAL_NOTE',req.body.message);});res.status(201).json({saved:true});});
routes.post('/cases/:id/messages',async(req,res)=>{if(typeof req.body.message!=='string'||!req.body.message.trim()||req.body.message.length>10000)fail('Enter your message.');await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);const e=await event(c,file.id,req.user,'PORTAL_MESSAGE',req.user.name+': '+req.body.message,true);await notify(c,req.user.role==='CLIENT'?file.assigned_to:file.client_user_id,file.id,`message:${e}`,'New application message.');});res.status(201).json({saved:true});});
routes.post('/cases/:id/email',staffOnly,async(req,res)=>{if(typeof req.body.subject!=='string'||!req.body.subject.trim()||req.body.subject.length>240||typeof req.body.message!=='string'||!req.body.message.trim()||req.body.message.length>10000)fail('Enter email subject and message.');await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);if(!file.ghl_contact_id&&(await emailSettings()).provider==='GHL')fail('Link a CRM contact first, or select SMTP in Settings.');const e=await event(c,file.id,req.user,'EMAIL_QUEUED','Email queued: '+req.body.subject,true);await queueEmail(c,file,`manual-email:${e}`,req.body.subject,req.body.message);});res.status(202).json({queued:true});});
routes.patch('/cases/:id/contact',manage,async(req,res)=>{if(typeof req.body.contactId!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(req.body.contactId))fail('Enter CRM contact ID.');await loadCase(db,req.params.id,req.user);await verifyContact(req.body.contactId);await transaction(async c=>{const file=await loadCase(c,req.params.id,req.user,true);await c.execute('UPDATE cases SET ghl_contact_id=? WHERE id=?',[req.body.contactId,file.id]);await c.execute("UPDATE email_outbox SET recipient_contact_id=? WHERE case_id=? AND status IN ('QUEUED','FAILED')",[req.body.contactId,file.id]);await event(c,file.id,req.user,'CRM_CONTACT_LINKED','CRM contact identity linked.');});res.json({saved:true});});
routes.get('/cases/:id/crm-messages',staffOnly,async(req,res)=>{const file=await loadCase(db,req.params.id,req.user);if(!file.ghl_contact_id)fail('Link a CRM contact first.');await verifyContact(file.ghl_contact_id);const config=await credentials();const found=await crm('/conversations/search?'+new URLSearchParams({locationId:config.locationId,contactId:file.ghl_contact_id}));const conv=found.conversations?.find(c=>c.contactId===file.ghl_contact_id && c.locationId===config.locationId);if(!conv)return res.json({messages:[]});const cursor=req.query.lastMessageId;if(cursor!==undefined&&(typeof cursor!=='string'||cursor.length>160||!/^[a-zA-Z0-9_-]+$/.test(cursor)))fail('Invalid message cursor.');const query=new URLSearchParams({limit:'50',...(cursor?{lastMessageId:cursor}:{})});const result=await crm('/conversations/'+encodeURIComponent(conv.id)+'/messages?'+query);res.json({messages:result.messages?.messages || [],nextPage:!!result.messages?.nextPage,lastMessageId:result.messages?.lastMessageId || null});});
routes.get('/emails/:id',staffOnly,async(req,res)=>{
 const [rows]=await db.execute('SELECT * FROM email_outbox WHERE id=?',[req.params.id]);if(!rows.length)fail('Email not found.',404);const email=rows[0];const file=await loadCase(db,email.case_id,req.user);const payload=JSON.parse(decrypt(email.payload_encrypted));
 const message=String(payload.message || '').replace(/(Temporary password:\s*)\S+/gi,'$1[hidden]').replace(/(token=)[^\s&]+/gi,'$1[hidden]');
 await db.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'EMAIL_VIEWED',JSON.stringify({caseId:email.case_id,emailId:email.id})]);
 res.json({id:email.id,subject:payload.subject,recipient:payload.emailTo || file.client_email,message,status:email.status,createdAt:email.created_at,sentAt:email.sent_at,nextAttemptAt:email.next_attempt_at,attempts:email.attempts,lastError:email.last_error,providerMessageId:email.provider_message_id});
});
routes.post('/emails/:id/retry',staffOnly,async(req,res)=>{await transaction(async c=>{const [rows]=await c.execute('SELECT * FROM email_outbox WHERE id=?',[req.params.id]);if(!rows.length)fail('Queued email not found.',404);await loadCase(c,rows[0].case_id,req.user,true);if(!['FAILED','UNKNOWN'].includes(rows[0].status))fail('Only failed or uncertain sends can be retried.');if(rows[0].status==='UNKNOWN'&&req.body.checkedCrm!==true)fail('Check your email provider for delivery before retrying an uncertain send.');await c.execute("UPDATE email_outbox SET status='QUEUED',next_attempt_at=NOW(),last_error=NULL WHERE id=?",[req.params.id]);await event(c,rows[0].case_id,req.user,'EMAIL_RETRY','Email retry requested after delivery check.');});res.json({queued:true});});
routes.get('/notifications',async(req,res)=>{const [where,args]=scope(req.user);const [rows]=await db.execute(`SELECT n.* FROM notifications n LEFT JOIN cases c ON c.id=n.case_id WHERE n.user_id=? AND (n.case_id IS NULL OR (${where})) ORDER BY n.id DESC LIMIT 100`,[req.user.id,...args]);res.json(rows);});
routes.post('/notifications/:id/read',async(req,res)=>{await db.execute('UPDATE notifications SET read_at=NOW() WHERE id=? AND user_id=?',[req.params.id,req.user.id]);res.json({saved:true});});
routes.get('/dashboard',async(req,res)=>{
 const [where,args]=scope(req.user);const [statuses]=await db.execute(`SELECT status,COUNT(*) AS total FROM cases c WHERE ${where} GROUP BY status`,args);
 const [overdue]=await db.execute(`SELECT COUNT(*) AS total FROM cases c WHERE ${where} AND due_at<NOW() AND status NOT IN ('COMPLETED','CANCELLED')`,args);
 const [pending]=await db.execute(`SELECT COUNT(*) AS total FROM document_versions v JOIN requirements r ON r.id=v.requirement_id JOIN cases c ON c.id=r.case_id WHERE ${where} AND v.status='PENDING' AND v.version=(SELECT MAX(v2.version) FROM document_versions v2 WHERE v2.requirement_id=r.id)`,args);
 const [performance]=req.user.role==='CLIENT'?[[]]:await db.execute(`SELECT u.name,COUNT(c.id) AS cases,SUM(c.status='COMPLETED') AS completed,SUM(c.due_at<NOW() AND c.status NOT IN ('COMPLETED','CANCELLED')) AS overdue FROM cases c LEFT JOIN users u ON u.id=c.assigned_to WHERE ${where} GROUP BY u.id,u.name`,args);
 res.json({statuses,overdue:overdue[0].total,pending:pending[0].total,performance});
});
routes.get('/audit',manage,async(req,res)=>{if(req.user.role==='ADMIN'){const [rows]=await db.query('SELECT * FROM audit_events ORDER BY id DESC LIMIT 250');return res.json(rows);}const [rows]=await db.execute('SELECT e.action,e.description,e.created_at,u.email AS actor FROM case_events e JOIN cases c ON c.id=e.case_id LEFT JOIN users u ON u.id=e.actor_id WHERE c.team_id=? ORDER BY e.id DESC LIMIT 250',[req.user.team_id || 0]);res.json(rows);});
routes.post('/maintenance',permit('ADMIN'),async(req,res)=>{await runJobs();res.json({processed:true,emailDeliveryEnabled:!!(await emailSettings()).enabled});});
