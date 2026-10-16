import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({esc:v=>String(v)});
vm.runInContext(await readFile(new URL('../public/client-documents.js',import.meta.url),'utf8'),context);
const requirement={id:1,definition:{type:'file',required:true},applicable:true,waived:false};
const data=documents=>({file:{status:'COLLECTING'},requirements:[requirement],documents});
test('client upload progress distinguishes receipt from approval',()=>{
 const input=data([{requirement_id:1,version:1,status:'PENDING'}]),state=context.clientDocumentState(input);
 assert.equal(state.uploaded,1);assert.equal(state.accepted,0);assert.equal(state.pending,1);assert.equal(state.next,undefined);
 const html=context.clientDocumentOverview(input);assert.ok(html.includes('Your documents have been received'));assert.ok(html.includes('1 of 1 required documents uploaded'));assert.ok(!html.includes('0% complete'));
});
test('corrections and missing documents drive the next client step using latest versions',()=>{
 const input=data([{requirement_id:1,version:2,status:'REJECTED'},{requirement_id:1,version:1,status:'ACCEPTED'}]);
 assert.equal(context.clientDocumentState(input).corrections,1);assert.equal(context.clientDocumentState(input).next.id,1);assert.ok(context.clientDocumentOverview(input).includes('Review changes'));
 input.documents[0].status='REMOVED';assert.equal(context.clientDocumentState(input).missing,1);assert.equal(context.clientDocumentState(input).uploaded,0);
});
test('optional, waived and hidden requirements do not block required upload progress',()=>{
 const input=data([]);input.requirements=[{...requirement,waived:true},{...requirement,id:2,applicable:false},{...requirement,id:3,definition:{type:'file',required:false}}];
 const state=context.clientDocumentState(input);assert.equal(state.total,0);assert.equal(state.missing,0);assert.equal(state.next.id,3);
 input.file.status='COMPLETED';assert.ok(!context.clientDocumentOverview(input).includes('id="client-next-document"'));
});
