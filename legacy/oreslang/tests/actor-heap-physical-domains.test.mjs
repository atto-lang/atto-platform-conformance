import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyPhysicalActorHeapPolicy } from '../tools/verify-actor-heap-domains.mjs';
const canonical=JSON.parse(readFileSync(
  new URL('../fixtures/actor-memory/compiled-guest-v1/physical-domains-v1.json',import.meta.url),'utf8'));
const clone=()=>structuredClone(canonical);
test('six backend heap strategies have no compiled-guest pass claim',()=>{
 const result=verifyPhysicalActorHeapPolicy(canonical);
 assert.equal(result.backendCount,6);
 assert.equal(result.guestEvidence,'NOT_EXECUTED');
 assert.deepEqual(canonical.guestVerifications,[]);
});
for(const name of ['java','llvm','wasm','cranelift','net','forge']){
 test(name+' has an explicit non-promotable physical storage strategy',()=>{
  const m=clone();
  assert.equal(typeof m.backends[name].actorHeap,'string');
  assert.notEqual(m.backends[name].guestLowering,'VERIFIED');
  assert.equal(verifyPhysicalActorHeapPolicy(m).backendCount,6);
 });
 test(name+' cannot silently change heap strategy or promote source execution',()=>{
  const m=clone();m.backends[name].guestLowering='VERIFIED';
  assert.throws(()=>verifyPhysicalActorHeapPolicy(m),/strategy or evidence promotion/);
 });
}
for(const [name,mutate] of [
 ['same physical Java arena shared by actors',m=>m.backends.java.actorHeap='jvm-global-managed-heap'],
 ['Wasm tenant Store wrongly treated as a separate actor heap',m=>m.backends.wasm.actorHeap='one-store-per-tenant-is-actor-heap'],
 ['managed CLR dictionary called private actor heap',m=>m.backends.net.actorHeap='managed-dictionary'],
 ['Cranelift actor parsing silently admitted',m=>m.backends.cranelift.guestLowering='NOT_VERIFIED'],
 ['Forge confused with Cranelift',m=>{delete m.backends.forge;}],
 ['lost LLVM no-sandbox caveat',m=>m.backends.llvm.tenantBoundary='os-sandbox'],
 ['host tests treated as compiled guest proof',m=>m.compilerOnlyOrHostOnlyIsGuestEvidence=true],
 ['trusted JVM process called tenant sandbox',m=>m.trustedProcessIsSecurityBoundary=true],
 ['self-declared guest verification',m=>m.guestVerifications.push('llvm')],
 ['foreign actor owner gate dropped',m=>m.requiredSemantics.splice(2,1)],
 ['loan-gated retirement dropped',m=>m.requiredSemantics.splice(4,1)],
 ['survivor progress dropped',m=>m.requiredSemantics.splice(8,1)],
 ['unreviewed backend injected',m=>m.backends.js={...m.backends.java}],
 ['unknown policy key inserted',m=>m.claimedPass=true]
]){
 test('deny '+name,()=>{const m=clone();mutate(m);assert.throws(
  ()=>verifyPhysicalActorHeapPolicy(m),/actor-heap-domain-contract:/);});
}
