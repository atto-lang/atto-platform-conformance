import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contractPath = new URL('../contracts/v1/NIO_ACTOR_EXECUTION_V1.md', import.meta.url);
const statusPath = new URL('../docs/NIO_ACTOR_EXECUTION_STATUS_2026-10-26.md', import.meta.url);

test('NIO actor execution contract is normative and backend-neutral', async () => {
  const text = await readFile(contractPath, 'utf8');

  for (const required of [
    'normative backend-neutral contract',
    'MUST NOT execute guest code',
    'VM-wide physical execution-carrier budget',
    'CONTROL/failure progress',
    'Future-to-await',
    'LOW int = 1',
    'MEDIUM int = 2',
    'HIGH int = 3',
    'before retiring the execution domain that owns its continuation',
    'A zero-step workflow proves neither pass nor fail'
  ]) {
    assert.ok(text.includes(required), `missing normative invariant: ${required}`);
  }

  for (const implementationLeak of [
    'Current implementation classification',
    'Incremental Java enforcement',
    'OresCarrierPermitPool',
    'OresContext.close()',
    '5..256',
    'e411882d9eccd3445485705a395f217b0a9ecfef',
    '547a2dbf7119eb90f56da3931b68fb8d8e3fd485'
  ]) {
    assert.equal(text.includes(implementationLeak), false,
      `portable contract leaked implementation/status text: ${implementationLeak}`);
  }
});

test('status ledger carries exact backend identities without becoming normative', async () => {
  const text = await readFile(statusPath, 'utf8');

  for (const required of [
    '778057cd7b7f0418c75e1ccb29a8e1a9ae9d5861',
    '287bcd69f77bffc4850477ac05add5b46b2cfc4e',
    'e411882d9eccd3445485705a395f217b0a9ecfef',
    'a19f908555043ba5039a32104e344a6f99bd61d4',
    '4a1c26dec79100823c21a45ede263ad9d0d41ca6',
    '58b8b03865baf146087fcf6e29520179ccc3b8de',
    'e615f7cea2098022c8afdee41b9c75e3ec28ab33',
    '547a2dbf7119eb90f56da3931b68fb8d8e3fd485',
    'NOT_EXECUTED / runner-admission'
  ]) {
    assert.ok(text.includes(required), `missing status identity: ${required}`);
  }

  assert.ok(text.includes('non-normative implementation status'));
  assert.ok(text.includes('grants no private-source transfer authority'));
});
