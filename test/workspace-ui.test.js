import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({});vm.runInContext(await readFile(new URL('../public/workspace-ui.js',import.meta.url),'utf8'),context);
test('activity colours distinguish rejection, success, attention and informational events',()=>{
 for(const action of ['DOCUMENT_REJECTED','DOCUMENT_REMOVED','CASE_CANCELLED'])assert.equal(context.activityTone(action),'danger');
 for(const action of ['DOCUMENT_ACCEPTED','CASE_APPROVED','CASE_COMPLETED'])assert.equal(context.activityTone(action),'success');
 assert.equal(context.activityTone('REQUIREMENT_ADDED'),'warning');assert.equal(context.activityTone('DOCUMENT_UPLOADED'),'info');assert.equal(context.activityTone('UNKNOWN_EVENT'),'neutral');
});
