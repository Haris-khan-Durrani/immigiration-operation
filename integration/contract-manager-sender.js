// Import this adapter in the Contract Manager worker AFTER its completed-summary
// transaction commits. Persist events in its own transactional outbox first.
import {createHmac} from 'node:crypto';
export async function deliverOperationsEvent(event,{operationsUrl,secret}) {
 if(!secret || secret.length<32)throw new Error('A shared Contract Manager webhook secret is required.');
 const timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify(event);
 const signature='sha256='+createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
 const response=await fetch(new URL('/api/integrations/contracts/events',operationsUrl),{method:'POST',headers:{'Content-Type':'application/json','X-Contract-Timestamp':timestamp,'X-Contract-Signature':signature},body,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Operations handoff returned HTTP '+response.status);
 return response.json();
}
