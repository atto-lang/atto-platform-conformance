import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const registry = JSON.parse(readFileSync(new URL('../contracts/tuple-parallel-assignment-v1.json', import.meta.url), 'utf8'));
const backends = ['rust_browser_wasm','java','llvm','net','forge','independent_wasm'];
test('parallel assignment registry is well formed and does not claim unexecuted passes', () => {
  assert.equal(registry.contract, 'atto-tuple-parallel-assignment-v1');
  assert.equal(new Set(registry.cases.map(c => c.id)).size, registry.cases.length);
  assert.ok(registry.cases.length >= 9);
  for (const c of registry.cases) {
    assert.ok(['accept','reject'].includes(c.expect));
    assert.match(c.source, /pub fnc main\(\): int/);
    assert.equal(c.status, 'not_executed');
    for (const b of backends) assert.equal(c.evidence[b], 'not_executed');
    if (c.expect === 'accept') assert.ok(Number.isInteger(c.expected_exit_code));
    else assert.equal(c.expected_exit_code, undefined);
  }
});
test('swaps, rotations, evaluation order and negative diagnostics are covered', () => {
  const byId = new Map(registry.cases.map(c => [c.id,c]));
  for (const id of ['swap-two','rotate-three','rhs-before-write','self-swap']) assert.equal(byId.get(id)?.expect,'accept');
  for (const id of ['duplicate-target','immutable-target','arity-mismatch','type-mismatch','unbound-target']) assert.equal(byId.get(id)?.expect,'reject');
  assert.equal(byId.get('swap-two').expected_exit_code, 65);
  assert.equal(byId.get('rhs-before-write').expected_exit_code, 76);
});
