import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mediaUrl,readMedia} from '../server/storage.js';

test('remote document URLs reject non-HTTPS, credentials and internal hosts',()=>{
 for(const url of ['http://storage.googleapis.com/a','https://127.0.0.1/a','https://storage.googleapis.com.evil.test/a','https://user:password@storage.googleapis.com/a'])assert.throws(()=>mediaUrl(url));
 assert.equal(mediaUrl('https://storage.googleapis.com/bucket/document.pdf').hostname,'storage.googleapis.com');
});
test('remote previews verify original bytes and reject corrupt, oversized or unavailable media',async()=>{
 const original=globalThis.fetch,bytes=Buffer.from('%PDF-original'),hash=createHash('sha256').update(bytes).digest('hex');
 try{
  globalThis.fetch=async()=>new Response(bytes);
  assert.deepEqual(await readMedia('https://storage.googleapis.com/test',bytes.length,hash),bytes);
  await assert.rejects(readMedia('https://storage.googleapis.com/test',bytes.length,'0'.repeat(64)));
  await assert.rejects(readMedia('https://storage.googleapis.com/test',2,hash));
  globalThis.fetch=async()=>new Response('',{status:404});
  await assert.rejects(readMedia('https://storage.googleapis.com/test',bytes.length,hash));
 }finally{globalThis.fetch=original;}
});
