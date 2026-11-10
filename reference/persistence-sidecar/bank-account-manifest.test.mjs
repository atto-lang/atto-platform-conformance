// Manifest integrity only, not source compiler/runtime evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const m=JSON.parse(readFileSync(new URL('../../contracts/event-sourcing-bank-account-v1.json', import.meta.url),'utf8'));
test('BankAccount conformance inventory is complete and explicitly NOT_EXECUTED',()=>{
  assert.equal(m.schema,'atto.event-sourcing.bank-account/1');
  assert.deepEqual(m.backendTargets,['java','llvm','net','wasm','forge']);
  assert.equal(m.cases.length,20);
  assert.equal(new Set(m.cases.map(x=>x.id)).size,20);
  for(const entry of m.cases){
    assert.match(entry.id,/^ESBA\d{2}$/);
    assert.equal(entry.expected,'PASS');
    for (const backend of m.backendTargets)
      assert.equal(entry.results[backend],'NOT_EXECUTED');
  }
});
test('do not accidentally mark synthetic fixtures as native actor execution',()=>{
  const fixture=readFileSync(new URL('../../fixtures/event-sourcing/bank-account.atto',import.meta.url),'utf8');
  assert.match(fixture,/NOT parsed\/compiled/);
  assert.match(fixture,/from EventSourcedActor</);
  assert.match(fixture,/pure apply_event/);
  assert.match(fixture,/state \{/);
});
