import {cleanGuide} from './guidance.js';
import {randomUUID} from 'node:crypto';
export function fail(message,status=400) {const e=new Error(message);e.status=status;throw e;}
export const json=value=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return value;}};
export const staff=user=>user.role!=='CLIENT';
export function canAccess(user,c) {
 return user.role==='ADMIN'||user.role==='MANAGER' && user.team_id!=null && Number(user.team_id)===Number(c.team_id)||user.role==='AGENT' && Number(c.assigned_to)===Number(user.id)||user.role==='CLIENT' && Number(c.client_user_id)===Number(user.id);
}
export function normalizeFields(input) {
 if(!Array.isArray(input)||input.length>100) fail('Provide up to 100 fields.');
 const fields=input.map(f=>{
  if(!f||typeof f.label!=='string'||!f.label.trim()||f.label.length>200||!['text','email','date','number','file','textarea','dropdown','checkbox','phone','url','radio','heading','paragraph','divider'].includes(f.type)||typeof f.guide!=='string'||f.guide.length>30000||typeof f.required!=='boolean') fail('Invalid field definition.');
  if(f.instructionRole!==undefined&&(!['introduction','important'].includes(f.instructionRole)||f.type!=='paragraph'||f.condition||f.applicantSpecific))fail('Category instructions must be unconditional paragraph blocks.');
  const key=f.key || randomUUID();if(typeof key!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(key))fail('Invalid field key.');
  const options=f.options || [];if(!Array.isArray(options)||options.length>100||options.some(v=>typeof v!=='string'||v.length>200))fail('Invalid dropdown options.');
  if(['dropdown','radio'].includes(f.type)&&!options.length)fail('Dropdown fields need options.');
  const maxMB=Number(f.maxMB || 10);if(!Number.isFinite(maxMB)||maxMB<1||maxMB>10)fail('File size must be 1–10 MB.');
  const fileCount=Number(f.fileCount || 1);if(!Number.isInteger(fileCount)||fileCount<1||fileCount>10)fail('Document slots must be 1–10.');
  const formats=f.formats || ['pdf','jpg','png'];if(!Array.isArray(formats)||!formats.length||formats.some(v=>!['pdf','jpg','png'].includes(v)))fail('Supported formats: PDF, JPG and PNG.');
  if(f.condition && (typeof f.condition.key!=='string'||!['string','boolean','number'].includes(typeof f.condition.equals)))fail('Invalid conditional visibility rule.');
  for(const limit of [f.min,f.max])if(limit!==undefined&&limit!==null&&limit!==''&&!Number.isFinite(Number(limit)))fail('Invalid numeric limit.');
  if(f.min!==undefined&&f.max!==undefined&&f.min!==''&&f.max!==''&&Number(f.min)>Number(f.max))fail('Minimum must not exceed maximum.');
  if(f.sampleUrl && !/^https:\/\/[^\s]+$/.test(f.sampleUrl))fail('Samples must use HTTPS links.');
  if(f.section!==undefined&&(typeof f.section!=='string'||f.section.length>160))fail('Section name must be up to 160 characters.');if(f.width!==undefined&&!['full','half'].includes(f.width))fail('Invalid field width.');return {...f,required:['heading','paragraph','divider'].includes(f.type)?false:f.required,key,label:f.label.trim(),guide:cleanGuide(f.guide),options,maxMB,fileCount,formats,applicantSpecific:!!f.applicantSpecific};
 });
 if(new Set(fields.map(f=>f.key)).size!==fields.length)fail('Field keys must be unique.');
 for(const f of fields)if(f.condition && (!fields.some(other=>other.key===f.condition.key && !['file','heading','paragraph','divider'].includes(other.type))||f.condition.key===f.key))fail('Conditional rule must reference a different non-file field.');
 // Reject condition cycles: hidden dependencies must never accidentally satisfy required fields.
 for(const field of fields){const seen=new Set([field.key]);let f=field;while(f.condition){if(seen.has(f.condition.key))fail('Conditional fields contain a cycle.');seen.add(f.condition.key);f=fields.find(v=>v.key===f.condition.key);}}
 return fields;
}
export function applicable(r,requirements) {
 const d=json(r.definition);if(!d.condition)return true;
 const parent=requirements.find(p=>p.field_key===d.condition.key);
 return !!parent && applicable(parent,requirements) && json(parent.value_json)===d.condition.equals;
}
export function validValue(d,v) {
 if(v===null||v===undefined||v==='')return !d.required;
 if(d.type==='checkbox')return typeof v==='boolean'&&(!d.required||v);
 if(d.type==='number')return typeof v==='number'&&Number.isFinite(v)&&(d.min===undefined||d.min===''||v>=Number(d.min))&&(d.max===undefined||d.max===''||v<=Number(d.max));
 if(typeof v!=='string'||v.length>10000)return false;
 if(d.type==='email')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
 if(d.type==='date')return /^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v&&(!d.futureOnly||v>=new Date().toISOString().slice(0,10));
 if(d.type==='url'){try{return new URL(v).protocol==='https:';}catch{return false;}}
 if(d.type==='phone')return /^[+0-9() .-]{5,40}$/.test(v);
 if(['dropdown','radio'].includes(d.type))return d.options.includes(v);
 return !!v.trim()||!d.required;
}
export function completion(requirements,documents) {
 const required=requirements.filter(r=>json(r.definition).required&&!r.waived&&applicable(r,requirements));
 const satisfied=required.filter(r=>{
  const d=json(r.definition);if(d.type!=='file')return validValue(d,json(r.value_json));
  const versions=documents.filter(v=>Number(v.requirement_id)===Number(r.id)).sort((a,b)=>b.version-a.version);
  return versions[0]?.status==='ACCEPTED';
 });
 return {total:required.length,satisfied:satisfied.length,percent:required.length?Math.round(satisfied.length/required.length*100):100,ready:satisfied.length===required.length};
}
export function eligible(event,policy) {
 if(!policy.activationDate||!policy.allowedPipelines?.length)return 'Onboarding policy is not configured';
 const when=Date.parse(event.completedAt), activation=Date.parse(policy.activationDate);
 if(!Number.isFinite(when)||!Number.isFinite(activation)||when<activation||when>Date.now()+300000)return 'Outside activation period';
 if(event.contractStatus!=='COMPLETED'||event.summaryStatus!=='COMPLETED'||event.isNewClient!==true||event.procedureEligible!==true)return 'Client does not meet onboarding requirements';
 if(!policy.allowedPipelines.includes(event.pipelineId))return 'Pipeline is not approved';
 return null;
}

export function missingDocumentLabels(requirements,documents){return requirements.filter(r=>{const d=json(r.definition);if(r.waived||!d.required||d.type!=='file'||!applicable(r,requirements))return false;const latest=documents.filter(v=>Number(v.requirement_id)===Number(r.id)).sort((a,b)=>b.version-a.version)[0];return !latest||['REJECTED','REMOVED'].includes(latest.status);}).map(r=>json(r.definition).label);}
