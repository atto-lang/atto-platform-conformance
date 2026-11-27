import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseline = JSON.parse(readFileSync(new URL('../contracts/v1/atto-1.0-release-baseline.json', import.meta.url), 'utf8'));
const required = new Map([
  ['G1','memory-safety'], ['G2','actor-isolation'], ['G3','full-aot'],
  ['G4','core-alloc-std'], ['G5','async-networking'], ['G6','ownership-borrow'],
  ['G7','tier-one-parity'],
]);

// This baseline is intentionally non-promoting. A future authenticated
// evidence verifier must be separately reviewed before qualification.
function validate(x) {
  assert.equal(x.schema, 'atto.release-gates.baseline.v1');
  assert.equal(x.tracker, 'atto-platform-conformance#691');
  assert.equal(x.releaseQualified, false);
  assert.equal(x.tierPolicy, 'PENDING_RATIFICATION');
  assert.deepEqual(x.excludedApplicationGoals, ['kafka-parity','redis-parity','nats-parity','rabbitmq-parity']);
  assert.ok(Array.isArray(x.gates));
  assert.equal(x.gates.length, required.size);
  const seen = new Set();
  for (const g of x.gates) {
    assert.ok(required.has(g.id));
    assert.equal(g.name, required.get(g.id));
    assert.ok(!seen.has(g.id));
    seen.add(g.id);
    assert.equal(g.status, 'NOT_RELEASE_QUALIFIED');
    assert.deepEqual(g.evidence, []);
    assert.ok(Array.isArray(g.requiredScenarios) && g.requiredScenarios.length > 0);
    assert.equal(new Set(g.requiredScenarios).size, g.requiredScenarios.length);
    for (const s of g.requiredScenarios) assert.match(s, /^[a-z][a-z0-9-]+$/);
    assert.ok(Array.isArray(g.trackers) && g.trackers.length > 0);
    for (const t of g.trackers) assert.match(t, /^atto-[a-z0-9.-]+#[1-9][0-9]*$/);
  }
  assert.equal(seen.size, required.size);
}
test('seven mandatory gates are present and explicitly unqualified', () => validate(baseline));
const mutations = [
  ['missing gate', x => x.gates.pop()],
  ['duplicate gate', x => { x.gates[6] = x.gates[0]; }],
  ['unknown gate', x => { x.gates[0].id = 'G8'; }],
  ['empty acceptance scope', x => { x.gates[0].requiredScenarios = []; }],
  ['unverified promotion', x => { x.gates[0].status = 'RELEASE_QUALIFIED'; }],
  ['fabricated receipt', x => { x.gates[0].evidence.push({ result: 'PASS' }); }],
  ['global release promotion', x => { x.releaseQualified = true; }],
  ['broker requirement drift', x => { x.excludedApplicationGoals.pop(); }],
  ['premature tier ratification', x => { x.tierPolicy = 'RATIFIED'; }],
];
for (const [name, mutate] of mutations) {
  test('rejects ' + name, () => {
    const changed = structuredClone(baseline);
    mutate(changed);
    assert.throws(() => validate(changed));
  });
}
