import {build} from 'esbuild';
import {mkdir,copyFile,cp} from 'node:fs/promises';
await mkdir('public/vendor',{recursive:true});
await copyFile('node_modules/pdfjs-dist/build/pdf.mjs','public/vendor/pdf.mjs');
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.mjs','public/vendor/pdf.worker.mjs');
await cp('node_modules/pdfjs-dist/standard_fonts','public/vendor/standard_fonts',{recursive:true});
await cp('node_modules/pdfjs-dist/cmaps','public/vendor/cmaps',{recursive:true});
await cp('node_modules/pdfjs-dist/wasm','public/vendor/wasm',{recursive:true});
console.log('Document preview assets prepared.');

await build({entryPoints:['public/richtext-entry.js'],outfile:'public/vendor/richtext.js',bundle:true,minify:true,format:'iife',globalName:'OperationsRichText',target:['es2020']});
