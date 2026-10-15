import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encrypt,decrypt} from '../server/crypto.js';
process.env.ENCRYPTION_KEY='ab'.repeat(32);
test('CRM token is encrypted with a fresh IV and decrypts correctly',()=>{const a=encrypt('private-token'),b=encrypt('private-token');assert.notEqual(a,b);assert.ok(!a.includes('private-token'));assert.equal(decrypt(a),'private-token');});
test('modified encrypted token fails authentication',()=>{const parts=encrypt('private-token').split('.');parts[2]=Buffer.from('tampered').toString('base64');assert.throws(()=>decrypt(parts.join('.')));});
