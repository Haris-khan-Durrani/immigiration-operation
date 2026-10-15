import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,permit,validUser} from '../server/auth.js';
test('salted password hashes reject incorrect passwords',async()=>{const a=await hashPassword('a-long-password'),b=await hashPassword('a-long-password');assert.notEqual(a,b);assert.equal(await verifyPassword('a-long-password',a),true);assert.equal(await verifyPassword('wrong-password',a),false);});
test('admin permission denies agents and managers',()=>{for(const role of ['AGENT','MANAGER']){let status;let next=false;permit('ADMIN')({user:{role}},{status(code){status=code;return this;},json(){}},()=>next=true);assert.equal(status,403);assert.equal(next,false);}let allowed=false;permit('ADMIN')({user:{role:'ADMIN'}},{},()=>allowed=true);assert.equal(allowed,true);});
test('invalid account credentials are rejected',()=>{const u={name:'Agent',email:'agent@example.com',password:'long-password-123',role:'AGENT'};assert.ok(validUser(u));assert.ok(!validUser({...u,password:'short'}));assert.ok(!validUser({...u,role:'CLIENT'}));assert.ok(!validUser({...u,email:'invalid'}));});
