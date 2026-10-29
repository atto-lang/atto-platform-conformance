import test from 'node:test';
import assert from 'node:assert/strict';
import {encode_actor_id,decode_actor_id,actor_id_hash,actor_storage_key,actor_ref_token,parse_actor_ref_token} from './identity.mjs';
const s=value=>({kind:'string',value});
const id=(key,other={})=>({tenant:'tenant-a',namespace:'commerce',actor_type:'shopping_cart',key,...other});
test('typed keys roundtrip, including signed and unsigned 64-bit boundaries',()=>{
 const keys=[s('customer-42'),{kind:'uuid',value:'019b2a65-961b-7ad8-823a-69d9e2ae3a31'},
 {kind:'u64',value:(1n<<64n)-1n},{kind:'i64',value:-(1n<<63n)},
 {kind:'compound',items:[s('east'),{kind:'u64',value:42n},{kind:'i64',value:-1n}]}];
 for(const key of keys){const v=id(key);assert.deepEqual(decode_actor_id(encode_actor_id(v)),v);
  assert.deepEqual(parse_actor_ref_token(actor_ref_token(v)),v);
  assert.match(actor_storage_key(v),/^oa1h_[A-Za-z0-9_-]{43}$/);}
});
test('different type, tenant, namespace and key types have different identities',()=>{
 const v=[id(s('42')),id({kind:'u64',value:42n}),id({kind:'i64',value:42n}),
   id(s('42'),{tenant:'tenant-b'}),id(s('42'),{namespace:'accounts'}),id(s('42'),{actor_type:'wallet'})];
 assert.equal(new Set(v.map(actor_id_hash)).size,v.length);
});
test('delimiter ambiguities and identity restarts cannot change storage keys',()=>{
 assert.notEqual(actor_id_hash(id(s('b/c'),{namespace:'a'})),actor_id_hash(id(s('c'),{namespace:'a/b'})));
 const v=id({kind:'compound',items:[s('east'),{kind:'u64',value:7n}]});
 assert.equal(actor_storage_key(v),actor_storage_key(parse_actor_ref_token(actor_ref_token(v))));
});
test('invalid text, precision loss, overflow, UUID casing and compound nesting are rejected',()=>{
 for(const bad of ['bad\0key','bad\nkey','\ud800','e\u0301',''])assert.throws(()=>encode_actor_id(id(s(bad))));
 assert.throws(()=>encode_actor_id(id(s('x'),{tenant:'z'.repeat(129)})));
 assert.throws(()=>encode_actor_id(id({kind:'uuid',value:'019B2A65-961B-7AD8-823A-69D9E2AE3A31'})));
 for(const bad of [-1n,1n<<64n,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>encode_actor_id(id({kind:'u64',value:bad})));
 assert.throws(()=>encode_actor_id(id({kind:'i64',value:1n<<63n})));
 assert.throws(()=>encode_actor_id(id({kind:'compound',items:[s('x')]})));
 assert.throws(()=>encode_actor_id(id({kind:'compound',items:[s('x'),{kind:'compound',items:[s('y'),s('z')]}]})));
});
test('truncation, extensions, wrong version and invalid tokens are rejected',()=>{
 const v=encode_actor_id(id(s('test')));
 for(const b of [v.subarray(0,-1),Buffer.concat([v,Buffer.from([0])]),
   Buffer.concat([Buffer.from('BAID'),v.subarray(4)]),
   Buffer.concat([v.subarray(0,4),Buffer.from([2]),v.subarray(5)])])assert.throws(()=>decode_actor_id(b));
 assert.throws(()=>parse_actor_ref_token(actor_ref_token(id(s('test')))+'='));
});
test('cross-backend golden identity vector',()=>{
 const v=id(s('customer-42'));
 assert.equal(encode_actor_id(v).toString('hex'),'4f41494401000874656e616e742d610008636f6d6d65726365000d73686f7070696e675f6361727401000b637573746f6d65722d3432');
 assert.equal(actor_id_hash(v),'b2dbb6759eda51e096106dd0a0c9b87b29ba03d9df9008650152674bdd5f3498');
});
