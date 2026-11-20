import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const c = JSON.parse(readFileSync(new URL('../contracts/record-static-bracket-write-v1.json', import.meta.url), 'utf8'));
const backends = ['rust_browser_wasm','java','llvm','net','forge','independent_wasm','cranelift','atto_native'];
test('20 Record cases have only receipt-backed Rust/browser execution evidence', () => {
  assert.equal(c.schema_version, 1);
  assert.equal(c.contract, 'atto-record-static-bracket-write-v1');
  assert.equal(c.status, 'partially_verified');
  assert.equal(c.cases.length, 20);
  assert.equal(new Set(c.cases.map(x=>x.id)).size, 20);
  assert.equal(c.cases.filter(x=>x.expect==='accept').length, 8);
  assert.equal(c.cases.filter(x=>x.expect==='reject').length, 12);
  for (const item of c.cases) {
    assert.match(item.id, /^(record|struct)-[a-z0-9-]+$/);
    assert.equal(item.status, 'partially_verified');
    assert.match(item.source, /pub fnc main\(\): int/);
    assert.ok(item.reason.length > 12);
    assert.deepEqual(Object.keys(item.evidence).sort(), [...backends].sort());
    for (const target of backends) {
      assert.equal(item.evidence[target], target === 'rust_browser_wasm' ? 'passed' : 'not_executed');
    }
    if (item.expect === 'accept') {
      assert.equal(item.group, 'guest');
      assert.ok(Number.isInteger(item.expected_exit));
      assert.equal(item.expected_error, undefined);
    } else {
      assert.equal(item.group, 'negative');
      assert.match(item.expected_error, /^E_[A-Z_]+$/);
      assert.equal(item.expected_exit, undefined);
    }
  }
});
test('bracket update respects existing known field, mutability and Struct exclusion', () => {
  const byId = new Map(c.cases.map(x=>[x.id,x]));
  for (const id of ['record-write-identifier','record-write-hyphen',
    'record-dot-bracket-same-field','record-write-empty-key','record-write-unicode',
    'record-write-val-mut','record-write-other-fields-preserved',
    'record-write-nfc-nfd-distinct','record-immutable-val','record-immutable-let',
    'record-missing-field','record-wrong-field-type','record-computed-index',
    'record-expression-index','record-numeric-index','struct-bracket-read',
    'struct-bracket-write','record-shadowed-scalar','record-after-take',
    'record-shared-loan-conflict']) assert.ok(byId.has(id), id);
  assert.equal(byId.get('record-write-identifier').expected_exit, 3);
  assert.equal(byId.get('record-missing-field').expected_error, 'E_NO_FIELD');
  assert.equal(byId.get('record-wrong-field-type').expected_error, 'E_TYPE');
  assert.equal(byId.get('record-immutable-let').expected_error, 'E_IMMUTABLE');
  assert.equal(byId.get('record-computed-index').expected_error, 'E_UNSUPPORTED');
  assert.equal(byId.get('struct-bracket-read').expected_error, 'E_UNSUPPORTED');
  assert.equal(byId.get('struct-bracket-write').expected_error, 'E_UNSUPPORTED');
});

test('verified Rust/browser results bind each case to an exact real CI guest receipt', () => {
  const evidence = JSON.parse(readFileSync(new URL(
    '../evidence/record-static-bracket-write-rust-browser-v1.json', import.meta.url
  ), 'utf8'));
  const record = c.verification.rust_browser_wasm;
  assert.equal(evidence.schema_version, 1);
  assert.equal(evidence.contract, c.contract);
  assert.equal(evidence.source_repo, 'atto-lang/atto-source.rs');
  assert.match(evidence.source_commit, /^[a-f0-9]{40}$/);
  assert.equal(record.source_commit, evidence.source_commit);
  assert.equal(record.source_root_tree, evidence.source_root_tree);
  assert.equal(record.carrier_commit, evidence.carrier_commit);
  assert.equal(record.ci_run_id, evidence.ci_run_id);
  assert.equal(record.ci_run_url, evidence.ci_run_url);
  assert.equal(record.ci_job_id, evidence.ci_job_id);
  assert.equal(record.evidence_path, 'evidence/record-static-bracket-write-rust-browser-v1.json');
  assert.ok(evidence.ci_run_url.startsWith('https://github.com/embedded-alerts-test/atto-ci/actions/runs/'));
  assert.equal(evidence.source_subset.source_blobs_verified, 38);
  assert.equal(evidence.source_subset.source_blobs_total, 728);
  assert.equal(evidence.source_subset.full_tree_mirror, false);
  assert.equal(evidence.source_subset.all_selected_sha_exact, true);
  assert.equal(record.full_tree_verified, false);
  assert.equal(evidence.outcomes.source_commit, evidence.source_commit);
  assert.equal(evidence.outcomes.compiler, 'native_attoc_and_browser_compiler_wasm');
  assert.equal(evidence.outcomes.verified_compiler_byte_parity, true);
  assert.equal(evidence.outcomes.summary.passed, 20);
  assert.equal(evidence.outcomes.cases.length, 20);
  assert.equal(c.backend_status.rust_browser_wasm, 'passed');
  for (const target of backends.filter(x => x !== 'rust_browser_wasm')) {
    assert.equal(c.backend_status[target], 'not_executed');
  }
  const resultById = new Map(evidence.outcomes.cases.map(x => [x.id,x]));
  assert.equal(resultById.size, c.cases.length);
  for (const item of c.cases) {
    const result = resultById.get(item.id);
    assert.ok(result, 'no matching CI receipt for '+item.id);
    assert.equal(result.expect, item.expect);
    assert.equal(result.status, 'passed');
    assert.equal(item.evidence.rust_browser_wasm, 'passed');
    if (item.expect === 'accept') {
      assert.equal(result.wasm_executed, true);
      assert.equal(result.browser_guest_executed, true);
      assert.equal(result.byte_identical, true);
      assert.equal(result.diagnostic, null);
    } else {
      assert.equal(result.wasm_executed, false);
      assert.equal(result.browser_rejected, true);
      assert.equal(result.diagnostic, item.expected_error);
      assert.equal(result.reason, 'native_browser_expected_diagnostic_no_guest');
    }
  }
});
