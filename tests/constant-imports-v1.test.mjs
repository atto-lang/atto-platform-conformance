// HOST-ONLY integrity test for the target registry; NOT a compiler or guest run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const doc = JSON.parse(readFileSync(new URL('../contracts/constant-imports-v1.json', import.meta.url), 'utf8'));

test('typed constant import contract is explicit and not falsely certified', () => {
  assert.equal(doc.schema, 'atto.constant-imports.v1');
  assert.equal(doc.status, 'TARGET_NOT_EXECUTED');
  assert.ok(doc.spec_path.endsWith('constant-imports-v1.md'));
  assert.ok(doc.cases.length >= 27);
  assert.deepEqual(
    Object.keys(doc.backend_status).sort(),
    ['rs-browser', 'java', 'llvm', 'net', 'forge', 'wasm-independent',
     'cranelift', 'js', 'hdl', 'atto-self-hosted', 'realtime'].sort()
  );
  assert.ok(Object.values(doc.backend_status).every(status => status === 'NOT_EXECUTED'));
});

test('each case has real multiple-source text or isolated negative, and a unique expected outcome', () => {
  const names = new Set();
  let successes = 0;
  let negatives = 0;
  for (const c of doc.cases) {
    assert.match(c.id, /^[a-z][a-z0-9_]+$/);
    assert.ok(!names.has(c.id), 'duplicate case: ' + c.id);
    names.add(c.id);
    assert.equal(c.entry, 'app.atto');
    assert.ok(c.files[c.entry]?.includes('main'), c.id);
    for (const [p, src] of Object.entries(c.files)) {
      assert.ok(!p.startsWith('/') && !p.includes('..'), c.id + ': escaped source path');
      assert.ok(p.endsWith('.atto') && src.length > 0);
      assert.ok(src.length < 65536, 'fixture exceeds compiler size cap');
    }
    if (c.kind === 'pass') {
      successes++;
      assert.ok(Number.isInteger(c.expected_return), c.id);
      assert.equal(c.expected_error, undefined, c.id);
    } else {
      negatives++;
      assert.equal(c.kind, 'fail', c.id);
      assert.match(c.expected_error, /^E_[A-Z_]+$/, c.id);
      assert.equal(c.expected_return, undefined, c.id);
    }
  }
  assert.ok(successes >= 10);
  assert.ok(negatives >= 17);
});

test('selection, visibility, assignment and static-global rejection are represented', () => {
  for (const id of [
    'dotted_public', 'multiple_aliased', 'explicit_pkg', 'relative_file',
    'private_export', 'wrong_kind_function', 'unknown_export', 'duplicate_alias',
    'local_collision', 'reassignment', 'mutable_global', 'runtime_val_global',
    'const_import_star', 'const_cycle',
    'env_std_qualified_export_import', 'env_same_aot_artifact_different_startups',
    'env_denied_returns_empty', 'env_legacy_and_canonical_same_snapshot',
    'env_wrong_type', 'env_dynamic_key', 'env_spoofed_provider',
    'env_missing_defaults_empty', 'env_constexpr_key_reference',
    'env_private_not_importable', 'const_overflow_across_import',
    'const_dynamic_call_reject', 'env_non_string_key_reject',
  ]) {
    assert.ok(doc.cases.some(c => c.id === id), 'missing ' + id);
  }
  const passes = doc.cases.filter(c => c.kind === 'pass');
  assert.ok(passes.some(c => c.files['app.atto'].includes('import const')));
});


test('qualified std.env constant scenarios record exact launch-time assertions', () => {
  const byId = new Map(doc.cases.map(c => [c.id, c]));
  const basic = byId.get('env_std_qualified_export_import');
  assert.match(basic.files['std/http.atto'], /define pub const string status_valid\s*=\s*std\.env\.read_env\("status_valid"\)/);
  assert.match(basic.files['app.atto'], /import const status_valid from "std\.http"/);
  assert.equal(basic.env.status_valid, 'ready');

  const once = byId.get('env_same_aot_artifact_different_startups');
  assert.equal(once.reuse_compiled_artifact, true);
  assert.equal(once.startups.length, 2);
  assert.notEqual(once.startups[0].env.status_valid, once.startups[1].env.status_valid);
  assert.notEqual(once.startups[0].expected_return, once.startups[1].expected_return);

  const denied = byId.get('env_denied_returns_empty');
  assert.ok(denied.denied_env_keys.includes('status_valid'));
  assert.notEqual(denied.env.status_valid, '');
  assert.equal(denied.expected_return, 1);

  const legacy = byId.get('env_legacy_and_canonical_same_snapshot');
  assert.match(legacy.files['std/http.atto'], /os\.read_env/);
  assert.match(legacy.files['std/http.atto'], /std\.env\.read_env/);
  assert.deepEqual(legacy.expected_initializer_invocations,
    { status_valid: 1, old_status_valid: 1 });
  assert.equal(legacy.expected_host_reads, undefined,
    'per-declaration once semantics do not require cross-constant key caching');

  assert.equal(byId.get('env_constexpr_key_reference').env.status_valid, 'ready');
  assert.deepEqual(byId.get('env_missing_defaults_empty').unset_env_keys, ['ATTO_MISSING_KEY']);
  assert.equal(byId.get('env_private_not_importable').expected_error, 'E_PRIVATE');
  assert.equal(byId.get('const_overflow_across_import').expected_error, 'E_CONST_OVERFLOW');
  assert.equal(byId.get('env_non_string_key_reject').expected_error, 'E_CONST_TYPE');
  for (const name of ['env_wrong_type', 'env_dynamic_key', 'env_spoofed_provider']) {
    assert.equal(byId.get(name).kind, 'fail');
  }
});
