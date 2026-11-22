// Structural registry verification only. NO Atto compiler, database or crash test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const contract=JSON.parse(readFileSync(new URL('../contracts/durable-typed-protocols-v1.json',import.meta.url),'utf8'));
test('contract extends event-sourced durable actors without claiming backend execution',()=>{
  assert.equal(contract.status,'TARGET_ONLY_NO_GUEST_EXECUTION');
  assert.ok(Object.values(contract.backendStatus).every(x=>x==='NOT_EXECUTED'));
  assert.equal(contract.noExactlyOnceNetworkDelivery,true);
  assert.equal(contract.evidenceRules.hostModelOnly,true);
  assert.equal(contract.evidenceRules.sqlDurabilityCertified,false);
  assert.equal(contract.evidenceRules.crashRecoveryCertified,false);
  assert.equal(contract.contractGuarantee,'LOCAL_ATOMICITY_AND_AT_LEAST_ONCE_ATTEMPTS');
});
test('transaction scope, schema gates and epoch ordering are explicit',()=>{
  assert.deepEqual(contract.requiredTransaction,['inbox_dedupe','state_or_event_batch','outbox_intents','commit_receipt']);
  for(const v of Object.values(contract.versionRules))assert.equal(v,true);
  assert.match(contract.spec,/atto-spec\/language\/durable-typed-protocols-v1\.md/);
});
test('sixteen unique adversarial cases stay unexecuted as backend proof',()=>{
  assert.equal(contract.cases.length,16);
  assert.equal(new Set(contract.cases.map(c=>c.id)).size,contract.cases.length);
  for(const c of contract.cases){
    assert.ok(c.scenario.length>15,c.id);
    assert.ok(['semantic','runtime'].includes(c.phase),c.id);
    if(c.phase==='runtime')assert.equal(c.expect,'NOT_EXECUTED',c.id);
    else {assert.equal(c.expect,'REJECT_TARGET_ONLY',c.id);assert.ok(c.diagnostic,c.id);}
  }
});
test('failure modes and versioning include no implicit exactly-once guarantee',()=>{
  const ids=new Set(contract.cases.map(x=>x.id));
  for(const id of ['old-version-upcast','unknown-future-reject','migration-rollback','original-digest-dedupe','conflicting-idempotency','epoch-before-dedupe','atomic-outbox','crash-after-commit-lost-receipt','stale-outbox-claim','at-least-once-duplicate-window','journal-gap-recovery','unsupported-provider-fail-closed'])assert.ok(ids.has(id),id);
});
