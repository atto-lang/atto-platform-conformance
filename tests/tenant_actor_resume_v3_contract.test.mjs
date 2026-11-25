import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contract = JSON.parse(await readFile(new URL('../contracts/tenant_actor_resume_v3_draft.json', import.meta.url), 'utf8'));

test('v3 is a distinct, explicitly gated draft ABI', () => {
  assert.equal(contract.guest_abi, 'atto.browser.guest.v3');
  assert.equal(contract.previous_guest_abi, 'atto.browser.guest.v2');
  assert.equal(contract.status, 'design_only_not_implemented');
  assert.equal(contract.custom_section.name, 'atto.actor.abi');
  assert.equal(contract.custom_section.payload_hex, '0300');
  assert.match(contract.custom_section.policy, /no_implicit_v2_upgrade/);
});

test('v3 resume result values are unambiguous and bounded', () => {
  assert.deepEqual(contract.resume_statuses, {
    YIELDED: 0, WAITING_MAILBOX: 1, WAITING_IO: 2,
    COMPLETED: 3, RAISED: 4, PANICKED: 5
  });
  const values = Object.values(contract.resume_statuses);
  assert.equal(new Set(values).size, values.length);
  for (const required of ['memory','actor_init','actor_deliver','actor_resume','actor_stack_used','actor_heap_used']) {
    assert.equal(typeof contract.required_exports[required], 'string');
    assert.ok(contract.required_exports[required].length);
  }
});

test('conformance cases are all explicitly NOT executed pending real guest support', () => {
  assert.equal(contract.cases.length, 9);
  const ids = contract.cases.map(testCase => testCase.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const testCase of contract.cases) {
    assert.match(testCase.id, /^A3-00[1-9]$/);
    assert.equal(testCase.status, 'not_executed');
    assert.ok(testCase.expected.length > 20);
  }
  assert.ok(contract.host_invariants.some(s => /Fuel bounds/.test(s)));
  assert.ok(contract.host_invariants.some(s => /private|cross-actor/.test(s)));
});
