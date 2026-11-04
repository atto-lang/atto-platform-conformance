import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {caseIds,fixtureDir,runLlvmThreadM0} from '../src/llvm-thread-spawn-m0.mjs';

// This intentionally mocked compiler checks ONLY the evidence harness.
// Real LLVM execution remains an external, exact-source required gate.
const stub = [
  '#!/usr/bin/env node',
  "const fs=require('node:fs');",
  "const path=require('node:path');",
  'const p=process.argv[2];',
  "if (process.env.MUTATION==='artifact') fs.writeFileSync('unexpected.o','x');",
  "if (process.env.MUTATION==='hidden') fs.writeFileSync('.private-ir','x');",
  "if (process.env.MUTATION==='source') fs.appendFileSync(p,'// mutation');",
  "if (path.basename(p)==='ordinary-thread-identifier.atto') {",
  "  if (process.env.MUTATION==='reject-positive') process.exit(9);",
  "  console.log('define i64 @main() { ret i64 7 }');",
  '  process.exit(0);',
  '}',
  "if (process.env.MUTATION==='accept-negative') process.exit(0);",
  "if (process.env.MUTATION==='wrong-diagnostic') console.error('OTHER_CODE');",
  "else console.error('THREAD_SPAWN_BACKEND_UNSUPPORTED');",
  "if (process.env.MUTATION==='stdout') process.stdout.write('unexpected LLVM IR');",
  'process.exit(2);',
].join('\n')+'\n';
const head = 'a'.repeat(40), tree = 'b'.repeat(40);
function withStub(run) {
  const folder=mkdtempSync(join(tmpdir(),'atto-m0-stub-'));
  try {
    const compiler=join(folder,'compiler');
    writeFileSync(compiler,stub);chmodSync(compiler,0o755);
    return run(compiler);
  } finally {rmSync(folder,{recursive:true,force:true});}
}

test('eleven canonical .atto source fixtures are concrete and unique',()=>{
  assert.equal(caseIds.length,11);
  assert.equal(new Set(caseIds).size,11);
  for(const id of caseIds){
    const source=readFileSync(join(fixtureDir,id+'.atto'),'utf8');
    assert.ok(source.includes('fnc main()'),id);
    assert.ok(source.includes('thread'),id);
  }
});
test('unconfigured compiler can never produce a parity pass',()=>{
  assert.equal(runLlvmThreadM0().status,'NOT_EXECUTED');
  assert.equal(runLlvmThreadM0().guestExecuted,false);
  withStub(compiler=>{
    assert.throws(()=>runLlvmThreadM0({compiler}),/UNVERIFIED_SOURCE_REVISION/);
    assert.throws(()=>runLlvmThreadM0({compiler,sourceHead:'x',sourceTree:tree}),/UNVERIFIED_SOURCE_REVISION/);
    assert.throws(()=>runLlvmThreadM0({compiler,sourceHead:head,sourceTree:tree,timeoutMs:50000}),/INVALID_TIMEOUT/);
  });
});
test('mock compiler acceptance tests harness only, never guest parity',()=>withStub(compiler=>{
  const r=runLlvmThreadM0({compiler,sourceHead:head,sourceTree:tree});
  assert.equal(r.status,'PASS_COMPILER_ADMISSION_ONLY');
  assert.equal(r.cases.length,11);
  assert.equal(r.guestExecuted,false);
  assert.equal(r.cases.filter(c=>c.diagnosticSeen).length,10);
  assert.equal(r.cases.filter(c=>c.llvmIRSeen).length,1);
}));
for(const mutation of ['artifact','hidden','source','reject-positive','accept-negative','wrong-diagnostic','stdout']){
  test('mutation '+mutation+' fails closed',()=>withStub(compiler=>{
    const r=runLlvmThreadM0({compiler,sourceHead:head,sourceTree:tree,extraEnv:{MUTATION:mutation}});
    assert.equal(r.status,'FAIL');
    assert.ok(r.cases.some(c=>!c.pass));
    assert.equal(r.guestExecuted,false);
  }));
}
