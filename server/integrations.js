import {Router} from 'express';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {db} from './db.js';
import {hashPassword} from './auth.js';
import {json,eligible,fail} from './domain.js';
import {transaction,createCase,invite,event,loadCase} from './workflow.js';
import {contractSecret} from './connection.js';
import {verifyDossier,normalizeDossier,dossierEligibility} from './dossier.js';
export const publicRoutes=Router();
publicRoutes.post('/auth/activate',async(req,res)=>{
 const {token,password}=req.body;if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<12||password.length>128)fail('Use a valid invitation and a password of 12â€“128 characters.');
 await transaction(async c=>{
  const hash=createHash('sha256').update(token).digest('hex');const [invites]=await c.execute('SELECT * FROM invitations WHERE token_hash=? AND used_at IS NULL AND expires_at>NOW() FOR UPDATE',[hash]);if(!invites.length)fail('Invitation has expired or was already used.',410);
  const invitation=invites[0];const file=await loadCase(c,invitation.case_id,null,true);const [existing]=await c.execute('SELECT id FROM users WHERE email=?',[invitation.email]);if(existing.length)fail('An account already exists. Log in or ask Operations for a password reset.',409);
  const [result]=await c.execute("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'CLIENT')",[file.client_name,invitation.email,await hashPassword(password)]);
  await c.execute('UPDATE cases SET client_user_id=? WHERE client_email=?',[result.insertId,invitation.email]);await c.execute('UPDATE invitations SET used_at=NOW() WHERE token_hash=?',[hash]);await event(c,file.id,{id:result.insertId,email:invitation.email},'PORTAL_ACTIVATED','Client portal activated.',true);
 });res.status(201).json({activated:true});
});
export async function handoff(req,res) {
 const secret=await contractSecret();if(!secret||secret.length<32)fail('Contract integration secret is not configured.',503);
 const dossier=req.headers['x-webhook-signature']!==undefined;
 let data;
 if(dossier){verifyDossier(req,secret);if(['ping','webhook.ping','test.ping'].includes(req.body?.event)){await db.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',['contract-manager','CONTRACT_WEBHOOK_PING',JSON.stringify({message:'Signed test ping received'})]);return res.json({ok:true,service:'operations',test:true});}data=normalizeDossier(req.body);}
 else {
 const timestamp=req.headers['x-contract-timestamp'],signature=req.headers['x-contract-signature'];
 if(typeof timestamp!=='string'||typeof signature!=='string'||!/^\d+$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^sha256=[a-f0-9]{64}$/.test(signature))fail('Invalid webhook signature or timestamp.',401);
 const expected=createHmac('sha256',secret).update(timestamp+'.').update(req.rawBody).digest('hex');if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature.slice(7))))fail('Invalid webhook signature.',401);
 data=req.body;}
 for(const key of ['eventId','contractId','opportunityId','contactId'])if(typeof data[key]!=='string'||!data[key]||data[key].length>120)fail('Invalid '+key);
 const result=await transaction(async c=>{
  const [settings]=await c.query('SELECT settings FROM application_settings WHERE id=1 FOR UPDATE');
  const [previous]=await c.execute('SELECT * FROM handoff_events WHERE event_id=?',[data.eventId]);if(previous.length){const dateExcluded=dossier&&previous[0].result==='Outside activation period'&&!previous[0].intake_id;if(!dateExcluded)return {duplicate:true,intakeId:previous[0].intake_id,result:previous[0].result};await c.execute('DELETE FROM handoff_events WHERE event_id=?',[data.eventId]);}
  const policy=json(settings[0].settings);const reason=dossier?dossierEligibility(data,policy):eligible(data,policy);
  const [existing]=await c.execute('SELECT id FROM contract_intake WHERE contract_id=? OR opportunity_id=?',[data.contractId,data.opportunityId]);
  if(reason||existing.length){const result=reason || 'Duplicate contract or opportunity';await c.execute('INSERT INTO handoff_events (event_id,contract_id,result,intake_id) VALUES (?,?,?,?)',[data.eventId,data.contractId,result,existing[0]?.id || null]);return {skipped:true,result,intakeId:existing[0]?.id};}
  if(typeof data.clientName!=='string'||!data.clientName.trim()||data.clientName.length>200||typeof data.clientEmail!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.clientEmail)||data.clientEmail.length>254)fail('Completed summary must contain client name and email.');
  const [received]=await c.execute('INSERT INTO contract_intake (contract_id,opportunity_id,client_name,client_email,payload) VALUES (?,?,?,?,?)',[data.contractId,data.opportunityId,data.clientName.trim(),data.clientEmail.trim().toLowerCase(),JSON.stringify(data)]);
  await c.execute('INSERT INTO handoff_events (event_id,contract_id,result,intake_id) VALUES (?,?,?,?)',[data.eventId,data.contractId,'AWAITING_INITIATION',received.insertId]);
  await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',['contract-manager','CLIENT_SUMMARY_RECEIVED',JSON.stringify({intakeId:received.insertId,contractId:data.contractId})]);
  return {received:true,intakeId:received.insertId,status:'AWAITING_INITIATION'};
 });res.json(result);
}
