import assert from 'node:assert/strict';
import test from 'node:test';

// Narrow C05 qualification profile, not a general scheduler trace or attestation.
// The trusted adapter must supply causally ordered runtime and independent peer
// observations. Expected identities are supplied by the fixture driver.
export function verifySingleCarrierProof(packet, expected) {
  const { events, dropped, carrierCount } = packet;
  const { tenant, scheduler, carrier, reader, signaler, future, connection } = expected;
  const ids = [tenant, scheduler, carrier, reader, signaler, future, connection];
  assert.ok(ids.every(x => typeof x === 'string' && x.length > 0), 'invalid expected identity');
  assert.notEqual(reader, signaler, 'distinct logical tasks required');
  assert.equal(carrierCount, 1, 'requires observed single-carrier configuration');
  assert.equal(dropped, 0, 'lost trace events');
  assert.ok(Array.isArray(events), 'missing events');
  assert.equal(packet.eventCount, events.length, 'trace count mismatch');
  const required = ['reader_enter', 'read_pending', 'reader_leave', 'signaler_enter', 'signal_write', 'peer_release', 'signaler_leave', 'read_settle', 'reader_resume', 'reader_finish'];
  const seen = new Map();
  let active = null, initialDispatch, signalDispatch, resumedDispatch;
  for (const [i, e] of events.entries()) {
    assert.equal(e.seq, i + 1, 'trace gap or reorder');
    assert.ok(required.includes(e.kind) && !seen.has(e.kind), 'unexpected or duplicate event');
    assert.equal(e.tenant, tenant, 'wrong tenant');
    const has = k => seen.has(k);
    if (e.kind === 'peer_release') {
      assert.equal(e.role, 'peer', 'release must be externally observed');
      assert.equal(e.connection, connection, 'wrong peer connection');
      assert.ok(has('signal_write'), 'peer released before sibling signal');
    } else if (e.kind === 'read_settle') {
      assert.equal(e.future, future, 'wrong completed Future');
      assert.equal(e.outcome, 'ok', 'read did not complete successfully');
      assert.ok(has('peer_release'), 'read settled before peer release');
    } else {
      assert.equal(e.role, 'scheduler', 'guest executed outside scheduler');
      assert.equal(e.scheduler, scheduler, 'wrong scheduler');
      assert.equal(e.carrier, carrier, 'different carrier');
      assert.ok(typeof e.dispatch === 'string' && e.dispatch.length > 0, 'missing dispatch');
      assert.equal(e.task, ['signaler_enter', 'signal_write', 'signaler_leave'].includes(e.kind) ? signaler : reader, 'wrong task');
      switch (e.kind) {
        case 'reader_enter':
          assert.equal(active, null); initialDispatch = e.dispatch; active = reader; break;
        case 'read_pending':
          assert.equal(active, reader); assert.equal(e.dispatch, initialDispatch);
          assert.equal(e.future, future); assert.equal(e.connection, connection); break;
        case 'reader_leave':
          assert.ok(has('read_pending')); assert.equal(active, reader);
          assert.equal(e.dispatch, initialDispatch); active = null; break;
        case 'signaler_enter':
          assert.ok(has('reader_leave') && !has('read_settle'), 'read was not pending when sibling ran');
          assert.equal(active, null); assert.notEqual(e.dispatch, initialDispatch);
          signalDispatch = e.dispatch; active = signaler; break;
        case 'signal_write':
          assert.equal(active, signaler); assert.equal(e.dispatch, signalDispatch); break;
        case 'signaler_leave':
          assert.ok(has('signal_write')); assert.equal(active, signaler);
          assert.equal(e.dispatch, signalDispatch); active = null; break;
        case 'reader_resume':
          assert.ok(has('read_settle') && has('signaler_leave'), 'resume before settlement or carrier release');
          assert.equal(active, null); assert.equal(e.future, future);
          assert.notEqual(e.dispatch, initialDispatch); assert.notEqual(e.dispatch, signalDispatch);
          resumedDispatch = e.dispatch; active = reader; break;
        case 'reader_finish':
          assert.ok(has('reader_resume')); assert.equal(active, reader);
          assert.equal(e.dispatch, resumedDispatch); assert.equal(e.value, 42); active = null; break;
      }
    }
    seen.set(e.kind, i);
  }
  assert.equal(seen.size, required.length, 'incomplete proof');
  assert.equal(active, null, 'carrier still executing');
}

const expected = { tenant: 't', scheduler: 'root', carrier: 'c', reader: 'a', signaler: 'b', future: 'f', connection: 'socket-a' };
const run = (kind, task, dispatch, extra = {}) => ({ kind, task, dispatch, tenant: 't', role: 'scheduler', scheduler: 'root', carrier: 'c', ...extra });
const good = [run('reader_enter', 'a', '1'), run('read_pending', 'a', '1', { future: 'f', connection: 'socket-a' }), run('reader_leave', 'a', '1'), run('signaler_enter', 'b', '2'), run('signal_write', 'b', '2'), { kind: 'peer_release', role: 'peer', tenant: 't', connection: 'socket-a' }, { kind: 'read_settle', tenant: 't', future: 'f', outcome: 'ok' }, run('signaler_leave', 'b', '2'), run('reader_resume', 'a', '3', { future: 'f' }), run('reader_finish', 'a', '3', { value: 42 })];
const packet = (events, extra = {}) => ({ events: events.map((e, i) => ({ ...e, seq: i + 1 })), dropped: 0, carrierCount: 1, eventCount: events.length, ...extra });
const edit = (i, extra) => good.map((e, j) => i === j ? { ...e, ...extra } : e);
const swap = (i, j) => good.map((e, k) => k === i ? good[j] : k === j ? good[i] : e);
test('single carrier with settlement during sibling turn', () => verifySingleCarrierProof(packet(good), expected));
test('single carrier with settlement after sibling turn', () => verifySingleCarrierProof(packet(swap(6, 7)), expected));
for (const [name, p, x = expected] of [
  ['missing physical carrier count', packet(good, { carrierCount: undefined })],
  ['extra carrier', packet(good, { carrierCount: 2 })],
  ['lost events', packet(good, { dropped: 1 })],
  ['incorrect count', packet(good, { eventCount: 9 })],
  ['missing pending read', packet(good.filter((_, i) => i !== 1))],
  ['sibling before release', packet(swap(2, 3))],
  ['peer before signal', packet(swap(4, 5))],
  ['settled before peer', packet(swap(5, 6))],
  ['resume before sibling leaves', packet(swap(7, 8))],
  ['reactor resumes guest', packet(edit(8, { role: 'nio' }))],
  ['different carrier', packet(edit(3, { carrier: 'other' }))],
  ['different scheduler', packet(edit(8, { scheduler: 'actor' }))],
  ['wrong tenant', packet(edit(8, { tenant: 'foreign' }))],
  ['wrong task', packet(edit(3, { task: 'a' }))],
  ['same expected task', packet(good), { ...expected, signaler: 'a' }],
  ['wrong Future', packet(edit(6, { future: 'other' }))],
  ['wrong socket', packet(edit(5, { connection: 'other' }))],
  ['guest claims external release', packet(edit(5, { role: 'scheduler' }))],
  ['reused dispatch', packet(edit(8, { dispatch: '1' }))],
  ['duplicate resume', packet([...good, good[8]])],
  ['incorrect guest result', packet(edit(9, { value: 41 }))],
  ['no terminal guest result', packet(good.slice(0, -1))],
]) test(`reject ${name}`, () => assert.throws(() => verifySingleCarrierProof(p, x)));
