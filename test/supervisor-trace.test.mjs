import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySupervisorTrace } from '../bin/verify-supervisor-trace.mjs';

const sourceSha = '1111111111111111111111111111111111111111';
const event = (seq, op, extras={}) => {
  const child = extras.child ?? 'child-1';
  const generation = extras.generation ?? 1;
  const actor = extras.actor ?? (child === 'child-2' ? 'actor-C' :
    generation === 2 ? 'actor-B' : 'actor-A');
  return {seq, op, child, supervisor:'root', generation, actor,
    ...(op.startsWith('stop.') ? {stopPermitId:child==='child-2'?'stop-ticket-2':'stop-ticket-1'} : {}),
    ...extras};
};
const rawDoc = events => ({schemaVersion:2,backend:'java',sourceSha,events});
const doc = (events, status='completed') => rawDoc([...events,{
  seq:events.length+1,op:'trace.end',status,recordedEvents:events.length
}]);
const stop = () => [
  event(1,'register'),
  event(2,'cleanup'),
  event(3,'finalize'),
  event(4,'control.acquire',{turn:1}),
  event(5,'stop.reserve',{turn:1}),
  event(6,'stop.invoke',{turn:1}),
  event(7,'stop.applied',{turn:1}),
  event(8,'stop.ack',{turn:1})
];
const restart = () => [
  ...stop().slice(0,4),
  event(5,'restart.reserve',{turn:1,permitId:'permit-1'}),
  event(6,'restart.spawn',{turn:1,permitId:'permit-1',newActor:'actor-B',newGeneration:2}),
  event(7,'restart.admit',{turn:1,permitId:'permit-1',newActor:'actor-B',
    newGeneration:2,admissionId:'admission-1'}),
  event(8,'restart.commit',{turn:1,permitId:'permit-1',newActor:'actor-B',newGeneration:2})
];
const expectReject = (events, pattern, status='completed') =>
  assert.throws(() => verifySupervisorTrace(doc(events,status)), pattern);

