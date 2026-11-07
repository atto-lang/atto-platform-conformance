import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const c=JSON.parse(readFileSync(new URL('../contracts/atto-local-context-m2-20261107.json',import.meta.url),'utf8'));
test('contract remains non-promoting and includes all five backend families',()=>{
  assert.equal(c.status,'candidate-unattested');
  assert.deepEqual(c.backendFamilies,['java','llvm','net','wasm','forge']);
  assert.equal(c.scenarios.length,32);
});
test('all scenario ids are unique and finite',()=>{
  const ids=c.scenarios.map(x=>x.id);assert.equal(new Set(ids).size,ids.length);
  assert.ok(ids.every(x=>/^LC-M2-\d{2}$/.test(x)));
});
test('all scenarios remain unexecuted until independently witnessed',()=>{
  for(const x of c.scenarios){assert.equal(x.status,'NOT_EXECUTED');
    assert.deepEqual(Object.keys(x.backendEvidence),c.backendFamilies);
    assert.ok(Object.values(x.backendEvidence).every(v=>v==='NOT_EXECUTED'));}
});
test('coverage contains task actor thread request and evidence-domain negatives',()=>{
  for(const k of ['task','actor','thread','request','all']) assert.ok(c.scenarios.some(x=>x.scope===k));
  assert.ok(c.scenarios.filter(x=>x.expectedKind==='negative').length>=20);
});
test('pinned LLVM guest bytes and expected exit are explicitly fixed',()=>{
  const p=c.canonicalLLVMPositive; assert.equal(p.expectedExit,42);
  assert.equal(p.blob,'7d3fe3b57154f0c780e26283a7467b31f3782561');
  assert.equal(p.head,'30861ebd6b0770c64b71ec388e54348218e86713');
});

test('read lifetime semantic boundary distinguishes revocation from replacement',()=>{
  const closed=c.scenarios.find(s=>s.id==='LC-M2-31');
  const replaced=c.scenarios.find(s=>s.id==='LC-M2-32');
  assert.equal(closed.scope,'task');
  assert.equal(replaced.scope,'task');
  assert.equal(closed.expectedKind,'negative');
  assert.equal(replaced.expectedKind,'positive');
  assert.match(closed.acceptance,/closed during .*copy|scope is closed during/);
  assert.match(closed.acceptance,/no value is returned/);
  assert.match(replaced.acceptance,/old snapshot/);
  assert.match(replaced.acceptance,/next read sees the replacement/);
  assert.equal(closed.status,'NOT_EXECUTED');
  assert.equal(replaced.status,'NOT_EXECUTED');
});
