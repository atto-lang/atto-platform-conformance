import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySupervisorTrace } from '../bin/verify-supervisor-trace.mjs';

const sourceSha = '1111111111111111111111111111111111111111';
const event = (seq, op, extras={}) =>
  ({seq, op, child:'child-1', supervisor:'root', generation:1, ...extras});
const doc = events => ({schemaVersion:1, backend:'java', sourceSha, events});
const stop = () => [
  event(1,'register',{actor:'actor-A'}),
  event(2,'cleanup'),
  event(3,'finalize'),
  event(4,'control.acquire',{turn:1}),
  event(5,'stop.reserve',{turn:1}),
  event(6,'stop.invoke',{turn:1}),
  event(7,'stop.applied',{turn:1}),
  event(8,'stop.ack',{turn:1})
];
function rejected(events, pattern) {
  assert.throws(() => verifySupervisorTrace(doc(events)), pattern);
}
test('acknowledged STOP satisfies action contract', () => {
  assert.deepEqual(
    (({ok,invocations,acknowledgments,restartCommits}) =>
      ({ok,invocations,acknowledgments,restartCommits}))(verifySupervisorTrace(doc(stop()))),
    {ok:true,invocations:1,acknowledgments:1,restartCommits:0});
});
test('unknown STOP stays quarantined after close until independent proof', () => {
  const events = stop().slice(0,6);
  events.push(event(7,'stop.uncertain',{turn:1}));
  events.push(event(8,'supervisor.close',{child:undefined,generation:undefined}));
  rejected([...events,event(9,'stop.ack',{turn:1})], /unverified ambiguous/);
  events.push(event(9,'stop.proof',{turn:1,evidenceId:'external-receipt-1'}));
  events.push(event(10,'stop.ack',{turn:1}));
  assert.equal(verifySupervisorTrace(doc(events)).acknowledgments, 1);
});
test('restart commit requires ownership, new ActorId and monotonic incarnation', () => {
  const events = stop().slice(0,4);
  events.push(event(5,'restart.reserve',{turn:1}));
  events.push(event(6,'restart.commit',{turn:1,newActor:'actor-B',newGeneration:2}));
  events.push(event(7,'cleanup',{generation:2}));
  events.push(event(8,'finalize',{generation:2}));
  events.push(event(9,'control.acquire',{generation:2,turn:2}));
  events.push(event(10,'stop.reserve',{generation:2,turn:2}));
  events.push(event(11,'stop.invoke',{generation:2,turn:2}));
  events.push(event(12,'stop.applied',{generation:2,turn:2}));
  events.push(event(13,'stop.ack',{generation:2,turn:2}));
  assert.equal(verifySupervisorTrace(doc(events)).restartCommits,1);
  rejected([...events.slice(0,5),event(6,'restart.commit',
    {turn:1,newActor:'actor-A',newGeneration:2})], /ABA reuse/);
});
test('mutations are rejected at the first invalid transition', () => {
  rejected(stop().map(x => x.seq===2 ? {...x,op:'finalize'} : x), /before cleanup/);
  rejected([...stop().slice(0,6),event(7,'stop.invoke',{turn:1})], /duplicate or unreserved/);
  rejected([...stop().slice(0,6),event(7,'stop.ack',{turn:1})], /unverified ambiguous/);
  rejected([...stop().slice(0,5),event(6,'restart.reserve',{turn:1})], /overlap/);
  rejected([...stop().slice(0,5),event(6,'stop.invoke',{turn:99})], /CONTROL turn/);
  rejected([...stop().slice(0,5),event(6,'stop.invoke',{turn:1,generation:2})], /stale or forged/);
  rejected([...stop().slice(0,4),event(5,'supervisor.close'),
    event(6,'restart.reserve',{turn:1})], /CONTROL turn/);
  rejected([...stop(),event(9,'stop.ack',{turn:1})], /replayed STOP/);
  rejected(stop().map(x => x.seq===8 ? {...x,seq:7} : x), /non-contiguous/);
  rejected([...stop().slice(0,4),event(5,'unknown')], /unknown action/);
});
test('missing provenance, empty trace and forged evidence are fail-closed', () => {
  assert.throws(() => verifySupervisorTrace({...doc(stop()),sourceSha:'not-a-sha'}), /source commit SHA/);
  assert.throws(() => verifySupervisorTrace(doc([])), /missing events/);
  assert.throws(() => verifySupervisorTrace({...doc(stop()),backend:'host'}), /invalid backend/);
  const t=stop().slice(0,6);
  t.push(event(7,'stop.uncertain',{turn:1}));
  rejected([...t,event(8,'stop.proof',{turn:2,evidenceId:'other-turn'})], /wrong-turn/);
  rejected([...t,event(8,'stop.proof',{turn:1})], /wrong-turn/);
});
test('different supervisor CONTROL lanes can proceed independently', () => {
  const t=stop().slice(0,4);
  t.push(event(5,'register',{child:'child-2',supervisor:'other',actor:'actor-C'}));
  t.push(event(6,'cleanup',{child:'child-2',supervisor:'other'}));
  t.push(event(7,'finalize',{child:'child-2',supervisor:'other'}));
  t.push(event(8,'control.acquire',{child:'child-2',supervisor:'other',turn:1}));
  t.push(event(9,'stop.reserve',{turn:1}));
  t.push(event(10,'stop.reserve',{child:'child-2',supervisor:'other',turn:1}));
  t.push(event(11,'stop.invoke',{turn:1}));
  t.push(event(12,'stop.invoke',{child:'child-2',supervisor:'other',turn:1}));
  t.push(event(13,'stop.uncertain',{turn:1}));
  t.push(event(14,'stop.uncertain',{child:'child-2',supervisor:'other',turn:1}));
  assert.equal(verifySupervisorTrace(doc(t)).invocations,2);
});
