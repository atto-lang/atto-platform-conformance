import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectAotTargetProfile as inspect} from '../lib/aot-release-target-profiles-v1.mjs';
const inv=JSON.parse(readFileSync(new URL('../contracts/strict-guest-aot-lanes-v1.json',import.meta.url),'utf8'));
const TARGETS={
 'linux-x64':'x86_64-unknown-linux-gnu',
 'linux-arm64':'aarch64-unknown-linux-gnu',
 'windows-x64':'x86_64-pc-windows-msvc',
 'macos-arm64':'aarch64-apple-darwin'
};
const mk=lane=>({
 laneId:lane.id,backend:lane.backend,platform:lane.platform,
 targetTriple:TARGETS[lane.platform],artifactFormat:lane.artifactFormat,
 sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),
 compilerCommit:'c'.repeat(40),compilerTree:'d'.repeat(40),
 compilerBinarySha256:'e'.repeat(64),guestBinarySha256:'f'.repeat(64)
});
test('all 16 source-only release target profiles shape-check, none attest release',()=>{
 assert.equal(inv.lanes.length,16);
 for(const lane of inv.lanes) {
   const out=inspect(inv,mk(lane));
   assert.equal(out.classification,'TARGET_PROFILE_SHAPE_VALID_UNATTESTED',lane.id+': '+out.errors);
   assert.equal(out.releaseQualified,false);
 }
});
test('reject cross-target, cross-backend and binary identity swaps',()=>{
 for(const mutate of [
   x=>{x.targetTriple='x86_64-unknown-linux-gnu';},
   x=>{x.artifactFormat='PE32+';},
   x=>{x.backend='wasm';},
   x=>{x.laneId='forge-windows-x64';},
   x=>{x.compilerTree='F'.repeat(40);},
   x=>{x.sourceCommit='';},
   x=>{x.guestBinarySha256='0'.repeat(64);},
   x=>{x.compilerBinarySha256=null;},
   x=>{x.guestExecuted=true;},
   x=>{Object.defineProperty(x,'sourceTree',{get(){throw Error('trap')},enumerable:true});}
 ]) {
   const x=mk(inv.lanes[5]);mutate(x);
   assert.equal(inspect(inv,x).classification,'INVALID');
 }
});
test('altered, release-spoofed inventory never produces target authorization',()=>{
 const broken=structuredClone(inv);
 broken.lanes[0].status='VERIFIED';
 assert.equal(inspect(broken,mk(inv.lanes[0])).classification,'INVALID');
});
