// Host-only self-report gate; no authenticated runner or native guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTOR_FINALIZATION_BACKENDS,validateActorFinalizationLedger,
  actorFinalizationReleaseGate} from '../src/actor-finalization-evidence-v1.mjs';

test('plausible offline release flags are only shape checks, never release authority',()=>{
  const checks=[
    {backend:'llvm',sanitized:true},
    {backend:'cranelift',sanitized:true},
    {backend:'forge',sanitized:true},
    {backend:'net',strictAot:true},
    {backend:'java'},
    {backend:'wasm'}
  ];
  for(const entry of checks){
    const r=actorFinalizationReleaseGate({...entry,
      shapeReady:true,independentlyAuthenticated:true});
    assert.equal(r.shapeRequirementsMet,true,entry.backend);
    assert.equal(r.ready,false,entry.backend);
    assert.equal(r.independentProviderVerificationRequired,true);
  }
});

test('native sanitizer and .NET full-AOT declarations do not become release evidence',()=>{
  const net=actorFinalizationReleaseGate({backend:'net',strictAot:false,
    shapeReady:true,independentlyAuthenticated:true});
  assert.equal(net.ready,false);
  assert.match(net.errors.join(' '),/NET_NATIVE_AOT_REQUIRED/);
  const llvm=actorFinalizationReleaseGate({backend:'llvm',sanitized:false,
    shapeReady:true,independentlyAuthenticated:true});
  assert.match(llvm.errors.join(' '),/NATIVE_SANITIZERS_REQUIRED/);
});

test('five self-reported guest claims never manufacture an authenticated parity ledger',()=>{
  const ledger={backends:ACTOR_FINALIZATION_BACKENDS.map(backend=>({
    backend,status:'guest-claimed',exactHeadEvidence:'self-reported'}))};
  const r=validateActorFinalizationLedger(ledger);
  assert.equal(r.valid,true);
  assert.equal(r.parityCertified,false);
  const impostor={backends:[...ledger.backends.slice(0,-1),
    {backend:'forge',status:'guest-claimed',exactHeadEvidence:'self-reported'}]};
  assert.equal(validateActorFinalizationLedger(impostor).valid,false);
});
