import {db} from './db.js';
import {decrypt} from './crypto.js';
import {emailSettings,deliverEmail} from './email.js';
import {transaction,notify,queueEmail} from './workflow.js';
export async function runJobs({send}={}) {
 await db.query('DELETE FROM sessions WHERE expires_at<NOW()');
 await transaction(async c=>{
  const [tasks]=await c.query("SELECT * FROM tasks WHERE status='OPEN' AND due_at<NOW()");
  for(const t of tasks)await notify(c,t.assigned_to,t.case_id,`overdue-task:${t.id}`,'Task overdue: '+t.title);
  const [cases]=await c.query("SELECT * FROM cases WHERE due_at<NOW() AND status NOT IN ('COMPLETED','CANCELLED')");
  for(const f of cases){await notify(c,f.assigned_to,f.id,`overdue-case:${f.id}`,'Client file is overdue.');if(f.status==='COLLECTING')await queueEmail(c,f,`reminder:${f.id}:${new Date().toISOString().slice(0,10)}`,'Reminder: outstanding application requirements','Please open your client portal and complete the outstanding information and documents. Contact the Operations team if you need help.');}
 });
 // A crashed send has an uncertain outcome. Do not automatically send it twice.
 await db.query("UPDATE email_outbox SET status='UNKNOWN',last_error='Interrupted send. Check your email provider before retrying.' WHERE status='SENDING' AND next_attempt_at<DATE_SUB(NOW(),INTERVAL 10 MINUTE)");
 const config=await emailSettings();if(!(send ?? !!config.enabled))return;
 for(let i=0;i<10;i++) {
  const job=await transaction(async c=>{const [rows]=await c.query("SELECT * FROM email_outbox WHERE status='QUEUED' AND next_attempt_at<=NOW() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");if(!rows.length)return null;await c.execute("UPDATE email_outbox SET status='SENDING',attempts=attempts+1,next_attempt_at=NOW() WHERE id=?",[rows[0].id]);return rows[0];});
  if(!job)break;
  try {const result=await deliverEmail(job.recipient_contact_id,JSON.parse(decrypt(job.payload_encrypted)),config);await db.execute("UPDATE email_outbox SET status='SENT',provider_message_id=?,last_error=NULL WHERE id=?",[(result.messageId || result.emailMessageId || '').slice(0,120) || null,job.id]);}
  catch(e){const retry=(e.providerStatus===429 || e.smtpStatus>=400&&e.smtpStatus<500)&&job.attempts<4;const uncertain=e.ambiguous || e.providerStatus>=500;await db.execute('UPDATE email_outbox SET status=?,last_error=?,next_attempt_at=DATE_ADD(NOW(),INTERVAL 5 MINUTE) WHERE id=?',[uncertain?'UNKNOWN':retry?'QUEUED':'FAILED',e.message.slice(0,500),job.id]);}
 }
}
if(process.argv[1]?.endsWith('jobs.js')) {try {await runJobs();console.log('Maintenance and notification queue processed.');}finally{await db.end();}}
