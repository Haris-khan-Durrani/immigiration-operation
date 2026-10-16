import {readFile} from 'node:fs/promises';
import {db} from './db.js';
try {
  const sql = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').filter(s => s.trim())) await db.query(statement);
  const [columns] = await db.query("SHOW COLUMNS FROM categories LIKE 'parent_id'");
  if (!columns.length) await db.query('ALTER TABLE categories ADD parent_id BIGINT UNSIGNED NULL, ADD CONSTRAINT fk_category_parent FOREIGN KEY (parent_id) REFERENCES categories(id)');
  await db.query("ALTER TABLE users MODIFY role ENUM('ADMIN','MANAGER','AGENT','CLIENT') NOT NULL");
  const additions={users:{team_id:'BIGINT UNSIGNED NULL'},cases:{operational_status_id:'BIGINT UNSIGNED NULL',reminder_every_hours:'INT NULL',next_reminder_at:'DATETIME NULL',client_email:'VARCHAR(254) NULL',client_user_id:'BIGINT UNSIGNED NULL',assigned_to:'BIGINT UNSIGNED NULL',team_id:'BIGINT UNSIGNED NULL',due_at:'DATETIME NULL',opportunity_id:'VARCHAR(120) NULL',summary_json:'JSON NULL',contract_url:'TEXT NULL',applicants:'JSON NULL',category_version:'INT NULL',approved_by:'BIGINT UNSIGNED NULL',approved_at:'DATETIME NULL'}};
  for(const [table,fields] of Object.entries(additions)) for(const [name,type] of Object.entries(fields)) {
    const [existing]=await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`,[name]);
    if(!existing.length) await db.query(`ALTER TABLE ${table} ADD ${name} ${type}`);
  }
  const workflow=await readFile(new URL('../database/workflow.sql',import.meta.url),'utf8');
  for(const statement of workflow.split(';').filter(s=>s.trim())) await db.query(statement);
  await db.query("ALTER TABLE document_versions MODIFY status ENUM('PENDING','ACCEPTED','REJECTED','REMOVED') NOT NULL DEFAULT 'PENDING'");
  const [storageColumns]=await db.query("SHOW COLUMNS FROM document_versions LIKE 'storage_provider'");
  if(!storageColumns.length)await db.query("ALTER TABLE document_versions ADD storage_provider ENUM('LOCAL','GHL') NOT NULL DEFAULT 'LOCAL'");
  await db.query("ALTER TABLE email_outbox MODIFY status ENUM('QUEUED','SENDING','SENT','FAILED','UNKNOWN','CANCELLED') NOT NULL DEFAULT 'QUEUED'");
  const [statusColors]=await db.query("SHOW COLUMNS FROM file_statuses LIKE 'color'");if(!statusColors.length)await db.query("ALTER TABLE file_statuses ADD color VARCHAR(7) NOT NULL DEFAULT '#137f75'");
  for(const [table,name,type] of [['users','must_change_password','BOOLEAN NOT NULL DEFAULT FALSE'],['handoff_events','intake_id','BIGINT UNSIGNED NULL']]){const [existing]=await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`,[name]);if(!existing.length)await db.query(`ALTER TABLE ${table} ADD ${name} ${type}`);}
  await db.query("INSERT IGNORE INTO application_settings (id,settings) VALUES (1,JSON_OBJECT('activationDate',NULL,'allowedPipelines',JSON_ARRAY(),'defaultCategoryId',NULL,'defaultAgentId',NULL,'ghlMediaCopy',false,'mediaPrivacyVerified',false))");
  console.log('MySQL schema initialized.');
} finally { await db.end(); }
