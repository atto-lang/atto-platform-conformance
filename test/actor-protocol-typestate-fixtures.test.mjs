import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root = new URL('../fixtures/actor-protocol-typestate-v1/', import.meta.url);
const contract = JSON.parse(readFileSync(new URL('../contracts/actor-protocol-typestate-v1.json', import.meta.url), 'utf8'));
const load = id => {
  const entry = contract.cases.find(c => c.id === id);
  assert.ok(entry, 'missing fixture ' + id);
  return readFileSync(new URL(entry.file, root), 'utf8');
};

test('manifest distinguishes static source proof from executable backend parity', () => {
  assert.equal(contract.schema, 'attolang.actor-protocol-typestate-source.v1');
  assert.match(contract.status, /NOT_GUEST_EXECUTION/);
  assert.equal(contract.evidence_policy.zero_step_actions_runs_pass, false);
  assert.equal(contract.evidence_policy.host_fixture_only_is_backend_evidence, false);
  assert.equal(contract.evidence_policy.real_guest_required_for_runtime_certification, true);
  assert.equal(contract.evidence_policy.exact_head_required, true);
  assert.equal(contract.evidence_policy.alternate_org_mirror_requires_per_blob_sha, true);
  assert.equal(contract.evidence_policy.secret_free_private_mirroring, true);
  assert.equal(contract.cases.length, 13);
  assert.equal(new Set(contract.cases.map(x=>x.id)).size, contract.cases.length);
  assert.deepEqual(Object.keys(contract.backend_status).sort(), contract.target_backends.slice().sort());
  assert.ok(Object.values(contract.backend_status).every(s=>s==='NOT_VERIFIED'));
});

test('all cases contain complete, real .atto protocol declarations', () => {
  for (const entry of contract.cases) {
    assert.match(entry.file, /^[a-z-]+\.atto$/);
    assert.match(entry.expected_static, /^(PASS|E_PROTOCOL_[A-Z_]+)$/);
    const src = load(entry.id);
    assert.ok(src.length >= 600 && src.length <= 64000, entry.file);
    for (const mark of [
      'define protocol ConnectionProtocol as',
      'initial Disconnected',
      'state Disconnected as',
      'state Connected as',
      'terminal state Closed',
      'define actor Connection implements ConnectionProtocol as',
      'pub fnc main(): int',
      'return 0;'
    ]) {
      if (entry.id === 'wrong_actor_kind' && mark.startsWith('define actor')) continue;
      assert.ok(src.includes(mark), entry.file + ': missing ' + mark);
    }
    assert.match(src, /on Query\(Sql\) -> Connected replies QueryReply/);
    assert.match(src, /on Subscribe\(Topic\) -> Connected streams DataEvent/);
  }
});

test('explicit nominal reply type matches the transition table', () => {
  assert.equal(contract.cases.find(x=>x.id==='typed_reply_static_valid').expected_static, 'PASS');
  assert.ok(load('typed_reply_static_valid').includes('val (ack: ConnectedAck, connected) = await connecting?;'));
});

test('positive trace names the required sequential successful transitions and terminal', () => {
  const src = load('connection_static_valid');
  const steps = [
    'await spawn Connection()',
    'disconnected.call(Connect())',
    'await connecting?',
    'connected.call(Query())',
    'await querying?',
    'still_connected.call(Close())',
    'await closing?',
    'closed.complete_protocol()'
  ];
  let index = -1;
  for (const step of steps) {
    const next = src.indexOf(step);
    assert.ok(next > index, 'ordered transition not found: ' + step);
    index = next;
  }
  const good = contract.cases.find(x=>x.id==='connection_static_valid');
  assert.equal(good.expected_static, 'PASS');
  assert.equal(good.expected_guest, 'E_PROTOCOL_RUNTIME_UNSUPPORTED');
});

for (const [id, diagnostic, marker] of [
  ['disconnected_query','E_PROTOCOL_ILLEGAL_MESSAGE_STATE', 'disconnected.call(Query())'],
  ['affine_reuse','E_PROTOCOL_AFFINE_HANDLE', 'val querying = disconnected.call(Query())'],
  ['missing_reply','E_PROTOCOL_REPLY_REQUIRED','await wrong_ticket?'],
  ['early_terminal','E_PROTOCOL_TERMINAL_INCOMPLETE','disconnected.complete_protocol()'],
  ['stream_unary_confusion','E_PROTOCOL_REPLY_MISMATCH','connected.call(Subscribe())'],
  ['wrong_actor_kind','E_PROTOCOL_IMPLEMENTATION_MISMATCH','define class Connection implements ConnectionProtocol'],
  ['wrong_nominal_reply','E_PROTOCOL_REPLY_MISMATCH','val (ack: WrongAck, connected) = await connecting?;'],
  ['nonlinear_if','E_PROTOCOL_CFG_UNSUPPORTED','if true then'],
  ['effectful_call_argument','E_PROTOCOL_CFG_UNSUPPORTED','Connect(revoke_authority())'],
  ['handle_argument_escape','E_PROTOCOL_AFFINE_HANDLE','Connect(disconnected)'],
  ['forward_declaration_only','E_PROTOCOL_UNPROVEN_STATE','declare actor Connection implements ConnectionProtocol;']
]) {
  test('negative fixture is distinctly pinned: ' + id, () => {
    assert.equal(contract.cases.find(x=>x.id===id).expected_static, diagnostic);
    assert.ok(load(id).includes(marker));
    assert.notEqual(load(id), load('connection_static_valid'));
  });
}
