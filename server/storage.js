import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {db} from './db.js';
import {crm} from './crm.js';
import {decrypt} from './crypto.js';
import {json,fail} from './domain.js';

export function mediaUrl(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='storage.googleapis.com'||url.hostname.endsWith('.storage.googleapis.com')||url.hostname==='services.leadconnectorhq.com'||url.hostname==='assets.cdn.filesafe.space'))fail('GHL returned an unsupported media URL.',502);
 return url;
}
export async function uploadMedia(bytes,mime,name){
 const [rows]=await db.query('SELECT settings FROM application_settings WHERE id=1');
 const policy=json(rows[0]?.settings || {}),body=new FormData();
 body.set('file',new Blob([bytes],{type:mime}),name);body.set('hosted','false');body.set('name',name);
 if(policy.mediaFolderId)body.set('parentId',policy.mediaFolderId);
 let result;try{result=await crm('/medias/upload-file',{method:'POST',body});}catch(error){if(error.status===409)throw error;fail('GoHighLevel Media did not confirm the upload'+(error.providerStatus?' (HTTP '+error.providerStatus+')':'')+'. No server-storage fallback was used. Check the CRM token and media permissions.',502);}
 if(!result.fileId||!result.url)fail('GHL did not confirm document storage. Please retry.',502);
 mediaUrl(result.url);return result;
}
export async function readMedia(url,size,sha256){
 const response=await fetch(mediaUrl(url),{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)fail('GHL document is unavailable. Please retry or contact Operations.',502);
 const chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;if(length>size)fail('GHL document size does not match.',502);chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);
 if(length!==size||createHash('sha256').update(bytes).digest('hex')!==sha256)fail('GHL document integrity check failed.',502);
 return bytes;
}
export async function readDocument(document){
 if(document.storage_provider==='GHL')return readMedia(document.ghl_media_url,document.byte_size,document.sha256);
 return Buffer.from(decrypt(await readFile(path.resolve(process.env.UPLOAD_DIR || 'private-uploads',document.storage_key+'.enc'),'utf8')),'base64');
}
