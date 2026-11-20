import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contract = await readFile(new URL('../docs/ASYNC_TASK_BORROW_SAFETY_V1.md', import.meta.url), 'utf8');
const cases = JSON.parse(await readFile(new URL('../fixtures/async-task-borrow-safety-v1/cases.json', import.meta.url)));

test('async Task borrow-safety v1 contract is pinned', () => {
  assert.equal(Object.keys(cases).length, 20);
  for (const phrase of [
    'Submission—not `await`—is the ownership-transfer boundary',
    'Unknown AST forms fail closed',
    'compiler-derived transitive Send proof',
    'Launch authority is one-shot',
    'revalidated on every physical resume',
    'Scoped mutable WRITE capture remains rejected',
    'physical quiescence',
    'independent Task never inherits actor `self`'
  ]) assert.ok(contract.includes(phrase), 'missing invariant: ' + phrase);
});

test('fixtures use canonical Oreslang ownership syntax', () => {
  const source = Object.values(cases).join('\n');
  assert.match(source, /rt borrow owner/);
  assert.match(source, /rt mut borrow owner/);
  assert.match(source, /rt copy x/);
  assert.match(source, /rt share x/);
  assert.doesNotMatch(source, /rt borrow mut/);
  assert.doesNotMatch(source, /\b(?:val|let|const)\s+&/);
});

test('matrix covers concurrency and lifetime edge cases', () => {
  for (const name of [
    'double-owned-capture-reject',
    'future-double-use-reject',
    'actor-self-capture-reject',
    'nested-borrow-reject',
    'for-initializer-borrow-reject',
    'borrow-across-await-reject',
    'gpu-borrow-without-fence-reject',
    'borrowed-future-payload-reject',
    'rc-owned-capture-reject',
    'non-send-wrapper-launder-reject',
    'mutex-owned-capture-ok',
    'send-wrapper-capture-ok'
  ]) assert.ok(cases[name], 'missing case: ' + name);
});


test('fixtures are self-contained for helper nominal types', () => {
  for (const [name, source] of Object.entries(cases)) {
    if (/\bBox\b/.test(source)) {
      assert.match(source, /define class Box\b/, name + ': Box must be defined');
    }
    if (/\bBuffer\b/.test(source)) {
      assert.match(source, /define class Buffer\b/, name + ': Buffer must be defined');
    }
  }
});

test('auto-trait fixtures distinguish Send synchronization from non-Send Rc', () => {
  assert.match(cases['mutex-owned-capture-ok'], /Mutex<int>/);
  assert.match(cases['send-wrapper-capture-ok'], /Mutex<int>/);
  assert.match(cases['rc-owned-capture-reject'], /Rc<int>/);
  assert.match(cases['non-send-wrapper-launder-reject'], /Rc<int>/);
});
