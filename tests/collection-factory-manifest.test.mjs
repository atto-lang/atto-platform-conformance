import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCollectionFactoryManifest, wrapCollectionFactoryCandidate}
  from '../src/collection-factory-corpus-v1.mjs';

const original = JSON.parse(readFileSync(
  new URL('../fixtures/collection-factories/v1/manifest.json', import.meta.url), 'utf8'));
const mutated = () => structuredClone(original);

test('37 factory targets are source-only and enumerate nine uncertified backends', () => {
  assert.deepEqual(validateCollectionFactoryManifest(original), {
    candidateCount: 37, backendCount: 9, executableParityCertified: false
  });
  assert.deepEqual([...new Set(original.cases.map(c => c.status))], ['TARGET_NOT_EXECUTED']);
});

test('positive Type.of and ~kind cases preserve the same family', () => {
  for (const family of ['map','entry','pair','tuple','array','list','vector','set','record']) {
    const cases = original.cases.filter(c => c.family === family && c.expected === 'ACCEPT');
    assert.ok(cases.some(c => c.source.includes(family[0].toUpperCase() +
      family.slice(1) + '.of')), family);
    assert.ok(cases.some(c => c.source.includes('~' + family + '(') ||
      c.source.includes('~' + family + '<')), family);
  }
});

test('a guest wrapper is only text and cannot certify a backend', () => {
  const result = wrapCollectionFactoryCandidate(original.cases[0]);
  assert.match(result, /^pub fnc main\(\): void \{/);
  assert.ok(result.includes(original.cases[0].source));
  assert.match(result, /return;\n\}\n$/);
});

test('false passing backend evidence never promotes the manifest', () => {
  const sample = mutated();
  sample.backend_status.java = 'PASS';
  assert.throws(() => validateCollectionFactoryManifest(sample), /uncertified/);
  sample.backend_status.java = 'NOT_CERTIFIED';
  sample.status = 'EXECUTED';
  assert.throws(() => validateCollectionFactoryManifest(sample), /false schema status/);
});

test('duplicate cases and omitted collection coverage are rejected', () => {
  const duplicate = mutated();
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => validateCollectionFactoryManifest(duplicate), /invalid candidate/);
  const missing = mutated();
  missing.cases = missing.cases.filter(c => c.family !== 'pair');
  assert.throws(() => validateCollectionFactoryManifest(missing));
});

test('authored factory targets cannot mint guest execution receipts', () => {
  const sample = mutated();
  sample.cases[0].status = 'GUEST_PASS';
  assert.throws(() => validateCollectionFactoryManifest(sample), /falsely asserted execution/);
  assert.throws(() => wrapCollectionFactoryCandidate(sample.cases[0]), /not an admitted/);
});
