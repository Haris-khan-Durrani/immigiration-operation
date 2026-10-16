import {readFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {db} from '../server/db.js';
import {decrypt} from '../server/crypto.js';
const directory=process.argv[2];if(!directory)throw new Error('Usage: npm run restore -- <backup-directory>. Target must be a freshly migrated empty database.');
const tables=['teams','users','categories','category_versions','file_statuses','cases','case_expiries','contract_intake','requirements','document_versions','case_events','tasks','notifications','email_outbox','invitations','integration_settings','email_settings','application_settings','handoff_events','audit_events'];
const backup=JSON.parse(decrypt(await readFile(path.resolve(directory,'database.enc'),'utf8')));if(backup.tables && !backup.tables.email_settings)backup.tables.email_settings=[];if(backup.tables)for(const t of ['file_statuses','case_expiries'])backup.tables[t] ??= [];if(backup.version!==1||tables.some(t=>!Array.isArray(backup.tables[t])))throw new Error('Invalid backup.');
const c=await db.getConnection();try {
 await c.beginTransaction();for(const table of tables.filter(t=>t!=='application_settings')){const [rows]=await c.query('SELECT COUNT(*) AS n FROM '+table);if(rows[0].n)throw new Error('Restore requires an empty target database. Existing records will not be overwritten.');}
 await c.query('DELETE FROM application_settings');
 for(const table of tables){const [columns]=await c.query('SHOW COLUMNS FROM '+table);const types=new Map(columns.map(v=>[v.Field,v.Type]));for(const row of backup.tables[table]){const names=Object.keys(row);if(names.some(n=>!types.has(n)))throw new Error('Backup schema mismatch.');const values=names.map(n=>/^(datetime|timestamp)/.test(types.get(n))&&row[n]?new Date(row[n]):row[n]);await c.execute('INSERT INTO '+table+' ('+names.map(n=>'`'+n+'`').join(',')+') VALUES ('+names.map(()=>'?').join(',')+')',values);}}
 await c.query('DELETE FROM sessions');await c.query("UPDATE email_outbox SET status='UNKNOWN',last_error='Restored backup. Verify delivery before retrying.' WHERE status IN ('QUEUED','SENDING')");
 const destination=path.resolve(process.env.UPLOAD_DIR || 'private-uploads');await mkdir(destination,{recursive:true});for(const row of backup.tables.document_versions){if(row.storage_provider==='GHL'||row.status==='REMOVED')continue;if(!/^[a-f0-9-]{36}$/.test(row.storage_key))throw new Error('Invalid storage key.');await copyFile(path.resolve(directory,'files',row.storage_key+'.enc'),path.join(destination,row.storage_key+'.enc'));}
 await c.commit();console.log('Backup restored. Sessions revoked; unsent email delivery requires review.');
}catch(e){await c.rollback();throw e;}finally{c.release();await db.end();}
