import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const registry = JSON.parse(readFileSync(new URL('../contracts/tuple-destructuring-v1.json', import.meta.url), 'utf8'));
const backends = ['rust_browser_wasm', 'java', 'llvm', 'net', 'forge', 'independent_wasm'];
const states = new Set(['passed', 'failed', 'unsupported', 'not_executed']);

test('tuple destructuring target registry has complete and distinct cases', () => {
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.contract, 'atto-tuple-destructuring-v1');
  assert.ok(registry.cases.length >= 33);
  assert.equal(new Set(registry.cases.map(c => c.id)).size, registry.cases.length);
  for (const c of registry.cases) {
    assert.match(c.id, /^tuple-[a-z0-9-]+$/);
    assert.ok(['accept', 'reject'].includes(c.expect));
    assert.ok(c.source.includes('pub fnc main()'));
    assert.ok(c.reason.length > 8);
    assert.ok(states.has(c.status));
    for (const backend of backends) assert.ok(states.has(c.evidence[backend]), c.id + ' missing ' + backend);
  }
});

test('both acceptance and rejection are represented across all required semantics', () => {
  const cases = registry.cases;
  for (const group of ['basic', 'shape', 'const', 'alias', 'mutability', 'scope', 'syntax']) {
    assert.ok(cases.some(c => c.group === group), 'missing group ' + group);
  }
  assert.ok(cases.some(c => c.expect === 'accept' && c.source.includes('mut j')));
  assert.ok(cases.some(c => c.expect === 'accept' && c.source.includes('(let a, val r')));
  assert.ok(cases.some(c => c.expect === 'accept' && c.source.includes('as foo')));
  assert.ok(cases.some(c => c.expect === 'reject' && c.source.includes('const mut')));
  assert.ok(cases.some(c => c.expect === 'reject' && c.source.includes('const r') && c.source.includes('fixtures()')));
  assert.ok(cases.some(c => c.expect === 'reject' && c.id === 'tuple-alias-overlap'));
  assert.ok(cases.some(c => c.expect === 'reject' && c.id === 'tuple-singleton-without-comma'));
  assert.ok(cases.some(c => c.expect === 'reject' && c.id === 'tuple-runtime-const-and-scalar-const-mut'));
  for (const id of ['tuple-typed-as-let-alias', 'tuple-typed-as-val-alias', 'tuple-typed-as-const-alias-literal', 'tuple-let-alias-reassign-after-last-use']) {
    assert.ok(cases.some(c => c.expect === 'accept' && c.id === id), 'missing positive case ' + id);
  }
  for (const id of ['tuple-runtime-as-const-reject', 'tuple-as-val-rebind-reject', 'tuple-as-const-rebind-reject', 'tuple-let-root-active-mut-loan-rebind-reject']) {
    assert.ok(cases.some(c => c.expect === 'reject' && c.id === id), 'missing negative case ' + id);
  }
});

test('reported Rust/browser-Wasm outcomes are pinned to an executed, matching receipt', () => {
  const metadata = registry.rust_browser_wasm_provenance;
  assert.match(metadata.source_sha, /^[a-f0-9]{40}$/);
  assert.match(metadata.run_url, /^https:\/\/github.com\/usa-acc\/atto-ci\/actions\/runs\/\d+$/);
  assert.match(metadata.receipt, /^evidence\/tuple\/rs-browser-wasm-[a-f0-9]+-\d+\.json$/);
  assert.equal(metadata.source_blobs_verified, 60);
  assert.equal(metadata.conformance_blobs_verified, 2);
  const receipt = JSON.parse(readFileSync(new URL('../' + metadata.receipt, import.meta.url), 'utf8'));
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.contract, registry.contract);
  assert.equal(receipt.source_commit, metadata.source_sha);
  assert.equal(receipt.provenance.run_url, metadata.run_url);
  assert.equal(receipt.provenance.run_conclusion, 'success');
  assert.equal(receipt.provenance.source_blobs_verified, 60);
  assert.equal(receipt.provenance.conformance_blobs_verified, 2);
  assert.equal(receipt.cases.length, registry.cases.length);
  assert.equal(new Set(receipt.cases.map(c => c.id)).size, registry.cases.length);

  const byId = new Map(receipt.cases.map(c => [c.id, c]));
  const counts = {passed: 0, unsupported: 0, failed: 0};
  let executedGuest = 0;
  for (const c of registry.cases) {
    const result = byId.get(c.id);
    assert.ok(result, 'missing exact receipt for ' + c.id);
    assert.equal(result.expect, c.expect);
    assert.equal(c.evidence.rust_browser_wasm, result.status, 'divergent receipt for ' + c.id);
    assert.ok(['passed', 'unsupported', 'failed'].includes(result.status));
    counts[result.status]++;
    if (result.status === 'passed' && c.expect === 'accept') {
      assert.equal(result.wasm_executed, true, 'pass requires real guest execution for ' + c.id);
      assert.equal(result.reason, 'compiled_and_executed_guest');
      executedGuest++;
    } else if (result.status === 'passed' && c.expect === 'reject') {
      assert.equal(result.wasm_executed, false);
      assert.match(result.diagnostic || '', /^E_[A-Z_]+$/);
      assert.equal(result.reason, 'expected_diagnostic');
    } else if (result.status === 'unsupported') {
      assert.equal(result.wasm_executed, false);
      assert.match(result.diagnostic || '', /^E_UNSUPPORTED(_TYPE)?$/);
    }
    // The case-level status denotes entire six-backend parity, not Rust-only
    // evidence, so it remains not_executed while other backends are untested.
    assert.equal(c.status, 'not_executed');
    for (const backend of backends.filter(b => b !== 'rust_browser_wasm')) {
      assert.equal(c.evidence[backend], 'not_executed', 'no other backend proof for ' + c.id);
    }
  }
  assert.deepEqual(counts, {passed: 29, unsupported: 4, failed: 0});
  assert.equal(executedGuest, 15);
  assert.equal(metadata.positive_guest_executed, executedGuest);
  assert.equal(metadata.passed, counts.passed);
  assert.equal(metadata.unsupported, counts.unsupported);
  assert.equal(metadata.failed, counts.failed);
  assert.deepEqual(receipt.summary, {passed: 29, unsupported: 4});
});
