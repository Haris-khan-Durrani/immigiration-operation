import test from 'node:test';
import assert from 'node:assert/strict';
import {internalDefinitions} from '../server/internal-work.js';
const base={key:'business_plan',name:'Business plan',required:true,deadlineKey:'due',remindBeforeDays:3,fields:[{key:'due',label:'Due date',type:'date',guide:'',required:false},{key:'plan',label:'Plan document',type:'file',guide:'',required:true}]};
test('internal sections support versionable fields and safe document limits',()=>{const d=internalDefinitions([base])[0];assert.equal(d.deadlineKey,'due');assert.equal(d.fields[1].maxMB,5);assert.ok(d.fields[1].formats.includes('docx'));assert.equal(d.required,true);});
test('internal section designs reject invalid deadlines, duplicate keys and unsupported fields',()=>{assert.throws(()=>internalDefinitions([{...base,deadlineKey:'plan'}]));assert.throws(()=>internalDefinitions([base,base]));assert.throws(()=>internalDefinitions([{...base,fields:[{key:'x',label:'HTML',type:'paragraph',guide:'',required:false}]}]));assert.throws(()=>internalDefinitions([{...base,name:'Bad\r\nSubject'}]));});
