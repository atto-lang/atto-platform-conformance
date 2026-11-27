import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateBatch} from '../bin/validate-first-five.mjs';

const manifest = JSON.parse(readFileSync(new URL('../contracts/first-five.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(manifest);

test('canonical batch is planning-only, not executed compiler evidence', () => {
  const result = validateBatch(fresh());
  assert.equal(result.status, 'CONTRACT_VALID_ONLY');
  assert.equal(result.compiler_executed, false);
  assert.equal(result.parity_verified, false);
  for (const coverage of Object.values(result.coverage)) assert.equal(coverage.verified, 0);
});

for (const [i, task] of manifest.tasks.entries()) {
  for (const [j, check] of task.checks.entries()) {
    test(`${task.id}: requires check ${check}`, () => {
      const batch = fresh();
      batch.tasks[i].checks[j] = 'unrelated-check';
      assert.throws(() => validateBatch(batch), /mandatory acceptance check missing/);
    });
  }
  for (const [j, requirement] of task.requires.entries()) {
    test(`${task.id}: requires proof ${requirement}`, () => {
      const batch = fresh();
      batch.tasks[i].requires.splice(j, 1);
      assert.throws(() => validateBatch(batch), /mandatory proof requirement missing/);
    });
  }
  test(`${task.id}: ordering is not semantic`, () => {
    const batch = fresh();
    batch.tasks[i].checks.reverse();
    batch.tasks[i].requires.reverse();
    assert.deepEqual(validateBatch(batch), validateBatch(fresh()));
  });
  test(`${task.id}: additional acceptance checks remain permitted`, () => {
    const batch = fresh();
    batch.tasks[i].checks.push('additional-check');
    assert.deepEqual(validateBatch(batch), validateBatch(fresh()));
  });
  test(`${task.id}: cannot promote planning status to verified`, () => {
    const batch = fresh();
    batch.tasks[i].statuses.java = 'verified';
    assert.throws(() => validateBatch(batch), /unauthenticated verified status/);
  });
}