test('acknowledged STOP has one effect and one ACK', () => {
  const result = verifySupervisorTrace(doc(stop()));
  assert.deepEqual(
    [result.ok,result.invocations,result.acknowledgments,result.restartCommits,result.completion],
    [true,1,1,0,'completed']);
});
test('ambiguous STOP requires independent proof, including after shutdown', () => {
  const events=stop().slice(0,6);
  events.push(event(7,'stop.uncertain',{turn:1}));
  events.push(event(8,'supervisor.close'));
  expectReject([...events,event(9,'stop.ack',{turn:1})],/unverified ambiguous/,'quarantined');
  assert.equal(verifySupervisorTrace(doc(events,'quarantined')).completion,'quarantined');
  events.push(event(9,'stop.proof',{turn:1,evidenceId:'independent-proof-1'}));
  events.push(event(10,'stop.ack',{turn:1}));
  // The marker string alone cannot establish a trusted host effect.
  assert.throws(() => verifySupervisorTrace(doc(events)), /trusted independent host proof verifier required/);
  const proof = e => e.evidenceId === 'independent-proof-1' &&
    e.backend === 'java' && e.child === 'child-1' &&
    e.generation === 1 && e.actor === 'actor-A' &&
    e.turn === 1 && e.stopPermitId === 'stop-ticket-1' && e.receipt === 'Uncertain';
  assert.equal(verifySupervisorTrace(doc(events),{verifyProof:proof}).acknowledgments,1);
  assert.throws(() => verifySupervisorTrace(doc(events),{verifyProof:()=>false}),
    /independent host proof rejected/);
  assert.throws(() => verifySupervisorTrace(doc(events),{verifyProof:()=>{throw Error('bad');}}),
    /trusted independent host proof verifier threw/);
});
test('restart requires distinct physical spawn, admission and exact permit', () => {
  const events=restart();
  assert.equal(verifySupervisorTrace(doc(events)).restartCommits,1);
  expectReject([...events.slice(0,5),event(6,'restart.commit',
    {turn:1,permitId:'permit-1',newActor:'actor-B',newGeneration:2})],
    /replacement not admitted/);
  expectReject([...events.slice(0,6),event(7,'restart.commit',
    {turn:1,permitId:'permit-1',newActor:'actor-B',newGeneration:2})],
    /replacement not admitted/);
  expectReject([...events.slice(0,5),event(6,'restart.spawn',
    {turn:1,permitId:'permit-1',newActor:'actor-A',newGeneration:2})],/ABA reuse/);
  expectReject([...events.slice(0,5),event(6,'restart.spawn',
    {turn:1,permitId:'permit-1',newActor:'actor-B',newGeneration:4})],
    /non-monotonic staged/);
  expectReject([...events.slice(0,6),event(7,'restart.admit',
    {turn:1,permitId:'permit-1',newActor:'actor-X',newGeneration:2,admissionId:'fake'})],
    /admission not tied/);
});
test('abort cannot orphan either spawned or admitted replacement', () => {
  const r=restart();
  expectReject([...r.slice(0,6),event(7,'restart.abort',
    {turn:1,permitId:'permit-1'})], /orphan/);
  expectReject([...r.slice(0,7),event(8,'restart.abort',
    {turn:1,permitId:'permit-1'})], /orphan/);
  const cleaned=[...r.slice(0,7),
    event(8,'restart.cleanup',{turn:1,permitId:'permit-1',newActor:'actor-B',cleanupId:'cleanup-1'}),
    event(9,'restart.abort',{turn:1,permitId:'permit-1'})];
  assert.equal(verifySupervisorTrace(doc(cleaned,'quarantined')).completion,'quarantined');
  // CONTROL ownership remains held after abort (until STOP/retry or shutdown).
  expectReject([...r.slice(0,7),event(8,'restart.cleanup',
    {turn:1,permitId:'wrong-permit',newActor:'actor-B',cleanupId:'cleanup-1'})],
    /cleanup not tied/);
});
test('reused restart permits cannot commit a later reservation (ABA)', () => {
  const r=restart().slice(0,5);
  r.push(event(6,'restart.abort',{turn:1,permitId:'permit-1'}));
  expectReject([...r,event(7,'restart.reserve',{turn:1,permitId:'permit-1'})],
    /replayed or missing/);
  r.push(event(7,'restart.reserve',{turn:1,permitId:'permit-2'}));
  r.push(event(8,'restart.spawn',{turn:1,permitId:'permit-2',newActor:'actor-B',newGeneration:2}));
  r.push(event(9,'restart.admit',{turn:1,permitId:'permit-2',newActor:'actor-B',
    newGeneration:2,admissionId:'admission-2'}));
  expectReject([...r,event(10,'restart.commit',
    {turn:1,permitId:'permit-1',newActor:'actor-B',newGeneration:2})],
    /outside admitted reservation/);
  r.push(event(10,'restart.commit',{turn:1,permitId:'permit-2',
    newActor:'actor-B',newGeneration:2}));
  assert.equal(verifySupervisorTrace(doc(r)).restartCommits,1);
});
test('closing supervisor prevents restart commit but allows physical cleanup', () => {
  const r=restart().slice(0,7);
  r.push(event(8,'supervisor.close'));
  expectReject([...r,event(9,'restart.commit',
    {turn:1,permitId:'permit-1',newActor:'actor-B',newGeneration:2})],
    /CONTROL turn/,'quarantined');
  r.push(event(9,'restart.cleanup',
    {turn:1,permitId:'permit-1',newActor:'actor-B',cleanupId:'cleanup-on-close'}));
  r.push(event(10,'restart.abort',{turn:1,permitId:'permit-1'}));
  assert.equal(verifySupervisorTrace(doc(r)).restartCommits,0);
});
test('physical actor identity is checked on every transition', () => {
  expectReject([...stop().slice(0,5),event(6,'stop.invoke',
    {turn:1,actor:'forged-actor'})],/wrong or replayed physical actor/);
  expectReject([...restart(),event(9,'cleanup',{generation:2,actor:'actor-A'})],
    /wrong or replayed physical actor/);
});
test('rejects missing events, unknown ops, replay and conflicting CONTROL', () => {
  expectReject(stop().map(x=>x.seq===2?{...x,op:'finalize'}:x), /before cleanup/);
  expectReject([...stop().slice(0,6),event(7,'stop.invoke',{turn:1})],/duplicate or unreserved/);
  expectReject([...stop().slice(0,6),event(7,'stop.ack',{turn:1})],/unverified ambiguous/);
  expectReject([...stop().slice(0,5),event(6,'restart.reserve',
    {turn:1,permitId:'permit'})],/overlap/);
  expectReject([...stop().slice(0,5),event(6,'stop.invoke',{turn:99})],/CONTROL turn/);
  expectReject([...stop(),event(9,'stop.ack',{turn:1})],/replayed STOP/);
  expectReject(stop().map(x=>x.seq===8?{...x,seq:7}:x),/non-contiguous/);
  expectReject([...stop().slice(0,4),event(5,'unknown')],/unknown action/);
});
test('a safety-valid prefix is not a completed run', () => {
  const prefix=stop().slice(0,6);
  assert.throws(()=>verifySupervisorTrace(rawDoc(prefix)),/incomplete trace/);
  assert.equal(verifySupervisorTrace(rawDoc(prefix),{allowPrefix:true}).completion,'prefix');
  expectReject(prefix,/terminal status conceals/);
  expectReject([...stop(),event(9,'stop.invoke',{turn:1})],/CONTROL turn|unreserved/);
  const bad=doc(stop());bad.events.at(-1).recordedEvents=4;
  assert.throws(()=>verifySupervisorTrace(bad),/terminal marker count mismatch/);
  assert.throws(()=>verifySupervisorTrace({...doc(stop()),sourceSha:'bad'}),/source commit SHA/);
  assert.throws(()=>verifySupervisorTrace(rawDoc([])),/missing events/);
  assert.throws(()=>verifySupervisorTrace({...doc(stop()),backend:'host'}),/invalid backend/);
  assert.throws(()=>verifySupervisorTrace({...doc(stop()),schemaVersion:1}),/unknown schema/);
});
test('independent supervisor lanes can own simultaneous STOP turns', () => {
  const t=stop().slice(0,4);
  t.push(event(5,'register',{child:'child-2',supervisor:'other'}));
  t.push(event(6,'cleanup',{child:'child-2',supervisor:'other'}));
  t.push(event(7,'finalize',{child:'child-2',supervisor:'other'}));
  t.push(event(8,'control.acquire',{child:'child-2',supervisor:'other',turn:1}));
  t.push(event(9,'stop.reserve',{turn:1}));
  t.push(event(10,'stop.reserve',{child:'child-2',supervisor:'other',turn:1}));
  t.push(event(11,'stop.invoke',{turn:1}));
  t.push(event(12,'stop.invoke',{child:'child-2',supervisor:'other',turn:1}));
  t.push(event(13,'stop.uncertain',{turn:1}));
  t.push(event(14,'stop.uncertain',{child:'child-2',supervisor:'other',turn:1}));
  assert.equal(verifySupervisorTrace(doc(t,'quarantined')).invocations,2);
});

