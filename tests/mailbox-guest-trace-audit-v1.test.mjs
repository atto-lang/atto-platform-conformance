import test from 'node:test';
import assert from 'node:assert/strict';
import {auditClaimedGuestMailboxTrace as audit} from '../src/mailbox-guest-trace-audit-v1.mjs';

const hex=(c,n)=>c.repeat(n);
const event=(id,op,invoke,complete,result,ticket)=>({
  id,op,invoke,complete,result,...(ticket?{ticket}:{})
});
const history=events=>({schema:'oreslang.mailbox_linearizability.v1',capacity:2,events});
const actor=(id='A')=>({actorId:id,incarnation:1,history:history([
  event('send1','send',1,2,'ACCEPTED','t1'),
  event('stop','close',3,4,'CLOSED'),
  event('cancel','cancel',5,6,'ALREADY_CANCELLED','t1'),
  event('drain','probe',7,8,'MAILBOX_DRAINED')
])});
const base=()=>({schema:'oreslang.claimed_guest_mailbox_trace.v1',backend:'llvm',
  fixtureId:'ACTOR_SEND_STOP',
  fixtureGitBlobSha:'3050260bd65b019a2b00191fba9086971409511b',
  run:{repository:'ores-truffle-oreslang/oreslang-source.llvm',
    headSha:hex('a',40),treeSha:hex('b',40),compilerSha256:hex('c',64),
    executionMode:'LLVM_NATIVE',runId:12,jobId:15,stepsExecuted:3,
    compiledGuest:true,guestExecuted:true,logSha256:hex('d',64)},
  actors:[actor()]});
const reject=x=>assert.throws(()=>audit(x),/INVALID_GUEST_MAILBOX_TRACE/);

test('self-reported source guest trace can never authenticate itself',()=>{
  const out=audit(base());
  assert.equal(out.status,'HISTORY_SHAPE_LINEARIZABLE');
  assert.deepEqual(out.modelResults[0].witness,['send1','stop','cancel','drain']);
  assert.equal(out.classification,'UNTRUSTED_SELF_REPORTED_NATIVE_TRACE_SHAPE_ONLY');
  for(const key of ['compilerExecutedAuthenticated','guestExecutedAuthenticated',
    'nativeExecutionAuthenticated','parityCertified','releaseReady'])
    assert.equal(out[key],false);
});
test('observed event contradiction is candidate refinement conflict, not proven native failure',()=>{
  const h=base();
  h.actors[0].history.events[2].result='TOO_LATE';
  const out=audit(h);
  assert.equal(out.status,'MODEL_REFINEMENT_CONFLICT_CANDIDATE');
  assert.equal(out.parityCertified,false);
});
test('cross-actor identities are independently audited without inventing global linearization',()=>{
  const h=base();
  h.fixtureId='ACTOR_INTERLEAVED_STOP';
  h.fixtureGitBlobSha='c7488835f34e926dfa4c8766c8917301fe84da09';
  h.actors.push(actor('B'));
  const out=audit(h);
  assert.equal(out.modelResults.length,2);
  assert.equal(out.nativeExecutionAuthenticated,false);
});
test('reject forged pass, extraneous raw payload, and untrusted attestation fields',()=>{
  for(const mutate of [
    x=>x.parityCertified=true,
    x=>x.run.signedByGithub=true,
    x=>x.run.stepsExecuted=0,
    x=>x.run.guestExecuted=false,
    x=>x.run.compilerSha256='bad',
    x=>x.run.executionMode='HOST_SIMULATION',
    x=>x.run.repository='scintilla-run-test/gleam-runner-conformance',
    x=>x.backend='unsupported',
    x=>x.fixtureGitBlobSha='0'.repeat(40),
    x=>x.fixtureId='ACTOR_SEND_AFTER_STOP_REJECT',
    x=>x.actors[0].payload='private',
    x=>x.actors[0].actorId='../unsafe',
    x=>x.actors[0].incarnation=0,
    x=>x.actors[0].history.events[0].timestamp=99,
    x=>x.actors[0].history.events[0].result='ACCEPTED\nAUTHENTICATED'
  ]) {const x=base();mutate(x);reject(x);}
});
test('missing physical trace, aggregate-only receipt, duplicate actor are denied',()=>{
  const x=base();delete x.actors[0].history;reject(x);
  const y=base();y.actors=[{actorId:'A',incarnation:1,
    aggregate:'SOURCE_ACTOR_SPAWN_STOP_VERIFIED accepted=1'}];reject(y);
  const z=base();z.actors.push(actor('A'));reject(z);
});
test('bounded resource limits reject unbounded envelopes',()=>{
  const h=base();h.actors=[actor('A'),actor('B'),actor('C'),actor('D'),actor('E')];reject(h);
});
