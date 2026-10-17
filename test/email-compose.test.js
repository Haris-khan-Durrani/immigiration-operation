import test from 'node:test';
import assert from 'node:assert/strict';
import {emailFile} from '../server/email-compose.js';
test('email attachments enforce supported types, actual file headers and safe names',()=>{const file={originalname:'../notes.pdf',buffer:Buffer.from('%PDF-1.7 test')};assert.equal(emailFile(file).name,'notes.pdf');assert.equal(emailFile(file).mime,'application/pdf');assert.throws(()=>emailFile({...file,originalname:'notes.exe'}));assert.throws(()=>emailFile({...file,buffer:Buffer.from('<script>bad</script>')}));assert.throws(()=>emailFile({originalname:'empty.txt',buffer:Buffer.alloc(0)}));assert.throws(()=>emailFile({originalname:'large.pdf',buffer:Buffer.alloc(6*1024*1024)}));});