test('STOP effect claims, receipts and trusted evidence are bound to exact one-use permit', () => {
  const events=stop();
  expectReject(events.map((e,i)=>i===4?{...e,stopPermitId:''}:e),
    /missing, foreign or replayed STOP permit/);
  expectReject(events.map((e,i)=>i===5?{...e,stopPermitId:'forged-ticket'}:e),
    /foreign or stale STOP invocation permit/);
  expectReject(events.map((e,i)=>i===6?{...e,stopPermitId:'forged-ticket'}:e),
    /foreign or stale STOP applied permit/);
  expectReject(events.map((e,i)=>i===7?{...e,stopPermitId:'forged-ticket'}:e),
    /foreign or stale STOP acknowledgment permit/);
  const uncertain=[...events.slice(0,6),event(7,'stop.uncertain',{turn:1,stopPermitId:'wrong'})];
  expectReject(uncertain,/foreign or stale STOP uncertain permit/,'quarantined');
  const proof=[...events.slice(0,6),event(7,'stop.uncertain',{turn:1}),
    event(8,'stop.proof',{turn:1,evidenceId:'external-verified'}),
    event(9,'stop.ack',{turn:1})];
  assert.throws(()=>verifySupervisorTrace(doc(proof),{
    verifyProof:p=>p.stopPermitId === 'foreign-ticket'
  }),/independent host proof rejected/);
  expectReject(proof.map((e,i)=>i===7?{...e,stopPermitId:'foreign'}:e),
    /foreign or stale STOP proof permit/);
});
