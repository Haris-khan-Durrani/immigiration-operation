import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {configureProxy} from '../server/proxy.js';
test('loopback proxy resolves forwarded clients without trusting public peers',async()=>{const app=express();configureProxy(app,'loopback');const trust=app.get('trust proxy fn');assert.equal(trust('127.0.0.1'),true);assert.equal(trust('::1'),true);assert.equal(trust('198.51.100.10'),false);app.get('/',(req,res)=>res.json({ip:req.ip}));const server=app.listen(0,'127.0.0.1');try{await new Promise(r=>server.once('listening',r));const response=await fetch('http://127.0.0.1:'+server.address().port,{headers:{'X-Forwarded-For':'203.0.113.10, 198.51.100.10'}});assert.equal((await response.json()).ip,'198.51.100.10');}finally{await new Promise(r=>server.close(r));}});
test('direct mode rejects forwarded IP trust and unrestricted trust cannot be enabled',()=>{const app=express();configureProxy(app,'false');assert.equal(app.get('trust proxy'),false);assert.throws(()=>configureProxy(app,'true'),/TRUST_PROXY/);});
