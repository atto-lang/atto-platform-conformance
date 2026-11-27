import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { verifyTraceV2 } from './continuation-trace-oracle-v2.test.mjs';
import { withPeer } from './continuation-loopback-peer.test.mjs';

const owner = { tenant: 1, actor: 3, generation: 1, task: 2, suspension: 1, scheduler: 'actor', dispatch: 7, future: 'f' };
const ev = (kind, extra = {}) => ({ ...owner, kind, ...extra });
const s = ev('suspend'), l = ev('release'), q = ev('enqueue');
const f = { kind: 'settle', tenant: 1, future: 'f', outcome: 'ok' };
const r = ev('resume', { dispatch: 8, role: 'scheduler', outcome: 'ok' });
for (const [name, trace] of [
  ['duplicate release', [s,l,l,f,q,r]],
  ['release on wrong dispatch', [s,ev('release',{dispatch:9}),f,q,r]],
  ['unknown event', [s,ev('unknown'),l,f,q,r]],
  ['duplicate suspension identity after completion', [s,l,f,q,r,s]],
  ['changed future on release', [s,ev('release',{future:'other'}),f,q,r]],
  ['changed scheduler on revoke', [s,l,ev('cancel_wait'),ev('revoke',{scheduler:'root'})]],
  ['invalid settlement outcome', [s,l,{...f,outcome:'invalid'},q,r]],
  ['retired incarnation starts a new wait', [ev('retire_actor'),s,l,f,q,r]],
]) test(`adversarial trace: ${name}`, () => assert.throws(() => verifyTraceV2(trace)));

test('two simultaneous task waits may share a tenant-local Future', () => {
  const second = e => ({ ...e, task: 9, suspension: 2, dispatch: e.dispatch + 10 });
  verifyTraceV2([s,second(s),l,second(l),f,q,second(q),r,second(r)]);
});

function exchange(port, chunks, onData = () => {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host:'127.0.0.1',port});
    let bytes = '';
    socket.once('connect', () => { for (const chunk of chunks) socket.write(chunk); });
    socket.on('data', chunk => { bytes += chunk.toString('utf8'); onData(bytes, socket); });
    socket.once('end', () => resolve(bytes));
    socket.once('error', reject);
    socket.once('close', () => { if (!socket.readableEnded) reject(new Error('closed before EOF')); });
  });
}

test('adversarial TCP: same connection cannot signal its own wait', async () => {
  await assert.rejects(withPeer(async port => {
    let attempted = false;
    assert.equal(await exchange(port, ['WAIT\n'], (bytes, socket) => {
      if (!attempted && bytes.includes('ARMED\n')) { attempted = true; socket.write('SIGNAL\n'); }
    }), 'ARMED\nERROR\n');
  }), /invalid continuation peer protocol/);
});
test('adversarial TCP: malformed command rejected', async () => {
  await assert.rejects(withPeer(async port => {
    assert.equal(await exchange(port, ['WAIT extra\n']), 'ERROR\n');
  }), /invalid continuation peer protocol/);
});
test('adversarial TCP: two commands in one connection rejected', async () => {
  await assert.rejects(withPeer(async port => {
    assert.equal(await exchange(port, ['WAIT\nSIGNAL\n']), 'ERROR\n');
  }), /invalid continuation peer protocol/);
});
