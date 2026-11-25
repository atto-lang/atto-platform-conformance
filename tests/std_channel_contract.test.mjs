import {readFile} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifest = JSON.parse(await readFile(
  new URL('../contracts/std-channel-v1.json', import.meta.url), 'utf8'
));
const backends = ['java', 'llvm', 'net', 'rs', 'wasm', 'forge',
  'cranelift', 'js', 'hdl', 'atto', 'realtime'].sort();

test('std/channel contract is source-owned and explicitly unverified', () => {
  assert.equal(manifest.schema, 'atto.std.channel.v1');
  assert.equal(manifest.status, 'TARGET_ONLY_NOT_EXECUTED');
  assert.equal(manifest.implementation_policy, 'BACKEND_OWNED_NATIVE_ATTO_SOURCE');
  assert.equal(manifest.library_namespace, 'std/channel');
  assert.deepEqual(Object.keys(manifest.backend_repositories).sort(), backends);
  assert.equal(manifest.backend_repositories.atto, 'atto-lang/atto-source.atto');
  assert.equal(manifest.backend_repositories.realtime, 'atto-lang/atto-source.realtime');
  assert.match(manifest.scope_notes.atto, /NOT_EXECUTED/);
  assert.match(manifest.scope_notes.realtime, /NOT_EXECUTED/);
  for (const backend of ['atto', 'realtime']) {
    const audit = manifest.backend_audit_snapshots[backend];
    assert.match(audit.tree_sha, /^[0-9a-f]{40}$/);
    assert.equal(audit.branch, 'main');
    assert.equal(audit.tracked_files, 2);
    assert.equal(audit.channel_implementation_files, 0);
    assert.equal(audit.execution, 'NOT_EXECUTED');
    assert.match(manifest.scope_notes[backend], /AUDITED_SKELETON/);
  }
  assert.match(manifest.evidence_rule, /actual compiled\/executed guest/);
  assert.match(manifest.scope_notes.rs, /NOT_LINKED/);
  assert.match(manifest.scope_notes.llvm, /rejects unsupported guest lowering/);
  assert.ok(manifest.required_contracts.length >= 10);
  assert.ok(manifest.required_contracts.some(x =>
    /original moved value/.test(x)));
  assert.ok(manifest.required_contracts.some(x =>
    /never silently buffered/.test(x)));
  assert.ok(manifest.required_contracts.some(x =>
    /cancelled pending operations/.test(x)));
  assert.ok(manifest.required_contracts.some(x =>
    /legacy two-port pipes/.test(x) && /pending public reader/.test(x)));
  assert.ok(manifest.required_contracts.some(x =>
    /head\/middle\/tail/.test(x) && /cancelled Future/.test(x)));
  assert.match(manifest.scope_notes.rs, /NOT_LINKED/);
  assert.match(manifest.scope_notes.java, /cancel_read and cancel_write/);
  assert.ok(manifest.required_contracts.some(x =>
    /pending writes preserve FIFO/.test(x)));
  assert.ok(manifest.required_contracts.some(x =>
    /exactly one recovery/.test(x)));
  assert.ok(manifest.required_contracts.some(x =>
    /nested channel capabilities/.test(x)));
  assert.ok(manifest.required_contracts.some(x =>
    /queued public pending writers/.test(x)));
});

test('backend cancellation and borrow features have no false PASS', () => {
  const expected = ['pending_read_cancellation', 'pending_write_cancellation',
    'channel_payload_borrow_check', 'actor_data_exclusive_channel'].sort();
  assert.deepEqual(manifest.feature_matrix.map(f => f.id).sort(), expected);
  for (const feature of manifest.feature_matrix) {
    assert.deepEqual(Object.keys(feature.backend_status).sort(), backends);
    for (const [backend, value] of Object.entries(feature.backend_status))
      assert.equal(value, 'NOT_EXECUTED', feature.id + ':' + backend);
    assert.ok(feature.notes.rs?.length > 20);
    assert.ok(feature.notes.java?.length > 20);
  }
  assert.match(manifest.scope_notes.rs, /NOT_LINKED/);
  assert.match(manifest.scope_notes.rs, /NOT_IMPLEMENTED/);
  assert.match(manifest.scope_notes.java, /NOT_EXECUTED/);
});

test('all conformance fixtures exist and no compiler is falsely certified', async () => {
  const ids = new Set();
  const paths = new Set();
  assert.equal(manifest.cases.length, 7);
  for (const c of manifest.cases) {
    assert.ok(!ids.has(c.id), 'duplicate case ID: ' + c.id);
    assert.ok(!paths.has(c.path), 'duplicate fixture path: ' + c.path);
    ids.add(c.id);
    paths.add(c.path);
    assert.deepEqual(Object.keys(c.backend_status).sort(), backends);
    for (const [backend, status] of Object.entries(c.backend_status))
      assert.equal(status, 'NOT_EXECUTED', backend + ':' + c.id);
    assert.ok(['pass', 'runtime_reject'].includes(c.kind));
    if (c.kind === 'pass') assert.equal(typeof c.expected_stdout, 'string');
    else assert.match(c.expected_error_contains, /capacity|closed/);

    const path = resolve(root, c.path);
    assert.ok(path.startsWith(root + sep), 'path traversal: ' + c.path);
    assert.ok(c.path.endsWith('.atto'));
    const source = await readFile(path, 'utf8');
    assert.match(source, /import module channel from "std\/channel";/);
    assert.match(source, /routine main\(\): void/);
    assert.ok(source.length >= 130);
    assert.doesNotMatch(source, /java:|require\(|eval\(/,
      'guest must not smuggle a host implementation');
  }
});

test('required semantics are actually present in candidate Atto programs', async () => {
  const byId = Object.fromEntries(manifest.cases.map(x => [x.id, x]));
  const load = id => readFile(resolve(root, byId[id].path), 'utf8');
  assert.match(await load('bounded_fifo_drain'),
    /send<int>\(ch, 20\)[\s\S]*send<int>\(ch, 22\)[\s\S]*close<int>\(ch\)[\s\S]*receive<int>\(ch\)/);
  assert.match(await load('rendezvous_pending'), /rendezvous<int>\(\)/);
  assert.match(await load('rendezvous_pending'), /receive_pending<int>/);
  assert.ok(manifest.required_contracts.some(x =>
    /polling without registration must never deadlock/.test(x)));
  assert.match(await load('rendezvous_direct_read'),
    /rendezvous<int>\(\)[\s\S]*send_pending<int>\(ch, 42\)[\s\S]*receive<int>\(ch\)/);
  assert.match(await load('try_read_empty_ready'), /on None/);
  assert.match(await load('try_read_empty_ready'), /on Some\(value\)/);
  assert.match(await load('closed_move_recovery'),
    /rt take owned[\s\S]*on Closed\(value\)/);
  assert.match(await load('negative_capacity'), /bounded<int>\(-1\)/);
  assert.match(await load('try_receive_closed'),
    /close<int>\(ch\)[\s\S]*readch ch[\s\S]*try_receive<int>\(ch\)/);
});
