import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(await readFile(new URL('../public/unified-conversation.js',import.meta.url),'utf8'),context);
test('CRM, portal and queued emails merge chronologically without hiding unsent emails',()=>{
 const data={file:{client_user_id:9},events:[{id:1,action:'PORTAL_MESSAGE',actor_id:9,created_at:'2026-10-12T12:00:00Z',description:'Portal reply'},{id:2,action:'INTERNAL_NOTE',description:'Private note'}]};
 const rows=context.mergeConversationRows(data,[{id:'crm-sent',dateAdded:'2026-10-10T12:00:00Z',body:'Older CRM message',direction:'inbound'}],[{id:1,providerMessageId:'crm-sent',status:'SENT',message:'Duplicate',createdAt:'2026-10-10T12:00:00Z'},{id:2,status:'QUEUED',message:'Not sent yet',createdAt:'2026-10-13T12:00:00Z'}]);
 assert.equal(rows.length,3);assert.equal(rows[0].source,'CRM');assert.equal(rows[1].source,'Portal update');assert.equal(rows[1].direction,'incoming');assert.equal(rows[2].status,'QUEUED');assert.ok(!rows.some(r=>r.body==='Private note'));
});
