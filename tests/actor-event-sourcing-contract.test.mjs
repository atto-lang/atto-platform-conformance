// Host-only conformance manifest gate; NO AttoLang guest or SQLite journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const c = JSON.parse(readFileSync(new URL('../contracts/actor-event-sourcing-v1.json', import.meta.url), 'utf8'));
test('policy flags and backend execution state are not conflated', () => {
  assert.equal(c.status, 'TARGET_ONLY_NO_SOURCE_GUEST_EXECUTION');
  assert.ok(Object.values(c.backendStatus).every(x => x==='NOT_EXECUTED'));
  assert.deepEqual(c.policySymbols, ['#none','#snapshot','#event_sourced','#batched_sidecar']);
  assert.equal(c.evidenceRules.standaloneSQLiteStateSnapshotIsNotEventJournal, true);
  assert.equal(c.evidenceRules.externalEffectsExactlyOnce, false);
});
test('all cases are unique and runtime scenarios stay NOT_EXECUTED', () => {
  assert.ok(c.cases.length >= 18);
  assert.equal(new Set(c.cases.map(x=>x.id)).size,c.cases.length);
  const valid = new Set(['parse','semantic','runtime']);
  for (const x of c.cases) {
    assert.ok(valid.has(x.phase), x.id);
    if (x.phase==='runtime') assert.equal(x.expect,'NOT_EXECUTED',x.id);
    if (x.expect==='REJECT_TARGET_ONLY') assert.ok(x.diagnostic,x.id);
    assert.ok(x.fixture||x.scenario,x.id);
    if (x.fixture) {
      const text = readFileSync(new URL('../'+x.fixture, import.meta.url),'utf8');
      assert.ok(text.length>10,x.id);
    }
  }
});
test('canonical syntax uses durable actor, state, receive, not event actor', () => {
  const ok = readFileSync(new URL('../fixtures/actors/event_sourcing/durable_actor_declaration.atto',import.meta.url),'utf8');
  const bad = readFileSync(new URL('../fixtures/actors/event_sourcing/invalid_event_actor_keyword.atto',import.meta.url),'utf8');
  assert.match(ok,/define durable actor BankAccount as/);
  assert.match(ok,/state balance: int = 0;/);
  assert.match(ok,/receive\(ActorMail<int> mail\): void/);
  assert.match(bad,/define event actor/);
});
test('critical safety scenarios are enumerated', () => {
  const ids=new Set(c.cases.map(x=>x.id));
  for (const id of ['epoch-fenced-before-dedupe','same-op-same-payload','same-op-different-payload',
      'ambiguous-outcome','commit-before-publication','crash-after-commit-before-ack','replay-purity',
      'snapshot-offset-contiguity','cross-tenant-identity','batched-sidecar-only']) {
    assert.ok(ids.has(id),id);
  }
});
