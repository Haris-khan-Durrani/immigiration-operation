import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {db} from '../server/db.js';
import {uploadMedia,readDocument,readMedia} from '../server/storage.js';

// Stop application writes while migrating. Every original is verified before removal.
try {
 const [rows]=await db.query("SELECT * FROM document_versions WHERE storage_provider='LOCAL' ORDER BY id");
 for(const row of rows){
  const bytes=await readDocument(row);
  const media=await uploadMedia(bytes,row.mime,`OPS-migrated-${row.id}-${row.storage_key}`);
  await readMedia(media.url,row.byte_size,row.sha256);
  const c=await db.getConnection();
  try{await c.beginTransaction();await c.execute("UPDATE document_versions SET storage_provider='GHL',ghl_media_id=?,ghl_media_url=? WHERE id=? AND storage_provider='LOCAL'",[media.fileId,media.url,row.id]);await c.execute('INSERT INTO audit_events (actor,action,details) VALUES (?,?,?)',['storage-migration','DOCUMENT_STORAGE_MIGRATED',JSON.stringify({documentId:row.id})]);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}
  await unlink(path.resolve(process.env.UPLOAD_DIR || 'private-uploads',row.storage_key+'.enc'));
  console.log(`Document ${row.id}: verified in GHL; server original removed.`);
 }
 console.log('Migration complete. Old backups may still contain documents; retain or remove them according to your retention policy.');
}finally{await db.end();}
