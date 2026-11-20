import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contract = await readFile(new URL('../docs/CPU_GPU_TASK_V2.md', import.meta.url), 'utf8');
const cases = JSON.parse(await readFile(
  new URL('../fixtures/cpu-gpu-task-v2/unsupported-v2.json', import.meta.url)));

test('CPU/GPU task v2 semantic contract is pinned', () => {
  assert.equal(Object.keys(cases).length, 10);
  assert.equal(new Set(Object.keys(cases)).size, 10);

  for (const phrase of [
    'task expression submits work immediately',
    'Calling `await` does **not** start the task',
    '`task` is contextual, not a globally reserved identifier',
    'Future<void>',
    'No OS thread is created per task',
    '`await` only suspends the waiter',
    'no carrier waits for device completion',
    'No implicit CPU fallback'
  ]) {
    assert.ok(contract.includes(phrase), 'missing normative invariant: ' + phrase);
  }

  assert.match(cases['task-default-future'], / = task \{/);
  assert.match(cases['cpu-task-future'], / = cpu task \{/);
  assert.match(cases['gpu-task-future'], / = gpu task \{/);
  assert.match(cases['legacy-nb-default'], / = nb \{/);
  assert.match(cases['legacy-nb-cpu'], / = nb cpu \{/);
  assert.match(cases['legacy-nb-gpu'], / = nb gpu \{/);
  assert.match(cases['empty-gpu-task-reject'], /gpu task \{\}/);
});

test('task spelling preserves v1 as historical compatibility evidence', () => {
  assert.ok(contract.includes('v1 artifacts stay immutable'));
  assert.ok(contract.includes('nb cpu'));
  assert.ok(contract.includes('nb gpu'));
});
