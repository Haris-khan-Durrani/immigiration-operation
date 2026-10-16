import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const context=vm.createContext({URL,URLSearchParams,addEventListener:()=>{}});
vm.runInContext(await readFile(new URL('../public/navigation.js',import.meta.url),'utf8'),context);
test('workspace pages have stable paths',()=>{
 for(const [view,path] of [['overview','dashboard'],['intake','new-clients'],['categories','categories'],['settings','settings'],['users','team'],['audit','activity-log']]){
  assert.equal(context.workspaceUrl({view}),'/'+path);assert.equal(context.parseWorkspaceUrl('/'+path).view,view);
 }
});
test('file, document, conversation and preview state round trip in the URL',()=>{
 const url=context.workspaceUrl({view:'cases',caseId:'42',tab:'documents',documentId:'8',conversation:'emails',expanded:true});
 assert.equal(url,'/client-files/42/documents?document=8&conversation=emails&expanded=1');
 const state=context.parseWorkspaceUrl(url);assert.equal(state.caseId,'42');assert.equal(state.documentId,'8');assert.equal(state.conversation,'emails');assert.equal(state.expanded,true);
 const preview=context.parseWorkspaceUrl('/client-files/42/client-view/activity');assert.equal(preview.preview,true);assert.equal(preview.tab,'activity');
 assert.equal(context.parseWorkspaceUrl('/categories/12').categoryId,'12');
});
test('invalid route values cannot become IDs or unexpected tab state',()=>{
 const state=context.parseWorkspaceUrl('/client-files/not-a-number/documents?document=script&conversation=evil');assert.equal(state.caseId,null);assert.equal(state.documentId,null);assert.equal(state.conversation,'conversation');
 assert.equal(context.parseWorkspaceUrl('/client-files/42/unknown').tab,null);
});
