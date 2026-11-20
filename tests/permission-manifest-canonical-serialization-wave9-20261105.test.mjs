import test from 'node:test';
import assert from 'node:assert/strict';
import {denyAllPolicy,serializeManifest} from '../src/permission-manifest.mjs';

const digest='a'.repeat(64);
const manifest=policy=>({
  format:'oreslang.permissions', version:1,artifact_sha256:digest,
  policy:policy??denyAllPolicy()
});

test('policy insertion order never changes canonical serialized authority',()=>{
  const p=denyAllPolicy();
  const reversed=Object.fromEntries(Object.entries(p).reverse());
  assert.equal(serializeManifest(manifest(p)),serializeManifest(manifest(reversed)));
});

test('scope lists are normalized into deterministic lexical order',()=>{
  const p=denyAllPolicy();
  p.read.allow=['z','a'];
  assert.match(serializeManifest(manifest(p)),/"allow":\["a","z"\]/);
});

test('unknown manifest keys fail closed before serialization',()=>{
  assert.throws(()=>serializeManifest({...manifest(),unknown:true}),/missing or unknown keys/);
});

test('getter-backed policy fields are rejected without invocation',()=>{
  const m=manifest();let calls=0;
  Object.defineProperty(m,'policy',{enumerable:true,get(){calls++;throw Error('getter executed');}});
  assert.throws(()=>serializeManifest(m),/requires own data fields/);
  assert.equal(calls,0);
});

test('duplicate and unpaired-surrogate scopes cannot be signed as canonical',()=>{
  const dup=denyAllPolicy();dup.read.allow=['same','same'];
  assert.throws(()=>serializeManifest(manifest(dup)),/duplicate scope/);
  const broken=denyAllPolicy();broken.read.allow=['bad\ud800'];
  assert.throws(()=>serializeManifest(manifest(broken)),/invalid scope/);
});

test('aggregate manifest byte budget is capped even with individually valid scopes',()=>{
  const p=denyAllPolicy();
  p.read.allow=Array.from({length:25},(_,i)=>'scope'+i+'-'+'x'.repeat(3000));
  assert.throws(()=>serializeManifest(manifest(p)),/64 KiB/);
});

test('uppercase artifact SHA-256 spelling is not canonical authority',()=>{
  assert.throws(()=>serializeManifest({...manifest(),artifact_sha256:'F'.repeat(64)}),/artifact digest/);
});
