import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const registry = load('../contracts/sequence-return-revision-v1.json');
const prior = load('../contracts/seq-expression-v1.json');
const targets = ['rust_native','rust_browser_wasm','llvm','java','net','wasm_independent','forge','cranelift','js','atto','hdl'];
function validate(r) {
  assert.deepEqual(r.backends, targets);
  assert.equal(r.status, 'NOT_EXECUTED');
  assert.equal(r.cases.length, 28);
  assert.equal(new Set(r.cases.map(c => c.id)).size, r.cases.length);
  for (const c of r.cases) {
    assert.match(c.source, /pub fnc main\(\): int/);
    assert.deepEqual(c.confirmedBackends, []);
    assert.deepEqual(c.evidence, Object.fromEntries(targets.map(b => [b,'not_executed'])));
    if (c.expect.kind === 'exit') assert.equal(c.expect.value,42);
    else {
      assert.equal(c.expect.kind,'reject');
      assert.equal(c.expect.value,undefined);
      assert.ok(c.expect.diagnostic);
    }
  }
}
test('all 28 new targets remain unexecuted on all 11 lanes', () => validate(registry));
test('reject forged aggregate, lane, duplicate and missing-case claims', () => {
  for(const mutate of [
    r=>r.status='PASS',
    r=>r.cases[0].evidence.llvm='passed',
    r=>r.cases[0].confirmedBackends.push('llvm'),
    r=>r.cases[1].id=r.cases[0].id,
    r=>r.cases.pop(),
    r=>delete r.cases[0].evidence.hdl
  ]) {
    const copy=structuredClone(registry);
    mutate(copy);
    assert.throws(()=>validate(copy));
  }
});
test('eight exact return combinations and ordinary call discriminators', () => {
  for(const [i,ret] of ['return','^'].entries()) {
    for(const [j,seq] of ['seq 5, 3, 42','seq! 5, 3, 42','seq! (5, 3, 42)','(> 5, 3, 42)'].entries()) {
      const c=registry.cases.find(c=>c.id===`return-${i}-sequence-${j}`);
      assert.equal(c.source,`pub fnc main(): int { ${ret} ${seq}; }\n`);
    }
  }
  for(const id of ['ordinary-seq-call','ordinary-seq-call-spaced','seq-call-single','seq-call-zero','seq-call-not-a-sequence','seq-bang-not-a-call']) {
    assert.equal(registry.cases.find(c=>c.id===id).expect.kind,'exit');
  }
  assert.match(registry.cases.find(c=>c.id==='seq-call-not-a-sequence').source,/return seq\(50, 8\);/);
  assert.match(registry.cases.find(c=>c.id==='seq-bang-not-a-call').source,/return seq! \(50, 42\);/);
});
test('legacy matrix stays aligned, with no new receipt claims', () => {
  assert.equal(prior.cases.length,43);
  assert.equal(prior.normative_spec,registry.contract);
  for(const c of prior.cases) {
    assert.doesNotMatch(c.source,/\bseq\(/,c.id);
    assert.equal(c.status,'not_executed');
    assert.deepEqual(c.evidence,Object.fromEntries(targets.map(b=>[b,'not_executed'])));
  }
});
test('warnings are independently required and reverse order rejects', () => {
  for(const id of ['warned-scalar','warned-tuple','warned-void'])
    assert.ok(registry.cases.find(c=>c.id===id).expect.warning);
  for(const id of ['reverse-return-reject','repeat-caret-reject','legacy-scalar-tuple-reject'])
    assert.equal(registry.cases.find(c=>c.id===id).expect.kind,'reject');
});
