import {syncStatusReminders} from './status-reminders.js';
import {Router} from 'express';
import {db} from './db.js';
import {permit} from './auth.js';
import {normalizeFields,json,fail} from './domain.js';
import {transaction,loadCase,event,refresh,expandFields,notify,managers,queueEmail} from './workflow.js';
import {portalBase} from './connection.js';

export const catalog=Router();
const manage=permit('ADMIN','MANAGER');

catalog.get('/categories',permit('ADMIN','MANAGER','AGENT'),async(req,res)=>{const [rows]=await db.query('SELECT * FROM categories ORDER BY name');res.json(rows.map(r=>({...r,fields:json(r.fields)})));});
catalog.post('/categories',manage,async(req,res)=>{const {name,parentId}=req.body;if(typeof name!=='string'||!name.trim()||name.length>200)fail('Enter category name.');const fields=normalizeFields(req.body.fields || []);const id=await transaction(async c=>{if(parentId){const [rows]=await c.execute('SELECT id FROM categories WHERE id=?',[Number(parentId)]);if(!rows.length)fail('Parent category does not exist.');}const [r]=await c.execute('INSERT INTO categories (name,parent_id,fields) VALUES (?,?,?)',[name.trim(),parentId || null,JSON.stringify(fields)]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'CATEGORY_CREATED',JSON.stringify({categoryId:r.insertId})]);return r.insertId;});res.status(201).json({id});});
catalog.patch('/categories/:id',manage,async(req,res)=>{const {name,parentId}=req.body;const id=Number(req.params.id);if(typeof name!=='string'||!name.trim()||name.length>200||parentId!==null&&(!Number.isSafeInteger(parentId)||parentId<1))fail('Enter a category name and valid parent.');await transaction(async c=>{const [rows]=await c.query('SELECT id,parent_id FROM categories ORDER BY id FOR UPDATE');if(!rows.some(r=>Number(r.id)===id))fail('Category not found.',404);let cursor=parentId;const seen=new Set([id]);while(cursor){if(seen.has(cursor))fail('A category cannot be its own parent or belong to one of its subcategories.');seen.add(cursor);const parent=rows.find(r=>Number(r.id)===cursor);if(!parent)fail('Parent category does not exist.');cursor=parent.parent_id?Number(parent.parent_id):null;}await c.execute('UPDATE categories SET name=?,parent_id=? WHERE id=?',[name.trim(),parentId,id]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'CATEGORY_UPDATED',JSON.stringify({categoryId:id,name:name.trim(),parentId})]);});res.json({saved:true});});
catalog.delete('/categories/:id',manage,async(req,res)=>{if(req.body.confirm!==true)fail('Confirm deleting this category.');await transaction(async c=>{const [rows]=await c.query('SELECT id,name,parent_id FROM categories ORDER BY id FOR UPDATE');const category=rows.find(r=>String(r.id)===req.params.id);if(!category)fail('Category not found.',404);if(rows.some(r=>Number(r.parent_id)===Number(category.id)))fail('Move or delete this category’s subcategories first.',409);const [files]=await c.execute('SELECT id FROM cases WHERE category_id=? LIMIT 1',[category.id]);if(files.length)fail('This category is assigned to client files and cannot be deleted. Existing checklists must be preserved.',409);const [linkedStatuses]=await c.execute('SELECT id FROM file_statuses WHERE category_id=? LIMIT 1',[category.id]);if(linkedStatuses.length)fail('Move or delete this category’s file statuses before deleting the category.',409);await c.execute('DELETE FROM category_versions WHERE category_id=?',[category.id]);await c.execute('DELETE FROM categories WHERE id=?',[category.id]);await c.execute("UPDATE application_settings SET settings=JSON_SET(settings,'$.defaultCategoryId',NULL) WHERE JSON_UNQUOTE(JSON_EXTRACT(settings,'$.defaultCategoryId'))=?",[String(category.id)]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'CATEGORY_DELETED',JSON.stringify({categoryId:category.id,name:category.name})]);});res.json({deleted:true});});
catalog.put('/categories/:id/fields',manage,async(req,res)=>{const fields=normalizeFields(req.body.fields);await transaction(async c=>{const [rows]=await c.execute('SELECT * FROM categories WHERE id=? FOR UPDATE',[req.params.id]);if(!rows.length)fail('Category not found.',404);if(rows[0].status!=='DRAFT')fail('Create a new draft version before editing.',409);const previous=json(rows[0].fields);for(const f of fields){const old=previous.find(p=>p.key===f.key);if(old&&old.type!==f.type)fail('An existing field type cannot be changed. Add a new field instead.');}await c.execute('UPDATE categories SET fields=? WHERE id=?',[JSON.stringify(fields),req.params.id]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'CATEGORY_FIELDS_UPDATED',JSON.stringify({categoryId:req.params.id,count:fields.length})]);});res.json({saved:true});});
catalog.post('/categories/:id/publish',manage,async(req,res)=>{await transaction(async c=>{const [rows]=await c.execute('SELECT * FROM categories WHERE id=? FOR UPDATE',[req.params.id]);if(!rows.length)fail('Category not found.',404);const category=rows[0];if(category.status!=='DRAFT')fail('This version is already published.',409);const fields=normalizeFields(json(category.fields));if(!fields.length)fail('Assign at least one field before publishing.');await c.execute('INSERT INTO category_versions (category_id,version,fields) VALUES (?,?,?)',[category.id,category.version,JSON.stringify(fields)]);await c.execute("UPDATE categories SET status='PUBLISHED',fields=? WHERE id=?",[JSON.stringify(fields),category.id]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',[req.user.email,'CATEGORY_PUBLISHED',JSON.stringify({categoryId:category.id,version:category.version})]);});res.json({saved:true});});
catalog.post('/categories/:id/draft',manage,async(req,res)=>{await transaction(async c=>{const [rows]=await c.execute('SELECT * FROM categories WHERE id=? FOR UPDATE',[req.params.id]);if(!rows.length)fail('Category not found.',404);if(rows[0].status!=='PUBLISHED')fail('An editable draft already exists.',409);await c.execute("UPDATE categories SET status='DRAFT',version=version+1 WHERE id=?",[req.params.id]);});res.json({saved:true});});
catalog.get('/categories/:id/versions',permit('ADMIN','MANAGER','AGENT'),async(req,res)=>{const [rows]=await db.execute('SELECT version,fields,created_at FROM category_versions WHERE category_id=? ORDER BY version DESC',[req.params.id]);res.json(rows.map(r=>({...r,fields:json(r.fields)})));});

export async function applyCategoryMigration(c,file,cat,user){
 const fields=expandFields(normalizeFields(json(cat.fields)),json(file.applicants) || [{key:'primary',name:file.client_name}]);
 const prefix='v'+cat.id+'_'+cat.version+'_'+Date.now()+'_';
 const definitions=fields.map(f=>({...f,key:prefix+f.key,condition:f.condition?{...f.condition,key:prefix+f.condition.key}:undefined}));
 await c.execute('UPDATE requirements SET waived=1 WHERE case_id=?',[file.id]);
 for(const f of definitions)await c.execute('INSERT INTO requirements (case_id,field_key,definition) VALUES (?,?,?)',[file.id,f.key,JSON.stringify(f)]);
 if(file.operational_status_id){
  const [statuses]=await c.execute('SELECT category_id FROM file_statuses WHERE id=? FOR UPDATE',[file.operational_status_id]);
  if(statuses[0]?.category_id!==null&&Number(statuses[0]?.category_id)!==Number(cat.id)){
   await c.execute('UPDATE cases SET operational_status_id=NULL WHERE id=?',[file.id]);
   await syncStatusReminders(c,{...file,operational_status_id:null});
   await event(c,file.id,user,'FILE_STATUS_CLEARED','Operational status cleared because the file category changed.');
  }
 }
 await c.execute("UPDATE cases SET category_id=?,category_version=?,requirements_snapshot=?,status='COLLECTING',approved_by=NULL,approved_at=NULL WHERE id=?",[cat.id,cat.version,JSON.stringify(definitions),file.id]);
 await event(c,file.id,user,'CATEGORY_MIGRATED','Document checklist updated to '+cat.name+' version '+cat.version+'.',true);
 await refresh(c,{...file,status:'COLLECTING'},user);
 return {definitions};
}

catalog.post('/cases/:id/category',permit('ADMIN','MANAGER','AGENT'),async(req,res)=>{
 if(req.body.confirm!==true)fail('Confirm applying the published template. Existing requirements will be retained as waived history.');
 await transaction(async c=>{
  const file=await loadCase(c,req.params.id,req.user,true);
  if(['SUBMITTED','COMPLETED','CANCELLED'].includes(file.status))fail('Reopen the file before changing its category.');
  const [pending]=await c.execute("SELECT id FROM category_change_requests WHERE case_id=? AND status='PENDING' LIMIT 1",[file.id]);
  if(pending.length){
   if(req.body.cancelPending || req.body.skipAgreement){
    await c.execute("UPDATE category_change_requests SET status='CANCELLED',cancelled_by=?,cancelled_at=NOW(),cancel_reason=? WHERE case_id=? AND status='PENDING'",[
     req.user.id,
     'Superseded by direct category change (no signed agreement required)',
     file.id
    ]);
   } else {
    fail('A category change request is pending client signature. Cancel or sign that request first.',409);
   }
  }
  const [rows]=await c.execute("SELECT * FROM categories WHERE id=? AND status='PUBLISHED'",[Number(req.body.categoryId)||0]);
  if(!rows.length)fail('Choose a published category.');
  const targetCat=rows[0];
  await applyCategoryMigration(c,file,targetCat,req.user);
  const noteReason=typeof req.body.reason==='string'&&req.body.reason.trim()?req.body.reason.trim().slice(0,500):'Direct change by Operations (no signed agreement required)';
  await event(c,file.id,req.user,'CATEGORY_DIRECT_CHANGE',`Category changed directly to ${targetCat.name} (v${targetCat.version}) without signed agreement. Note: ${noteReason}`,true);
  await notify(c,file.client_user_id,file.id,`category-migrated:${targetCat.id}:${Date.now()}`,`Your file service category has been updated to ${targetCat.name}.`);
 });
 res.json({saved:true});
});

catalog.post('/cases/:id/category-request',manage,async(req,res)=>{
 const {categoryId,agreementTitle,agreementText}=req.body;
 if(!Number.isSafeInteger(Number(categoryId))||Number(categoryId)<1)fail('Choose a published category.');
 if(typeof agreementText!=='string'||!agreementText.trim()||agreementText.length>50000)fail('Agreement text is required.');
 const title=typeof agreementTitle==='string'&&agreementTitle.trim()?agreementTitle.trim().slice(0,240):'Service Change Agreement & Addendum';
 const result=await transaction(async c=>{
  const file=await loadCase(c,req.params.id,req.user,true);
  if(['SUBMITTED','COMPLETED','CANCELLED'].includes(file.status))fail('Reopen the file before requesting a category change.');
  const [pending]=await c.execute("SELECT id FROM category_change_requests WHERE case_id=? AND status='PENDING' LIMIT 1 FOR UPDATE",[file.id]);
  if(pending.length)fail('A category change request is already pending client signature for this file. Edit or cancel it before creating a new one.',409);
  const [cats]=await c.execute("SELECT * FROM categories WHERE id=? AND status='PUBLISHED'",[Number(categoryId)]);
  if(!cats.length)fail('Choose a published category.');
  const cat=cats[0];
  if(Number(file.category_id)===Number(cat.id)&&Number(file.category_version)===Number(cat.version)){
   fail('The file is already using this category version.');
  }
  const [r]=await c.execute(
   "INSERT INTO category_change_requests (case_id,target_category_id,target_category_version,agreement_title,agreement_text,status,requested_by) VALUES (?,?,?,?,?,'PENDING',?)",
   [file.id,cat.id,cat.version,title,agreementText.trim(),req.user.id]
  );
  await event(c,file.id,req.user,'CATEGORY_CHANGE_REQUESTED',`Service category change requested to ${cat.name} (v${cat.version}). Awaiting client agreement signature. File progression is paused.`,true);
  await notify(c,file.client_user_id,file.id,`category-request:${r.insertId}`,`A service change agreement for ${cat.name} is ready for your signature.`);
  const portal=await portalBase();
  await queueEmail(c,file,`category-request:${r.insertId}`,'Action required: Service Change Agreement',`A service change agreement has been prepared to update your file to ${cat.name}.\n\nPlease review and sign the agreement in your client portal to continue your application.\nPortal: ${portal}`,{variables:{target_category:cat.name}});
  return {id:r.insertId,targetCategoryName:cat.name};
 });
 res.status(201).json(result);
});

catalog.patch('/cases/:id/category-request/:requestId',manage,async(req,res)=>{
 const {agreementTitle,agreementText}=req.body;
 if(agreementText!==undefined&&(typeof agreementText!=='string'||!agreementText.trim()||agreementText.length>50000))fail('Enter agreement text.');
 if(agreementTitle!==undefined&&(typeof agreementTitle!=='string'||!agreementTitle.trim()||agreementTitle.length>240))fail('Enter agreement title.');
 await transaction(async c=>{
  const file=await loadCase(c,req.params.id,req.user,true);
  const [reqs]=await c.execute('SELECT * FROM category_change_requests WHERE id=? AND case_id=? FOR UPDATE',[req.params.requestId,file.id]);
  if(!reqs.length)fail('Category change request not found.',404);
  const existing=reqs[0];
  if(existing.status!=='PENDING')fail('Only pending category change agreements can be edited.',409);
  const title=(agreementTitle??existing.agreement_title).trim();
  const text=(agreementText??existing.agreement_text).trim();
  await c.execute('UPDATE category_change_requests SET agreement_title=?,agreement_text=? WHERE id=?',[title,text,existing.id]);
  await event(c,file.id,req.user,'CATEGORY_AGREEMENT_UPDATED','Service change agreement terms updated by Operations.',false);
 });
 res.json({saved:true});
});

catalog.post('/cases/:id/category-request/:requestId/cancel', async (req, res) => {
  const rawReason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!rawReason || rawReason.length < 3) {
    fail('Please provide a reason for stopping this category change (minimum 3 characters).');
  }
  const reason = rawReason.slice(0, 500);

  await transaction(async c => {
    const file = await loadCase(c, req.params.id, req.user, true);
    const [reqs] = await c.execute(
      'SELECT r.*, c.name AS target_name FROM category_change_requests r JOIN categories c ON c.id=r.target_category_id WHERE r.id=? AND r.case_id=? FOR UPDATE',
      [req.params.requestId, file.id]
    );
    if (!reqs.length) fail('Category change request not found.', 404);
    const existing = reqs[0];
    if (existing.status !== 'PENDING') fail('This request is no longer pending and cannot be cancelled.', 409);

    const isClient = req.user.role === 'CLIENT';
    const actorLabel = isClient ? 'Client' : (req.user.name || 'Operations');

    await c.execute(
      "UPDATE category_change_requests SET status='CANCELLED',cancelled_by=?,cancelled_at=NOW(),cancel_reason=? WHERE id=?",
      [req.user.id, reason, existing.id]
    );
    await event(
      c,
      file.id,
      req.user,
      'CATEGORY_CHANGE_CANCELLED',
      `Category change request to ${existing.target_name} stopped by ${actorLabel}: ${reason}. Original category retained.`,
      true
    );

    if (isClient) {
      if (file.assigned_to) {
        await notify(c, file.assigned_to, file.id, `category-cancel:${existing.id}`, `Client stopped the category change to ${existing.target_name}. Reason: ${reason}`);
      }
      await managers(c, file.id, `category-cancel:${existing.id}`, `Category change to ${existing.target_name} stopped by client for file #${file.id}. Reason: ${reason}`);
    } else {
      await notify(c, file.client_user_id, file.id, `category-cancel:${existing.id}`, `The category change request to ${existing.target_name} was stopped by Operations: ${reason}`);
      if (file.assigned_to && file.assigned_to !== req.user.id) {
        await notify(c, file.assigned_to, file.id, `category-cancel:${existing.id}`, `Category change to ${existing.target_name} was stopped by ${actorLabel}. Reason: ${reason}`);
      }
    }
  });

  res.json({ cancelled: true, reason });
});

catalog.post('/cases/:id/category-request/:requestId/sign',async(req,res)=>{
 const {typedName,signatureImage,agreed}=req.body;
 if(agreed!==true)fail('You must confirm agreement to the terms before signing.');
 if(typeof typedName!=='string'||!typedName.trim()||typedName.length>200)fail('Enter your full legal name as your electronic signature.');
 if(typeof signatureImage!=='string'||(!signatureImage.startsWith('data:image/png;base64,')&&!signatureImage.startsWith('data:image/jpeg;base64,'))){
  fail('Please draw your signature in the signature area.');
 }
 if(signatureImage.length>500000)fail('Signature image too large.');
 const result=await transaction(async c=>{
  const file=await loadCase(c,req.params.id,req.user,true);
  const [reqs]=await c.execute(
   'SELECT r.*, c.name AS target_name, c.status AS target_status FROM category_change_requests r JOIN categories c ON c.id=r.target_category_id WHERE r.id=? AND r.case_id=? FOR UPDATE',
   [req.params.requestId,file.id]
  );
  if(!reqs.length)fail('Category change request not found.',404);
  const changeReq=reqs[0];
  if(changeReq.status!=='PENDING')fail('This agreement is no longer pending signature.',409);
  if(changeReq.target_status!=='PUBLISHED')fail('The target category is no longer published.',409);
  const [cats]=await c.execute('SELECT * FROM categories WHERE id=?',[changeReq.target_category_id]);
  const targetCat=cats[0];
  await applyCategoryMigration(c,file,targetCat,req.user);
  const signatureData={
   typedName:typedName.trim(),
   signatureImage,
   signedAt:new Date().toISOString(),
   ip:req.ip || req.headers['x-forwarded-for'] || '',
   userAgent:(req.headers['user-agent'] || '').slice(0,255),
   signerUserId:req.user.id,
   signerEmail:req.user.email
  };
  await c.execute("UPDATE category_change_requests SET status='SIGNED',signed_at=NOW(),signature_data=? WHERE id=?",[JSON.stringify(signatureData),changeReq.id]);
  await event(c,file.id,req.user,'CATEGORY_AGREEMENT_SIGNED',`Service Change Agreement signed by ${typedName.trim()}. Category transitioned to ${targetCat.name} (v${targetCat.version}).`,true);
  await notify(c,file.assigned_to,file.id,`category-signed:${changeReq.id}`,`Service change agreement signed by ${typedName.trim()}. File category updated to ${targetCat.name}.`);
  await managers(c,file.id,`category-signed:${changeReq.id}`,`Client signed category change agreement for file #${file.id}. New category: ${targetCat.name}.`);
  return {signed:true,categoryId:targetCat.id,categoryName:targetCat.name};
 });
 res.json(result);
});

catalog.get('/cases/:id/category-request/:requestId',async(req,res)=>{
 const file=await loadCase(db,req.params.id,req.user);
 const [rows]=await db.execute(
  `SELECT r.*, c.name AS target_category_name, u.name AS requester_name, cb.name AS canceller_name
   FROM category_change_requests r
   JOIN categories c ON c.id=r.target_category_id
   LEFT JOIN users u ON u.id=r.requested_by
   LEFT JOIN users cb ON cb.id=r.cancelled_by
   WHERE r.id=? AND r.case_id=?`,
  [req.params.requestId,file.id]
 );
 if(!rows.length)fail('Category change request not found.',404);
 res.json({...rows[0],signature_data:json(rows[0].signature_data)});
});
