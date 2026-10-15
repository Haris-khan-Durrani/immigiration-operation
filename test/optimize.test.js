import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import sharp from 'sharp';
import {optimize} from '../server/optimize.js';
test('PDF copies shrink without changing original page count',async()=>{const pdf=await PDFDocument.create();pdf.addPage([600,800]);const bytes=Buffer.from(await pdf.save({useObjectStreams:false}));const copy=await optimize(bytes,'application/pdf');assert.ok(copy.length<=bytes.length);assert.equal((await PDFDocument.load(copy)).getPageCount(),1);});
test('signed or invalid PDF copies preserve original bytes',async()=>{for(const bytes of [Buffer.from('%PDF /ByteRange [0 1 2 3]'),Buffer.from('%PDF-invalid')])assert.equal(await optimize(bytes,'application/pdf'),bytes);});
test('image copy optimization retains dimensions and never increases size',async()=>{const bytes=await sharp({create:{width:100,height:100,channels:3,background:'#ffffff'}}).png({compressionLevel:0}).toBuffer();const copy=await optimize(bytes,'image/png');assert.ok(copy.length<bytes.length);const metadata=await sharp(copy).metadata();assert.equal(metadata.width,100);assert.equal(metadata.height,100);});
