import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const doc = JSON.parse(readFileSync(new URL('../fixtures/import-v2/cases.json', import.meta.url), 'utf8'));

test('v2 corpus is explicit about evidence level and stage counts', () => {
  assert.equal(doc.schema, 'atto.static-import-v2.corpus.v1');
  assert.equal(doc.status, 'CORPUS_ONLY_NOT_BACKEND_EXECUTION');
  assert.equal(doc.cases.length, 210);
  assert.equal(new Set(doc.cases.map(c => c.id)).size, 210);
  assert.equal(new Set(doc.cases.map(c => [c.stage,c.source,c.reference ?? '',c.currentNamespace ?? ''].join('\\0'))).size, 210);
  assert.equal(doc.cases.filter(c => c.stage === 'guest').length, 56);
  assert.equal(doc.cases.filter(c => c.stage === 'typed-bindings').length, 62);
  assert.equal(doc.cases.filter(c => c.stage === 'resolution').length, 92);
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
    assert.ok(c.source.includes('import ') || c.source.includes('define alias '));
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

test('expanded cases include executable relative functions and distinct tree/manifest negatives', () => {
  assert.equal(doc.cases.filter(c => c.id.startsWith('relative-')).length,18);
  assert.equal(doc.cases.filter(c => c.id.startsWith('tree-')).length,20);
  assert.equal(doc.cases.filter(c => c.id.startsWith('manifest-')).length,16);
  assert.ok(doc.fixtures['relative-functions'].files['math.atto'].includes('pub fnc square'));
  for (const c of doc.cases.filter(c => c.id.startsWith('tree-') || c.id.startsWith('manifest-'))) {
    if(c.expect.outcome==='identity' && c.expect.declaration) assert.ok(doc.fixtures[c.fixture].exports.some(([p,,pub])=>p===c.expect.declaration&&pub));
  }
});

test('both alias spellings have real guest and cycle diagnostic expectations', () => {
  assert.equal(doc.cases.filter(c => c.id.startsWith('builtin-alias-')).length,4);
  assert.equal(doc.cases.filter(c => c.id.startsWith('alias-guest-negative-')).length,8);
  assert.equal(doc.cases.filter(c => c.id.startsWith('alias-resolution-')).length,4);
  assert.equal(doc.cases.filter(c => c.stage==='guest' && c.expect.code==='E_IMPORT_CYCLE').length,5);
});

test('recursive tree and contextual root expansion adds 23 base and ten hardening resolution targets', () => {
  assert.equal(doc.cases.filter(c => c.id.startsWith('tree-v2-')).length,14);
  assert.equal(doc.cases.filter(c => c.id.startsWith('context-')).length,19);
});

test('malformed context metadata cannot be erased by parent traversal', () => {
  const cases=doc.cases.filter(c=>c.id.startsWith('context-hardening-'));
  assert.equal(cases.length,10);
  assert.equal(new Set(cases.map(c => JSON.stringify([c.source,c.currentNamespace]))).size,10);
  for(const c of cases) {
    assert.equal(c.stage,'resolution');
    assert.equal(c.fixture,'contextual-root');
    assert.equal(c.expect.outcome,'reject');
    assert.equal(c.adapterInput,'contextual-resolver');
    assert.equal(c.expect.code,'E_IMPORT_PATH');
    assert.equal(c.expect.atomic,true);
  }
});

test('builtin tree expansion adds eleven guest expectations', () => { assert.equal(doc.cases.filter(c => c.id.startsWith('builtin-tree-')).length,11); });
