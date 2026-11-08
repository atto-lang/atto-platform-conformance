import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyOwnershipTrace as check} from '../src/random-five-ownership-v1.mjs';
const d=(name='v',extra={})=>({op:'declare',name,owner:'actorA',mutable:true,sendable:true,kind:'data',...extra});
const bad=(trace,code)=>assert.equal(check(trace).diagnostic,code);
test('balanced rt borrow read/release and move accepted in linear oracle',()=>{
 assert.equal(check([d(),{op:'borrow',name:'v',actor:'actorA',mode:'read',token:'r1'},
  {op:'borrow',name:'v',mode:'read',token:'r2'},{op:'release',token:'r2'},
  {op:'release',token:'r1'},{op:'take',name:'v'}]).ok,true);
});
test('exclusive borrow blocks concurrent read/write',()=>{
 bad([d(),{op:'borrow',name:'v',mode:'write',token:'w'},{op:'borrow',name:'v',mode:'read',token:'r'}],'READ_BORROW_CONFLICT');
 bad([d(),{op:'borrow',name:'v',mode:'read',token:'r'},{op:'borrow',name:'v',mode:'write',token:'w'}],'WRITE_BORROW_CONFLICT');
});
test('actor state exclusive loan cannot cross await',()=>{
 bad([d('s',{kind:'actor-state'}),{op:'borrow',name:'s',mode:'write',token:'w'},{op:'await'}],
  'EXCLUSIVE_ACTOR_LOAN_CROSSES_AWAIT');
});
test('independent data read borrow can cross await and release',()=>{
 assert.equal(check([d(),{op:'borrow',name:'v',mode:'read',token:'r'},{op:'await'},
   {op:'release',token:'r'}]).ok,true);
});
test('take or transport cannot invalidate live loans',()=>{
 bad([d(),{op:'borrow',name:'v',mode:'read',token:'r'},{op:'take',name:'v'}],'OWNED_VALUE_HAS_LIVE_LOANS');
 bad([d(),{op:'borrow',name:'v',mode:'read',token:'r'},{op:'send',name:'v'}],'OWNED_VALUE_HAS_LIVE_LOANS');
});
test('send moves data and rejects use-after-transfer',()=>{
 bad([d(),{op:'send',name:'v'},{op:'use',name:'v'}],'USE_AFTER_TAKE_OR_UNKNOWN');
});
test('closures cannot be shipped across channels',()=>{
 bad([d('f',{kind:'closure'}),{op:'send',name:'f'}],'NON_SENDABLE_EXECUTABLE_VALUE');
});
test('actor private state is never implicitly accessible to another actor',()=>{
 bad([d('s',{kind:'actor-state'}),{op:'use',name:'s',actor:'actorB'}],'CROSS_ACTOR_PRIVATE_ACCESS');
});
test('mutable data cannot be shared as immutable Sendable value',()=>{
 bad([d(),{op:'share',name:'v'}],'MUTABLE_OR_NON_SENDABLE_SHARE');
 assert.equal(check([d('x',{mutable:false}),{op:'share',name:'x'}]).ok,true);
});
test('unreleased and double-released loans denied',()=>{
 bad([d(),{op:'borrow',name:'v',mode:'read',token:'r'}],'UNRELEASED_LOANS');
 bad([d(),{op:'borrow',name:'v',mode:'read',token:'r'},{op:'release',token:'r'},
 {op:'release',token:'r'}],'UNKNOWN_OR_RELEASED_LOAN');
});
test('immutable and loaned writes forbidden',()=>{
 bad([d('v',{mutable:false}),{op:'use',name:'v',write:true}],'UNAUTHORIZED_WRITE');
 bad([d(),{op:'borrow',name:'v',mode:'read',token:'r'},{op:'use',name:'v',write:true}],'UNAUTHORIZED_WRITE');
});
test('malformed declaration, invalid borrow token and oversized trace fail closed',()=>{
 bad([{op:'declare',name:'v',owner:'actorA'}],'INVALID_DECLARATION');
 bad([d(),{op:'borrow',name:'v',mode:'read',token:'bad space'}],'INVALID_BORROW_TOKEN');
 bad(Array.from({length:257},()=>({op:'await'})),'TRACE_LIMIT');
});
test('successful source-only oracle cannot certify compile-time borrow checker',()=>{
 const r=check([d(),{op:'retire',name:'v'}]);
 assert.equal(r.ok,true);assert.equal(r.verifiedGuest,false);
});
