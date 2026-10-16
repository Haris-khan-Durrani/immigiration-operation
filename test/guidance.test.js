import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {normalizeFields} from '../server/domain.js';
import {cleanGuide,richTextPrefix} from '../server/guidance.js';
const context=vm.createContext({URL,esc:text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
vm.runInContext(await readFile(new URL('../public/guidance.js',import.meta.url),'utf8'),context);
test('formatted instructions render headings, lists, tables and safe links',()=>{
 const html=context.guideMarkup('## Prepare\n- **Passport**\n- All pages\n\n1. Scan\n2. Upload\n\n[Example](https://example.com)\n\n| Item | Notes |\n| --- | --- |\n| Passport | Valid |');
 for(const value of ['<h4>Prepare</h4>','<ul>','<ol>','<strong>Passport</strong>','<table>','rel="noopener noreferrer"'])assert.ok(html.includes(value),value);
});
test('authored HTML and unsafe links cannot become executable markup',()=>{
 const html=context.guideMarkup('<img src=x onerror=alert(1)>\n[Bad](javascript:alert(1))\n[Secret](https://user:pass@example.com)');
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('<a '));assert.ok(html.includes('&lt;img'));
});
test('instruction metadata is preserved in versionable fields and cannot be conditional',()=>{
 const note={key:'intro',label:'Before you upload',type:'paragraph',guide:'- Scan all pages',instructionRole:'introduction',required:false};
 assert.equal(normalizeFields([note])[0].instructionRole,'introduction');
 assert.throws(()=>normalizeFields([{...note,type:'file'}]));assert.throws(()=>normalizeFields([{...note,instructionRole:'invalid'}]));assert.throws(()=>normalizeFields([{...note,applicantSpecific:true}]));
});
test('rich text saves formatting but removes scripts, unsafe URLs and arbitrary CSS',()=>{
 const result=cleanGuide(richTextPrefix+'<h2>Prepare</h2><p style="text-align:center;color:red" onclick="alert(1)"><strong>Original</strong></p><script>alert(1)</script><a href="javascript:alert(1)">Unsafe</a><a href="https://user:pass@example.com">Credentials</a><a href="https://example.com">Safe</a><table><tr><td>Passport</td></tr></table>');
 assert.ok(result.includes('<h2>Prepare</h2>'));assert.ok(result.includes('<strong>Original</strong>'));assert.ok(result.includes('text-align:center'));assert.ok(result.includes('<table>'));assert.ok(!result.includes('onclick'));assert.ok(!result.includes('<script'));assert.ok(!result.includes('javascript:'));assert.ok(!result.includes('user:pass'));assert.ok(!result.includes('color:red'));assert.ok(result.includes('rel="noopener noreferrer"'));
});
