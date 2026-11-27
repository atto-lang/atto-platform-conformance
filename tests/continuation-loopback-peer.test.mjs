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


// Process boundary for a future compiled-guest adapter. The executable is
// supplied by the caller; this function does not establish compiler provenance.
import { spawn } from 'node:child_process';

export async function runPeerProcess({ executable, args = [], expectedStdout, timeoutMs = 2000 }) {
  assert.ok(typeof executable === 'string' && executable.length > 0);
  assert.ok(Array.isArray(args) && args.every(x => typeof x === 'string'));
  assert.ok(typeof expectedStdout === 'string' && expectedStdout.length > 0);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000);
  let child, closed;
  try {
    return await withPeer(async port => {
      child = spawn(executable, [...args, String(port)], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      const output = { stdout: [], stderr: [] };
      let total = 0, overflow = false;
      for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
        total += chunk.length;
        if (total > 65_536) { overflow = true; child.kill('SIGKILL'); }
        else output[stream].push(chunk);
      });
      closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
      const result = await Promise.race([closed, new Promise((_, reject) => child.once('error', reject))]);
      assert.ok(!overflow, 'guest output limit exceeded');
      assert.equal(result.signal, null, 'guest terminated by signal');
      assert.equal(result.code, 0, 'guest exit status');
      assert.equal(Buffer.concat(output.stdout).toString('utf8'), expectedStdout, 'guest stdout mismatch');
      return result;
    }, timeoutMs);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (closed) await closed;
  }
}

const syntheticClient = `
const net = require('node:net');
const port = Number(process.argv[1]);
const wait = net.createConnection({host:'127.0.0.1',port});
let data='', started=false;
wait.on('connect',()=>wait.write('WAIT\\n'));
wait.on('data',b=>{data+=b;if(!started&&data.includes('ARMED\\n')){
  started=true; const signal=net.createConnection({host:'127.0.0.1',port});
  signal.on('connect',()=>signal.write('SIGNAL\\n'));signal.resume();
}});
wait.on('end',()=>{if(data!=='ARMED\\n42\\n')process.exitCode=1;else console.log('42');});
`;
const syntheticProcess = (source, extra = {}) => runPeerProcess({ executable: process.execPath,
  args: ['-e', source], expectedStdout: '42\n', ...extra });
test('process harness executes a real external synthetic TCP client', async () => {
  assert.deepEqual(await syntheticProcess(syntheticClient), { code: 0, signal: null });
});
test('process harness rejects fabricated success without peer traffic', async () => {
  await assert.rejects(syntheticProcess("console.log('42')"), /incomplete external release proof/);
});
test('process harness rejects wrong guest output despite real peer traffic', async () => {
  await assert.rejects(syntheticProcess(syntheticClient, { expectedStdout: '43\n' }), /guest stdout mismatch/);
});
test('process harness rejects nonzero exit', async () => {
  await assert.rejects(syntheticProcess('process.exitCode=7'), /guest exit status/);
});
test('process harness kills hung process on deadline', async () => {
  await assert.rejects(syntheticProcess('setInterval(()=>{},1000)', { timeoutMs: 100 }), /peer deadline/);
});
test('process harness rejects excessive output', async () => {
  await assert.rejects(syntheticProcess("process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)"), /guest output limit exceeded/);
});
