import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contractUrl = new URL('../contracts/actor-stack-containment-v1.json', import.meta.url);
const expectedBackends = ['forge', 'java', 'llvm', 'net', 'wasm'];
const evidenceKeys = [
  'admission', 'compilerGuest', 'actorSurvival',
  'nativeLowStack', 'supervisorRecovery'
];

async function load() {
  return JSON.parse(await readFile(contractUrl, 'utf8'));
}

// Fail closed until actual exact-head provenance, stepful jobs and compiler
// guest executions are independently verified. A manifest cannot self-certify.
function validatePending(matrix) {
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.id, 'actor-stack-containment-v1');
  assert.equal(matrix.language, 'AttoLang');
  assert.equal(matrix.canonicalExtension, '.atto');
  assert.deepEqual(matrix.backends.map(item => item.id).sort(), expectedBackends);
  assert.equal(matrix.promotion.certified, false);
  assert.equal(matrix.promotion.zeroStepCountsAsExecuted, false);
  assert.equal(matrix.promotion.sourceFreeCanaryCountsAsGuest, false);
  for (const backend of matrix.backends) {
    assert.equal(backend.exactHeadReceipt, null);
    for (const key of evidenceKeys) {
      assert.equal(backend[key], 'NOT_EXECUTED',
        'cannot claim ' + backend.id + '.' + key + ' without receipt');
    }
  }
  assert.equal(matrix.requirements.nativeStackOverflowRecoverableOnSharedCarrier, false);
  assert.equal(matrix.requirements.untrustedArbitraryNativeCodeRequiresKillableWorker, true);
  assert.ok(matrix.scenarios.length >= 7);
  const ids = matrix.scenarios.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const scenario of matrix.scenarios) {
    assert.ok(scenario.requiredEvidence.length > 0);
    for (const key of scenario.requiredEvidence) assert.ok(evidenceKeys.includes(key));
    if (scenario.source !== null) {
      assert.match(scenario.source, /^fixtures\/actor-stack-containment-v1\/[\w-]+\.atto$/);
    } else {
      assert.ok(scenario.kind.startsWith('pending-'));
    }
  }
  return matrix;
}

test('five-backend stack containment contract stays explicitly unexecuted', async () => {
  validatePending(await load());
});

test('all authored AttoLang source fixtures exist and have distinct cases', async () => {
  const matrix = validatePending(await load());
  const sources = matrix.scenarios.filter(c => c.source);
  assert.equal(sources.length, 5);
  for (const scenario of sources) {
    const text = await readFile(new URL('../' + scenario.source, import.meta.url), 'utf8');
    assert.match(text, /pub (?:suspends )?routine main\(\): void/);
    assert.ok(text.length > 40);
  }
});

test('fake pass, duplicate backend, deleted proof and false promotion are rejected', async () => {
  const original = validatePending(await load());
  const mutate = fn => { const changed = structuredClone(original); fn(changed); return changed; };
  assert.throws(() => validatePending(mutate(m => {m.promotion.certified = true;})));
  assert.throws(() => validatePending(mutate(m => {m.backends[0].compilerGuest = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.backends[0].id = m.backends[1].id;})));
  assert.throws(() => validatePending(mutate(m => {delete m.backends[0].nativeLowStack;})));
  assert.throws(() => validatePending(mutate(m => {m.promotion.zeroStepCountsAsExecuted = true;})));
  assert.throws(() => validatePending(mutate(m => {m.scenarios[0].source = 'fixtures/legacy.ores';})));
  assert.throws(() => validatePending(mutate(m => {m.scenarios[4].kind = 'positive';})));
});

test('sibling overflow fixture is a pending guest acceptance case, not a parity pass', async () => {
  const contract = validatePending(await load());
  const scenario = contract.scenarios.find(item => item.id === 'sibling-actor-survival');
  assert.equal(scenario.kind, 'pending-actor-acceptance');
  assert.equal(scenario.guestVerified, false);
  assert.equal(scenario.expectedSiblingStdout, '42');
  assert.ok(scenario.requiredEvidence.includes('actorSurvival'));
  assert.ok(scenario.requiredEvidence.includes('supervisorRecovery'));
  const source = await readFile(new URL('../' + scenario.source, import.meta.url), 'utf8');
  assert.match(source, /define actor OverflowActor as/);
  assert.match(source, /define actor HealthyActor as/);
  assert.match(source, /return 1 \+ non_tail_overflow\(remaining - 1\)/);
  assert.match(source, /healthy\.send\(41\)/);
  assert.match(source, /await healthy\.get_done\(\)/);
  for (const backend of contract.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.actorSurvival, 'NOT_EXECUTED');
    assert.equal(backend.supervisorRecovery, 'NOT_EXECUTED');
  }
});
