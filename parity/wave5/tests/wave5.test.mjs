import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorMemoryAuthority} from '../src/actor-memory.mjs';
import {inspectNative,inspectWasm,inspectFile,sha256} from '../src/artifacts.mjs';
import {inspectAot,observeGuest,validateProfile,TASKS} from '../src/evidence.mjs';
import {loadManifest,validateManifest} from '../src/manifest.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const wasm=Buffer.from('0061736d010000000105016000017e03020100070d01096f7265735f6d61696e00000a06010400422a0b','hex');
const section=(id,payload)=>Buffer.concat([Buffer.from([id,payload.length]),payload]);
const miniElf=(machine=62)=>{const b=Buffer.alloc(128);b.set([0x7f,0x45,0x4c,0x46,2,1,1]);b.writeUInt16LE(3,16);b.writeUInt16LE(machine,18);b.writeBigUInt64LE(0x1000n,24);b.writeBigUInt64LE(64n,32);b.writeUInt16LE(56,54);b.writeUInt16LE(1,56);return b};
const miniPE=(cli=false)=>{const b=Buffer.alloc(600);b.write('MZ',0,'ascii');b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80,'ascii');const coff=0x84,opt=coff+20;b.writeUInt16LE(0x8664,coff);b.writeUInt16LE(1,coff+2);b.writeUInt16LE(240,coff+16);b.writeUInt16LE(2,coff+18);b.writeUInt16LE(0x20b,opt);b.writeUInt32LE(0x1000,opt+16);b.writeUInt32LE(16,opt+108);if(cli){b.writeUInt32LE(0x2000,opt+112+14*8);b.writeUInt32LE(72,opt+112+14*8+4)}return b};
test('21 / new shared actors retain independent actor-owned local domains',()=>{
 const m=new ActorMemoryAuthority();const a=m.createActor('shared-a'),b=m.createActor('shared-b');
 const ah=m.allocate(a,{nested:{n:7}}),bh=m.allocate(b,{nested:{n:2}});
 assert.equal(m.read(a,ah).nested.n,7);assert.equal(m.read(b,bh).nested.n,2);
 assert.throws(()=>m.read(b,ah),/foreign/);assert.equal(m.stats(a).blocks,1);
});
test('21 / intentional snapshots are readonly, scoped to recipient, invalidated on drop',()=>{
 const m=new ActorMemoryAuthority(),a=m.createActor('a'),b=m.createActor('b'),c=m.createActor('c');
 const h=m.allocate(a,{value:5}),share=m.snapshotFor(a,h,b);
 assert.equal(m.readSnapshot(b,share).value,5);assert.equal(Object.isFrozen(m.readSnapshot(b,share)),true);
 assert.throws(()=>m.readSnapshot(c,share),/foreign/);
 m.drop(a,h);assert.throws(()=>m.readSnapshot(b,share),/expired/);
});
test('21 / copy-to is explicit and source actor cannot borrow target actor handle',()=>{
 const m=new ActorMemoryAuthority(),a=m.createActor('a'),b=m.createActor('b');
 const h=m.allocate(a,[1,2,3]),copy=m.copyTo(a,b,h);m.drop(a,h);
 assert.deepEqual(m.read(b,copy),[1,2,3]);assert.throws(()=>m.read(a,copy),/foreign/);
});
test('21 / quota, max block count and tiny zero-byte blocks charge resources',()=>{
 const m=new ActorMemoryAuthority({maxActors:1,maxBlocksPerActor:2,maxTotalBytes:60});
 const a=m.createActor('a',60);m.allocate(a,'');m.allocate(a,'');
 assert.equal(m.stats(a).blocks,2);assert.throws(()=>m.allocate(a,''),/block count/);
 assert.throws(()=>m.createActor('b',60),/capacity/);
});
test('21 / stale capabilities and handles never regain authority after actor reincarnation',()=>{
 const m=new ActorMemoryAuthority(),old=m.createActor('a'),h=m.allocate(old,1);
 m.retire(old);const newer=m.createActor('a');
 assert.throws(()=>m.read(old,h),/stale/);assert.throws(()=>m.read(newer,h),/foreign|stale/);
});
test('21 / getters, symbols, sparse arrays, host objects and cyclic source are excluded',()=>{
 const m=new ActorMemoryAuthority(),a=m.createActor('a');
 const evil={get value(){throw Error('getter invoked!')}};const cycle={};cycle.self=cycle;
 for(const v of [evil,{[Symbol('leak')]:1},new Date(),[,,5],cycle])assert.throws(()=>m.allocate(a,v),/wave5-memory:/);
});
test('22 + 24 / ELF64 identity and machine checks reject interpreter/source wrappers',()=>{
 const r=inspectNative(miniElf(),'elf-x86_64');
 assert.equal(r.format,'elf');assert.equal(r.binaryShapeOnly,true);
 assert.throws(()=>inspectNative(miniElf(183),'elf-x86_64'),/machine/);
 assert.throws(()=>inspectNative(Buffer.from('#!/bin/sh\n'),'elf-x86_64'),/size|not ELF/);
 assert.throws(()=>inspectNative(Buffer.from('define actor X as end'),'elf-x86_64'),/size|not ELF/);
});
test('23 / PE32+ rejects a managed CIL CLR directory and mismatched machine',()=>{
 const p=inspectNative(miniPE(false),'pe-x64');
 assert.equal(p.cliDirectory,'absent');assert.equal(p.binaryShapeOnly,true);
 assert.throws(()=>inspectNative(miniPE(true),'pe-x64'),/managed CIL/);
 assert.throws(()=>inspectNative(miniPE(false),'pe-arm64'),/machine/);
});
test('22 + 24 / Mach-O requires executable kind and correct architecture',()=>{
 const b=Buffer.alloc(96);b.writeUInt32LE(0xfeedfacf,0);b.writeUInt32LE(0x01000007,4);b.writeUInt32LE(2,12);b.writeUInt32LE(1,16);b.writeUInt32LE(32,20);
 assert.equal(inspectNative(b,'macho-x86_64').format,'macho');
 assert.throws(()=>inspectNative(b,'macho-arm64'),/executable/);
});
test('25 / actual WebAssembly engine executes a valid zero-import i64 guest control',()=>{
 const observed=new WebAssembly.Instance(new WebAssembly.Module(wasm),{}).exports.ores_main();
 assert.equal(observed,42n);
 const report=inspectWasm(wasm,{profile:'scalar'});
 assert.deepEqual(report.imports,[]);assert.equal(report.binaryShapeOnly,true);
});
test('25 / malformed header, start section and out-of-order sections fail closed',()=>{
 assert.throws(()=>inspectWasm(Buffer.from('0061736d00000000','hex')),/canonical/);
 const extra=Buffer.concat([wasm.subarray(0,wasm.length-8),section(8,Buffer.from([0])),wasm.subarray(wasm.length-8)]);
 assert.throws(()=>inspectWasm(extra),/start|out-of-order/);
});
test('25 / unauthorized or unbounded Wasm imports are rejected even in capability profile',()=>{
 const type=section(1,Buffer.from([1,0x60,0,1,0x7e]));
 const module=Buffer.from('evil'),member=Buffer.from('syscall');
 const importPayload=Buffer.concat([Buffer.from([1,module.length]),module,Buffer.from([member.length]),member,Buffer.from([0,0])]);
 const imported=Buffer.concat([wasm.subarray(0,8),type,section(2,importPayload),wasm.subarray(15)]);
 assert.throws(()=>inspectWasm(imported,{profile:'scalar'}),/unauthorized|out-of-order/);
 assert.throws(()=>inspectWasm(imported,{profile:'capability',allowedImports:['ores_host.clock_now']}),/unauthorized|out-of-order/);
});
test('25 / duplicate export, nonexistent source guest entry, unsupported magic are rejected',()=>{
 const wrong=Buffer.from(wasm);const pattern=Buffer.from('ores_main');
 wrong[wrong.indexOf(pattern)]=0x78;
 assert.throws(()=>inspectWasm(wrong),/ores_main/);
 const ir=Buffer.from('; ModuleID = "fake"');assert.throws(()=>inspectWasm(ir),/canonical/);
});
test('21–25 / strict task/backend/architecture mapping',()=>{
 assert.deepEqual(Object.keys(TASKS),['21','22','23','24','25']);
 validateProfile({task:22,backend:'llvm',target:'elf-x86_64'});
 validateProfile({task:23,backend:'net',target:'pe-arm64'});
 validateProfile({task:24,backend:'forge',target:'elf-aarch64'});
 validateProfile({task:25,backend:'wasm',target:'wasm32'});
 for(const [task,backend,target] of [[23,'net','elf-x86_64'],[22,'forge','elf-x86_64'],[25,'wasm','pe-x64'],[21,'llvm','elf-x86_64']])
  assert.throws(()=>validateProfile({task,backend,target}),/wave5-evidence/);
});
test('21–25 / artifact SHA is mandatory and binary shape never certifies Native AOT',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ores-w5-'));try{
  const p=join(dir,'control.wasm');await writeFile(p,wasm);
  await assert.rejects(inspectAot({task:25,backend:'wasm',target:'wasm32',artifactPath:p,artifactSha256:'0'.repeat(64)}),/hash changed/);
  const r=await inspectAot({task:25,backend:'wasm',target:'wasm32',artifactPath:p,artifactSha256:sha256(wasm)});
  assert.equal(r.status,'ARTIFACT_SHAPE_OBSERVED');assert.equal(r.compilerExecuted,false);assert.equal(r.nativeAotProven,false);assert.equal(r.parityVerified,false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('22 + 24 / actual local Clang ELF control builds, inspects and executes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ores-w5-clang-'));try{
  const src=join(dir,'control.c'),exe=join(dir,'control');await writeFile(src,'#include <stdio.h>\nint main(void) { puts("42"); return 0; }\n');
  const built=spawnSync('clang',['-O2',src,'-o',exe],{encoding:'utf8',timeout:15000});
  assert.equal(built.status,0,built.stderr||'clang unavailable');
  const {readFile}=await import('node:fs/promises');const bin=await readFile(exe);
  const info=await inspectAot({task:22,backend:'llvm',target:'elf-x86_64',artifactPath:exe,artifactSha256:sha256(bin)});
  assert.equal(info.artifactShape.format,'elf');
  const outcome=observeGuest({argv:[exe],expectedStdout:'42\n'});
  assert.equal(outcome.status,'GUEST_RESULT_OBSERVED');assert.equal(outcome.parityVerified,false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('22–25 / runtime mismatch, skipped guest, timeout and signal cannot pass as execution',()=>{
 assert.throws(()=>observeGuest({argv:[process.execPath,'-e','process.stdout.write("41")'],expectedStdout:'42'}),/mismatch/);
 assert.throws(()=>observeGuest({argv:[process.execPath,'-e','process.exit(1)'],expectedStdout:''}),/mismatch/);
 assert.throws(()=>observeGuest({argv:['node'],expectedStdout:''}),/absolute/);
});
test('manifest / all source programs retain the canonical exact Git-blob identity',async()=>{
 const m=await loadManifest();assert.equal(m.fixtures.length,6);assert.equal(m.tasks.length,5);assert.equal(m.certifiedParity,false);
 assert.equal(new Set(m.fixtures.slice(2).map(x=>x.gitBlob)).size,1);
});
test('manifest / cannot silently reassign native suites or claim parity',async()=>{
 const original=await loadManifest();
 for(const mutation of [m=>m.certifiedParity=true,m=>m.fixtures[2].backend='forge',m=>m.backends.pop(),m=>m.fixtures[0].verified=true,m=>m.tasks[4].id=22,m=>m.fixtures[3].gitBlob='0'.repeat(40)]){
  const cloned=structuredClone(original);mutation(cloned);assert.throws(()=>validateManifest(cloned),/wave5-manifest/);
 }
});

test('25 / explicitly allowlisted, function-only wasm capability import is usable by real engine',()=>{
 const section=(id,p)=>Buffer.concat([Buffer.from([id,p.length]),p]);
 const header=wasm.subarray(0,8),type=section(1,Buffer.from([1,0x60,0,1,0x7e]));
 const a=Buffer.from('ores_host'),b=Buffer.from('clock_now');
 const imp=section(2,Buffer.concat([Buffer.from([1,a.length]),a,Buffer.from([b.length]),b,Buffer.from([0,0])]));
 const fn=section(3,Buffer.from([1,0]));
 const exp=section(7,Buffer.concat([Buffer.from([1,9]),Buffer.from('ores_main'),Buffer.from([0,1])]));
 const code=section(10,Buffer.from([1,4,0,0x42,42,0x0b]));
 const moduleBytes=Buffer.concat([header,type,imp,fn,exp,code]);
 assert.throws(()=>inspectWasm(moduleBytes,{profile:'scalar'}),/unauthorized/);
 const inspected=inspectWasm(moduleBytes,{profile:'capability',allowedImports:['ores_host.clock_now']});
 assert.deepEqual(inspected.imports,['ores_host.clock_now']);
 const guest=new WebAssembly.Instance(new WebAssembly.Module(moduleBytes),{ores_host:{clock_now:()=>0n}});
 assert.equal(guest.exports.ores_main(),42n);
});
test('25 / bounded Wasm memory must declare an explicit maximum',()=>{
 const section=(id,p)=>Buffer.concat([Buffer.from([id,p.length]),p]);
 const prefix=wasm.subarray(0,19); // magic + type + function sections
 const postfix=wasm.subarray(19);
 const bounded=Buffer.concat([prefix,section(5,Buffer.from([1,1,1,2])),postfix]);
 const inspected=inspectWasm(bounded);
 assert.equal(inspected.memoryMaximum,2);
 assert.doesNotThrow(()=>new WebAssembly.Module(bounded));
 const unbounded=Buffer.concat([prefix,section(5,Buffer.from([1,0,1])),postfix]);
 assert.throws(()=>inspectWasm(unbounded),/maximum|flag/);
});


test('21 / array accessors and proxies never execute during admission',()=>{
 const m=new ActorMemoryAuthority(),a=m.createActor('a');
 let calls=0;
 const getter=[1];
 Object.defineProperty(getter,'0',{enumerable:true,get(){calls++;return 7;}});
 const proxy=new Proxy([1],{getPrototypeOf(){calls++;return Array.prototype;}});
 for(const value of [getter,proxy])assert.throws(()=>m.allocate(a,value),/wave5-memory:/);
 assert.equal(calls,0);
 assert.equal(m.stats(a).blocks,0);
});
