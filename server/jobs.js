import {db} from './db.js';
import {decrypt,encrypt} from './crypto.js';
import {emailSettings,deliverEmail} from './email.js';
import {missingDocumentLabels} from './domain.js';
import {portalBase} from './connection.js';
import {transaction,notify,queueEmail} from './workflow.js';
export async function runJobs({send}={}) {
 await db.query('DELETE FROM sessions WHERE expires_at<NOW()');
 await db.query('DELETE FROM notifications WHERE created_at<DATE_SUB(NOW(),INTERVAL 30 DAY)');
 await db.query("DELETE n FROM notifications n JOIN tasks t ON n.event_key=CONCAT('task:',t.id) OR n.event_key=CONCAT('overdue-task:',t.id) WHERE t.status='DONE'");
 await db.query("DELETE FROM tasks WHERE status='DONE'");
 await transaction(async c=>{
  const [tasks]=await c.query("SELECT t.* FROM tasks t JOIN cases c ON c.id=t.case_id WHERE t.status='OPEN' AND t.due_at<NOW() AND c.status!='DELETED'");
  for(const t of tasks)await notify(c,t.assigned_to,t.case_id,`overdue-task:${t.id}`,'Task overdue: '+t.title);
  const [cases]=await c.query("SELECT * FROM cases WHERE due_at<NOW() AND status NOT IN ('DELETED','COMPLETED','CANCELLED')");
  for(const f of cases)await notify(c,f.assigned_to,f.id,`overdue-case:${f.id}`,'Client file is overdue.');
  const portal=await portalBase();
  const [scheduled]=await c.query("SELECT * FROM cases WHERE reminder_every_hours IS NOT NULL AND next_reminder_at<=NOW() AND status NOT IN ('DELETED','COMPLETED','CANCELLED','SUBMITTED') FOR UPDATE");
  for(const f of scheduled){const [requirements]=await c.execute('SELECT * FROM requirements WHERE case_id=?',[f.id]);const [documents]=await c.execute('SELECT v.* FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE r.case_id=? ORDER BY v.version DESC',[f.id]);const missing=missingDocumentLabels(requirements,documents);const [pending]=await c.execute("SELECT id FROM email_outbox WHERE case_id=? AND event_key LIKE ? AND status IN ('QUEUED','SENDING','FAILED','UNKNOWN') LIMIT 1",[f.id,`document-reminder:${f.id}:%`]);if(missing.length&&!pending.length){const key=`document-reminder:${f.id}:${new Date(f.next_reminder_at).toISOString()}`;await queueEmail(c,f,key,'Reminder: documents needed for your application','Please upload these documents in your client portal:\n'+missing.map(name=>'- '+name).join('\n')+'\nPortal: '+portal);await notify(c,f.client_user_id,f.id,key,'Please upload your outstanding documents.');}await c.execute('UPDATE cases SET next_reminder_at=DATE_ADD(NOW(),INTERVAL ? HOUR) WHERE id=?',[f.reminder_every_hours,f.id]);}
  const [expiries]=await c.query("SELECT e.*,DATE_FORMAT(e.expires_on,'%Y-%m-%d') AS expiry_date,e.expires_on<=CURDATE() AS expired FROM case_expiries e JOIN cases c ON c.id=e.case_id WHERE e.next_notice_at<=NOW() AND c.status NOT IN ('DELETED','COMPLETED','CANCELLED') FOR UPDATE");
  for(const expiry of expiries){const [files]=await c.execute('SELECT * FROM cases WHERE id=?',[expiry.case_id]);const [pending]=await c.execute("SELECT id FROM email_outbox WHERE case_id=? AND event_key LIKE ? AND status IN ('QUEUED','SENDING','FAILED','UNKNOWN') LIMIT 1",[expiry.case_id,`expiry:${expiry.id}:%`]);if(pending.length){await c.execute('UPDATE case_expiries SET next_notice_at=DATE_ADD(NOW(),INTERVAL 1 DAY) WHERE id=?',[expiry.id]);continue;}const f=files[0],key=`expiry:${expiry.id}:${new Date(expiry.next_notice_at).toISOString()}`,text=expiry.label+(expiry.expired?' has expired':' expires on '+expiry.expiry_date)+'. Please contact your Operations team about renewal. Portal: '+portal;await queueEmail(c,f,key,expiry.expired?'Expiry alert: '+expiry.label:'Upcoming expiry: '+expiry.label,text);await notify(c,f.client_user_id,f.id,key,text);await notify(c,f.assigned_to,f.id,key,text);await c.execute('UPDATE case_expiries SET last_notice_at=NOW(),next_notice_at=IF(?,NULL,LEAST(DATE_ADD(NOW(),INTERVAL ? DAY),expires_on)) WHERE id=?',[!!expiry.expired,expiry.repeat_days,expiry.id]);}

 });
 // A crashed send has an uncertain outcome. Do not automatically send it twice.
 await db.query("UPDATE email_outbox SET status='UNKNOWN',last_error='Interrupted send. Check your email provider before retrying.' WHERE status='SENDING' AND next_attempt_at<DATE_SUB(NOW(),INTERVAL 10 MINUTE)");
 const config=await emailSettings();if(!(send ?? !!config.enabled))return;
 for(let i=0;i<10;i++) {
  const job=await transaction(async c=>{const [rows]=await c.query("SELECT * FROM email_outbox WHERE status='QUEUED' AND next_attempt_at<=NOW() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");if(!rows.length)return null;await c.execute("UPDATE email_outbox SET status='SENDING',attempts=attempts+1,next_attempt_at=NOW() WHERE id=?",[rows[0].id]);return rows[0];});
  if(!job)break;
  try {const payload=JSON.parse(decrypt(job.payload_encrypted));if(job.event_key.startsWith('document-reminder:')){const [files]=await db.execute('SELECT * FROM cases WHERE id=?',[job.case_id]);const f=files[0];const [requirements]=await db.execute('SELECT * FROM requirements WHERE case_id=?',[job.case_id]);const [docs]=await db.execute('SELECT v.* FROM document_versions v JOIN requirements r ON r.id=v.requirement_id WHERE r.case_id=?',[job.case_id]);const missing=missingDocumentLabels(requirements,docs);if(!f?.reminder_every_hours||['DELETED','COMPLETED','CANCELLED','SUBMITTED'].includes(f.status)||!missing.length){await db.execute("UPDATE email_outbox SET status='CANCELLED',last_error='Reminder no longer needed.' WHERE id=?",[job.id]);continue;}payload.message='Please upload these documents in your client portal:\n'+missing.map(name=>'- '+name).join('\n')+'\nPortal: '+await portalBase();}await db.execute('UPDATE email_outbox SET payload_encrypted=? WHERE id=?',[encrypt(JSON.stringify(payload)),job.id]);const result=await deliverEmail(job.recipient_contact_id,payload,config);await db.execute("UPDATE email_outbox SET status='SENT',sent_at=NOW(),provider_message_id=?,last_error=NULL WHERE id=?",[(result.messageId || result.emailMessageId || '').slice(0,120) || null,job.id]);}
  catch(e){const retry=(e.providerStatus===429 || e.smtpStatus>=400&&e.smtpStatus<500)&&job.attempts<4;const uncertain=e.ambiguous || e.providerStatus>=500;await db.execute('UPDATE email_outbox SET status=?,last_error=?,next_attempt_at=DATE_ADD(NOW(),INTERVAL 5 MINUTE) WHERE id=?',[uncertain?'UNKNOWN':retry?'QUEUED':'FAILED',e.message.slice(0,500),job.id]);}
 }
}
if(process.argv[1]?.endsWith('jobs.js')) {try {await runJobs();console.log('Maintenance and notification queue processed.');}finally{await db.end();}}
