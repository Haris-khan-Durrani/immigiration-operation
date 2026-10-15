import {db} from './db.js';
import {decrypt} from './crypto.js';
import {fail} from './domain.js';
export async function credentials() {const [rows]=await db.query('SELECT * FROM integration_settings WHERE id=1');if(!rows.length)fail('Configure CRM credentials in Settings.',409);return {locationId:rows[0].location_id,token:decrypt(rows[0].token_encrypted)};}
export async function crm(path,{method='GET',body,version='2021-07-28'}={}) {
 const {token}=await credentials();let response;
 try {response=await fetch('https://services.leadconnectorhq.com'+path,{method,headers:{Authorization:`Bearer ${token}`,Version:version,Accept:'application/json',...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});}catch{const e=new Error('CRM connection timed out or failed.');e.ambiguous=true;throw e;}
 if(!response.ok){const e=new Error(`CRM returned HTTP ${response.status}. Check connection and required scopes.`);e.providerStatus=response.status;throw e;}
 return response.json();
}
export async function verifyContact(contactId) {const config=await credentials();const result=await crm('/contacts/'+encodeURIComponent(contactId));if(result.contact?.locationId!==config.locationId)fail('CRM contact does not belong to the configured location.',409);return result.contact;}
export async function sendEmail(contactId,payload) {
 await verifyContact(contactId);
 return crm('/conversations/messages',{method:'POST',body:{type:'Email',contactId,subject:payload.subject,message:payload.message,html:'<p>'+payload.message.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\n/g,'<br>')+'</p>',...(payload.emailTo?{emailTo:payload.emailTo}:{})}});
}
