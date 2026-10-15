import {db} from './db.js';
import {json} from './domain.js';
import {decrypt} from './crypto.js';
export async function contractConnection(){const [rows]=await db.query('SELECT settings FROM application_settings WHERE id=1');return json(rows[0].settings).contractConnection || {};}
export async function contractSecret(){const c=await contractConnection();return c.secretEncrypted?decrypt(c.secretEncrypted):process.env.CONTRACT_WEBHOOK_SECRET;}
export async function portalBase(){return (await contractConnection()).operationsUrl || process.env.APP_URL || 'http://localhost:3000';}
