import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import test from 'node:test';

// Independent native TCP peer; no Atto compiler or guest implementation here.
// Protocol: WAIT -> ARMED; only a distinct SIGNAL connection unlocks 42.
export async function withPeer(body, timeoutMs = 2000) {
  const sockets = new Set();
  const events = [];
  let waiter = null, signalled = false, failure = null;
  const reject = socket => {
    failure ??= new Error('invalid continuation peer protocol');
    socket.end('ERROR\n');
  };
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', err => { failure ??= err; });
    socket.once('close', () => sockets.delete(socket));
    let input = '';
    let commandSeen = false;
    socket.on('data', chunk => {
      if (commandSeen) return reject(socket);
      input += chunk.toString('utf8');
      if (input.length > 16) return reject(socket);
      if (!input.includes('\n')) return;
      commandSeen = true;
      if (input === 'WAIT\n' && !waiter && !signalled) {
        waiter = socket;
        events.push('WAIT');
        socket.write('ARMED\n');
      } else if (input === 'SIGNAL\n' && waiter && waiter !== socket && !waiter.destroyed && !signalled) {
        signalled = true;
        events.push('SIGNAL');
        socket.end('ACK\n');
        waiter.end('42\n');
        events.push('RELEASE');
      } else reject(socket);
    });
  });
  let timer;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const result = await Promise.race([
      Promise.resolve().then(() => body(server.address().port)),
      new Promise((_, rejectTimeout) => { timer = setTimeout(() => rejectTimeout(new Error('peer deadline')), timeoutMs); }),
    ]);
    if (failure) throw failure;
    assert.deepEqual(events, ['WAIT', 'SIGNAL', 'RELEASE'], 'incomplete external release proof');
    return result;
  } finally {
    clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}

function client(port, command, onData = () => {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let received = '';
    socket.once('connect', () => socket.write(command));
    socket.on('data', chunk => { received += chunk.toString('utf8'); onData(received); });
    socket.once('error', reject);
    socket.once('end', () => resolve(received));
    socket.once('close', () => { if (!socket.readableEnded) reject(new Error('client closed before EOF')); });
  });
}

test('real TCP control: waiting client released by distinct signalling client', async () => {
  await withPeer(async port => {
    let armed;
    const ready = new Promise(resolve => { armed = resolve; });
    const waiting = client(port, 'WAIT\n', bytes => { if (bytes.includes('ARMED\n')) armed(); });
    await ready;
    assert.equal(await client(port, 'SIGNAL\n'), 'ACK\n');
    assert.equal(await waiting, 'ARMED\n42\n');
  });
});

test('real TCP negative: signal before wait cannot release anything', async () => {
  await assert.rejects(withPeer(async port => {
    assert.equal(await client(port, 'SIGNAL\n'), 'ERROR\n');
  }), /invalid continuation peer protocol/);
});

test('real TCP negative: withheld response fails by deadline', async () => {
  await assert.rejects(withPeer(port => client(port, 'WAIT\n'), 100), /peer deadline/);
});

test('real TCP negative: empty scenario cannot pass', async () => {
  await assert.rejects(withPeer(async () => {}), /incomplete external release proof/);
});
