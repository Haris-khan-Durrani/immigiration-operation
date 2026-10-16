import {mkdir,writeFile,readdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {db} from '../server/db.js';
import {encrypt} from '../server/crypto.js';
const tables=['teams','users','categories','category_versions','file_statuses','cases','case_expiries','contract_intake','requirements','document_versions','case_events','tasks','notifications','email_outbox','invitations','integration_settings','email_settings','application_settings','handoff_events','audit_events'];
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),directory=path.resolve('backups',stamp);
let c;
try {
 c=await db.getConnection();await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
 const backup={version:1,createdAt:new Date().toISOString(),tables:{}};for(const table of tables){const [rows]=await c.query('SELECT * FROM '+table);backup.tables[table]=rows;}
 await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'database.enc'),encrypt(JSON.stringify(backup)),{mode:0o600});
 await mkdir(path.join(directory,'files'));const source=path.resolve(process.env.UPLOAD_DIR || 'private-uploads');
 // Copy only referenced immutable encrypted documents. Pause writes for a coordinated production backup.
 for(const row of backup.tables.document_versions){if(row.storage_provider==='GHL'||row.status==='REMOVED')continue;if(!/^[a-f0-9-]{36}$/.test(row.storage_key))throw new Error('Invalid document storage key');await copyFile(path.join(source,row.storage_key+'.enc'),path.join(directory,'files',row.storage_key+'.enc'));}
 await c.commit();console.log('Encrypted backup saved:',directory);
}catch(e){if(c)await c.rollback();throw e;}finally{c?.release();await db.end();}
