import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContract } from '../bin/verify-otel-contract.mjs';
import { parseUniqueJSON } from '../bin/verify-otel-guest-parity.mjs';

const approved = JSON.parse(readFileSync('contracts/otel-five-backend-v1.json','utf8'));
const reject = fn => assert.throws(fn, /OTEL_CONTRACT_DENIED/);
const mut = change => {const v=structuredClone(approved);change(v);reject(()=>validateContract(v));};

test('canonical six-profile OTel manifest is always an unverified source-only contract',()=>{
  assert.deepEqual(validateContract(approved),
    {classification:'SOURCE_ONLY_CANDIDATE',profiles:6,backends:5,guestExecuted:false,releaseCertified:false});
});
test('five per-backend status promotions must be impossible',()=>{
  for(let i=0;i<5;i++){
    mut(c=>{c.currentEvidence[i].status='EXECUTED_GUEST';});
    mut(c=>{c.currentEvidence[i].status='CERTIFIED_PARITY';});
    mut(c=>{c.currentEvidence[i].reason='passed';});
  }
});
test('inherited property names, duplicate backends and fake profiles reject',()=>{
  mut(c=>{c.currentEvidence[0].backend='constructor';});
  mut(c=>{c.currentEvidence[0].backend='__proto__';});
  mut(c=>{c.currentEvidence[0].backend='toString';});
  mut(c=>{c.currentEvidence[0].backend='llvm';});
  mut(c=>{c.requiredProfiles[0].profile='graalvm-jit';});
  mut(c=>{c.requiredProfiles[0]=structuredClone(c.requiredProfiles[1]);});
  mut(c=>{c.requiredProfiles[0].compiler='foreign-org/oreslang-source.java';});
  mut(c=>{c.requiredProfiles.push(structuredClone(c.requiredProfiles[0]));});
});
test('source code identities, signal cardinality and security gates cannot be silently rewritten',()=>{
  mut(c=>{c.library.fixtureGitBlob='a'.repeat(40);});
  mut(c=>{c.library.implementationGitBlob='f'.repeat(40);});
  mut(c=>{c.library.legacyExtension='.atto';});
  mut(c=>{c.signals.logs=7;});
  mut(c=>{c.signals.total=8;});
  mut(c=>{c.security=[];});
  mut(c=>{c.security[0]='Private source is freely exportable and permitted without gate approval';});
  mut(c=>{c.security[4]='Unbounded blocking telemetry may be used in actor carrier threads';});
  mut(c=>{c.promotion='EXECUTED';});
  mut(c=>{c.classification='GUEST_VERIFIED';});
  mut(c=>{c.releaseCertified=true;});
});

test('canonical manifest duplicate JSON members cannot hide certification or identity drift',()=>{
  reject(()=>parseUniqueJSON('{"classification":"EXECUTED_GUEST","classification":"CANDIDATE_ONLY"}'));
  reject(()=>parseUniqueJSON('{"library":{"fixture":"forged","fixt\\u0075re":"tests/smoke.ores"}}'));
});
