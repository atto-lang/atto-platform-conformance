import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const registry = JSON.parse(readFileSync(new URL('../contracts/seq-expression-v1.json', import.meta.url), 'utf8'));
const backends = [
  'rust_native', 'rust_browser_wasm', 'llvm', 'java', 'net',
  'wasm_independent', 'forge', 'cranelift', 'js', 'atto', 'hdl'
];
const statuses = new Set(['passed', 'failed', 'unsupported', 'not_executed']);

test('seq expression contract is complete, unique, and fail-closed', () => {
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.contract, 'atto-seq-expression-v1');
  assert.deepEqual(registry.backends, backends);
  assert.deepEqual(registry.allowed_verification_statuses, [...statuses]);
  assert.ok(registry.cases.length >= 38);
  assert.equal(new Set(registry.cases.map(c => c.id)).size, registry.cases.length);
  for (const c of registry.cases) {
    assert.match(c.id, /^seq-[a-z0-9-]+$/);
    assert.ok(['accept', 'reject'].includes(c.expect), c.id);
    assert.ok([1, 2].includes(c.language_version), c.id);
    assert.ok(c.source.includes('pub fnc main()'), c.id);
    assert.ok(statuses.has(c.status), c.id);
    assert.deepEqual(Object.keys(c.evidence), backends, c.id);
    for (const b of backends) assert.ok(statuses.has(c.evidence[b]), c.id + ' ' + b);
    if (c.expect === 'reject') assert.equal(c.expected_return_int, undefined, c.id);
    if (c.expected_return_int !== undefined) assert.equal(c.expected_return_int, 42, c.id);
    // No unverified aggregate result is allowed to claim cross-backend parity.
    if (backends.some(b => c.evidence[b] !== 'passed')) {
      assert.notEqual(c.status, 'passed', c.id + ' cannot have aggregate PASS');
    }
  }
});

test('the registry covers positive and negative contexts, not tuple-pattern v2', () => {
  const cases = registry.cases;
  assert.ok(cases.some(c => c.id === 'seq-tuple-is-not-seq' && c.expect === 'reject'));
  assert.ok(cases.some(c => c.id === 'seq-single' && c.expect === 'accept'));
  for (const group of ['value', 'lexing', 'calls', 'scope', 'assignment', 'control', 'effects', 'delimiters', 'values', 'ownership', 'types', 'editions']) {
    assert.ok(cases.some(c => c.group === group), 'missing coverage group ' + group);
  }
  assert.ok(cases.some(c => c.language_version === 2 && c.expect === 'reject'));
  assert.ok(registry.deferred_gates.length >= 8);
});

test('initial audit is not a fabricated execution receipt', () => {
  assert.equal(registry.cases.filter(c => c.status !== 'not_executed').length, 0);
  for (const c of registry.cases) {
    assert.ok(backends.every(b => c.evidence[b] === 'not_executed'));
  }
});

test('backend candidate heads and restricted semantic subsets are pinned, never counted as PASS', () => {
  const candidates = registry.implementation_candidates;
  assert.deepEqual(Object.keys(candidates), ['rust_native', 'rust_browser_wasm', 'forge', 'net']);
  for (const [backend, candidate] of Object.entries(candidates)) {
    assert.ok(backends.includes(backend), backend);
    assert.match(candidate.pull_request, /^https:\/\/github\.com\/atto-lang\/atto-source\.[a-z]+\/pull\/\d+$/);
    assert.match(candidate.head_sha, /^[0-9a-f]{40}$/);
    assert.match(candidate.source_tree, /^[0-9a-f]{40}$/);
    assert.ok(candidate.scope.length > 35);
    assert.equal(candidate.verification_status, 'not_executed');
  }
  assert.equal(candidates.rust_native.source_tree, candidates.rust_browser_wasm.source_tree);
  // A source implementation candidate is not evidence that any guest has run.
  for (const c of registry.cases) {
    for (const backend of Object.keys(candidates))
      assert.equal(c.evidence[backend], 'not_executed', c.id + ': ' + backend);
  }
});
