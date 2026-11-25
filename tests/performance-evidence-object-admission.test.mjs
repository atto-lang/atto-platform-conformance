import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePerformanceEvidence} from '../src/performance-evidence.mjs';
const make=()=>({schemaVersion:1,status:'UNCONFIGURED',family:'software',
  backend:'llvm',mode:'unit',sourceSha:'0'.repeat(40),compilerSha256:'0'.repeat(64),
  fixtureSha256:'0'.repeat(64),
  toolchain:{name:'clang',version:'unconfigured'},
  environment:{target:'unknown',cpu:'unknown',clockPolicy:'unknown'},
  kind:'latency',unit:'ns',samples:[],correctness:'UNVERIFIED',evidence:[]});
test('top-level and nested Proxies reject before reading properties',()=>{
  let calls=0;
  const wrap=v=>new Proxy(v,{get(t,k){calls++;return Reflect.get(t,k);}});
  assert.throws(()=>validatePerformanceEvidence(wrap(make())),/plain data object/);
  let r=make();r.toolchain=wrap(r.toolchain);
  assert.throws(()=>validatePerformanceEvidence(r),/plain data object/);
  r=make();r.samples=wrap(r.samples);
  assert.throws(()=>validatePerformanceEvidence(r),/bounded plain array/);
  assert.equal(calls,0);
});
test('accessors on top level, toolchain and sample arrays never execute',()=>{
  let calls=0;
  const addGetter=(v,k)=>Object.defineProperty(v,k,{configurable:true,enumerable:true,
    get(){calls++;return k==='status'?'UNCONFIGURED':'not-an-admitted-value';}});
  let r=make();addGetter(r,'status');
  assert.throws(()=>validatePerformanceEvidence(r),/accessor fields/);
  r=make();addGetter(r.toolchain,'name');
  assert.throws(()=>validatePerformanceEvidence(r),/accessor fields/);
  r=make();r.samples=[1];addGetter(r.samples,'0');
  assert.throws(()=>validatePerformanceEvidence(r),/own-data array/);
  assert.equal(calls,0);
});
test('sparse arrays, inherited metadata and unexpected symbols deny',()=>{
  const r=make();r.samples=new Array(2);
  assert.throws(()=>validatePerformanceEvidence(r),/dense own-data array/);
  const e=make();e.evidence[Symbol('forged')]=true;
  assert.throws(()=>validatePerformanceEvidence(e),/dense own-data array/);
  const p=make();p.toolchain=Object.assign(Object.create({bogus:true}),
    {name:'clang',version:'unconfigured'});
  assert.throws(()=>validatePerformanceEvidence(p),/plain data object/);
});
test('revoked proxies reject without invoking traps',()=>{
  const p=Proxy.revocable(make(),{});p.revoke();
  assert.throws(()=>validatePerformanceEvidence(p.proxy),/plain data object/);
  const r=make(),n=Proxy.revocable([],{});n.revoke();r.evidence=n.proxy;
  assert.throws(()=>validatePerformanceEvidence(r),/bounded plain array/);
});
test('normal null-prototype data records still validate without certification',()=>{
  const r=make();const original=r.toolchain;
  r.toolchain=Object.assign(Object.create(null),original);
  const value=validatePerformanceEvidence(r);
  assert.equal(value.structurally_valid,true);
  assert.equal(value.performance_claim_certified,false);
  assert.equal(value.provenance_authenticated,false);
});
