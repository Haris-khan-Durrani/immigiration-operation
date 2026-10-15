const {createHmac,createHash}=require('node:crypto');
function createService({db,ghlService,env=process.env,send=fetch}) {
 let timer,busy=false;
 function config(){return {enabled:env.OPERATIONS_HANDOFF_ENABLED==='true',url:env.OPERATIONS_APP_URL,secret:env.OPERATIONS_WEBHOOK_SECRET,activation:env.OPERATIONS_ACTIVATION_DATE};}
 async function ensureSchema(){if(db.driver!=='MYSQL')throw new Error('Operations handoff requires the configured MySQL database.');await db.execute(`CREATE TABLE IF NOT EXISTS operations_summary_outbox (event_id VARCHAR(120) PRIMARY KEY,contract_id INT NOT NULL,location_id VARCHAR(64) NOT NULL,payload_json LONGTEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',attempts INT NOT NULL DEFAULT 0,next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,last_error VARCHAR(500) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY(contract_id,location_id)) ENGINE=InnoDB`);}
 async function enqueue(connection,contract,summary,completedAt,previousStatus){
  const c=config();if(!c.enabled)return {queued:false};
  if(!c.url||!c.secret||c.secret.length<32||!c.activation||isNaN(Date.parse(c.activation)))throw new Error('Configure Operations URL, secret and activation date before enabling handoff.');
  if(db.driver!=='MYSQL')throw new Error('Operations handoff requires MySQL.');
  if(previousStatus==='COMPLETED'||contract.state!=='COMPLETED'&&!contract.signed_at||!contract.ghl_opportunity_id)return {queued:false};
  const created=Date.parse(contract.created_at),activation=Date.parse(c.activation);if(!Number.isFinite(created)||created<activation)return {queued:false};
  const [prior]=await connection.execute("SELECT COUNT(*) AS n FROM contract_instances WHERE location_id=? AND ghl_contact_id=? AND id<>? AND (state='COMPLETED' OR signed_at IS NOT NULL) AND (created_at<? OR (created_at=? AND id<?))",[contract.location_id,contract.ghl_contact_id,contract.id,contract.created_at,contract.created_at,contract.id]);if(prior[0].n)return {queued:false};
  const eventId='summary-'+createHash('sha256').update(contract.location_id+':'+contract.id).digest('hex');
  const payload={eventId,contractId:String(contract.id),opportunityId:contract.ghl_opportunity_id,contactId:contract.ghl_contact_id,clientName:contract.recipient_name || summary.client_name,clientEmail:contract.recipient_email || summary.email,contractStatus:'COMPLETED',summaryStatus:'COMPLETED',isNewClient:true,procedureEligible:true,completedAt,summary,contractUrl:contract.ghl_file_url && /^https:\/\//.test(contract.ghl_file_url)?contract.ghl_file_url:undefined};
  if(!payload.clientName||!payload.clientEmail)throw new Error('Client name and email are required before Operations handoff.');
  await connection.execute('INSERT IGNORE INTO operations_summary_outbox (event_id,contract_id,location_id,payload_json) VALUES (?,?,?,?)',[eventId,contract.id,contract.location_id,JSON.stringify(payload)]);return {queued:true};
 }
 async function processQueue(){if(busy||!config().enabled)return;busy=true;try{
  await ensureSchema();const [rows]=await db.execute("SELECT * FROM operations_summary_outbox WHERE status='QUEUED' AND next_attempt_at<=NOW() ORDER BY created_at LIMIT 10");
  for(const row of rows){try{const c=config(),payload=JSON.parse(row.payload_json),opportunity=await ghlService.getOpportunity(row.location_id,payload.opportunityId);if(!opportunity.pipelineId)throw new Error('Opportunity pipeline could not be verified.');payload.pipelineId=opportunity.pipelineId;
    const timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify(payload),signature='sha256='+createHmac('sha256',c.secret).update(timestamp+'.'+body).digest('hex');
    const response=await send(new URL('/api/integrations/contracts/events',c.url),{method:'POST',headers:{'Content-Type':'application/json','X-Contract-Timestamp':timestamp,'X-Contract-Signature':signature},body,signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Operations returned HTTP '+response.status);const result=await response.json();
    await db.execute('UPDATE operations_summary_outbox SET status=?,attempts=attempts+1,last_error=? WHERE event_id=?',[result.skipped?'SKIPPED':'SENT',result.skipped?String(result.result || 'Skipped by Operations').slice(0,500):null,row.event_id]);
   }catch(e){const attempts=row.attempts+1;await db.execute("UPDATE operations_summary_outbox SET attempts=?,status=?,next_attempt_at=DATE_ADD(NOW(),INTERVAL ? SECOND),last_error=? WHERE event_id=?",[attempts,attempts>=10?'FAILED':'QUEUED',Math.min(3600,30*2**attempts),e.name==='TimeoutError'?'Operations delivery timed out':e.message.slice(0,500),row.event_id]);}}
 }finally{busy=false;}}
 async function start(){if(!config().enabled)return;await ensureSchema();timer=setInterval(()=>processQueue().catch(e=>console.warn('[Operations handoff]',e.message)),60000);timer.unref();processQueue().catch(e=>console.warn('[Operations handoff]',e.message));}
 function stop(){if(timer)clearInterval(timer);}
 return {enqueue,ensureSchema,processQueue,start,stop};
}
module.exports={createService};
