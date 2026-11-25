import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const doc = JSON.parse(readFileSync(new URL('../fixtures/import-v2/cases.json', import.meta.url), 'utf8'));

test('v2 corpus is explicit about evidence level and stage counts', () => {
  assert.equal(doc.schema, 'atto.static-import-v2.corpus.v1');
  assert.equal(doc.status, 'CORPUS_ONLY_NOT_BACKEND_EXECUTION');
  assert.equal(doc.cases.length, 96);
  assert.equal(new Set(doc.cases.map(c => c.id)).size, 96);
  assert.equal(new Set(doc.cases.map(c => [c.stage,c.source,c.reference ?? ''].join('\\0'))).size, 96);
  assert.equal(doc.cases.filter(c => c.stage === 'guest').length, 15);
  assert.equal(doc.cases.filter(c => c.stage === 'typed-bindings').length, 62);
  assert.equal(doc.cases.filter(c => c.stage === 'resolution').length, 19);
});
test('mixed delimiter permutations share one ordered binding expectation', () => {
  const cases = doc.cases.filter(c => c.id.startsWith('mixed-permutation-'));
  assert.equal(cases.length, 48);
  for (const c of cases) {
    assert.deepEqual(c.expect.bindings, [['C','class','C'],['Data','class','D'],['fetch','fnc','f'],['g','fnc','g'],['z','namespace','z']]);
    assert.equal(c.fixture, 'mixed-root');
  }
});
test('expectations have valid stages, fixtures, and no fake receipts', () => {
  for (const c of doc.cases) {
    assert.ok(c.source.includes('import ') || c.source.includes('define const '));
    assert.ok(['guest','typed-bindings','resolution'].includes(c.stage));
    assert.ok(['return','reject','identity','bindings'].includes(c.expect.outcome));
    if(c.fixture) assert.ok(Object.hasOwn(doc.fixtures,c.fixture));
    if(c.stage === 'resolution') assert.ok(c.reference);
    if(c.expect.outcome === 'return') assert.equal(c.expect.value,42);
    if(c.expect.outcome === 'reject') assert.ok(c.expect.reason);
    if(c.expect.outcome === 'bindings') {
      const exports = doc.fixtures[c.fixture].exports;
      for(const [,kind,remote] of c.expect.bindings) assert.ok(exports.some(([path,k,pub]) => path===remote && k===kind && pub));
    }
    assert.equal(c.evidence,undefined);
  }
});
