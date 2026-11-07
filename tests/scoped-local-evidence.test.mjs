import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReceipt, evaluateBatch } from '../bin/verify-scoped-local-evidence.mjs';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const contract = JSON.parse(readFileSync(new URL('../contracts/scoped-locals-v1.json',import.meta.url)));
const hash40 = 'a'.repeat(40), hash256 = 'b'.repeat(64);
const repos = {
  java:'oreslang-source.java',llvm:'oreslang-source.llvm',net:'oreslang-source.net',
  wasm:'oreslang-source.wasm',forge:'oreslang-source.forge',
};
function receipt(backend='llvm') {
  return {
    schema:'attolang.scoped-local-evidence/1',backend,
    repository:'ores-truffle-oreslang/'+repos[backend],
    headSha:hash40,rootTreeSha:'c'.repeat(40),checkedOutSha:hash40,
    compiler:{sourceHeadSha:hash40,binarySha256:hash256,toolchain:'exact-compiler-receipt'},
    workflow:{runId:1,attempt:1,headSha:hash40,jobs:[{
      id:2,runnerId:3,conclusion:'success',steps:[{name:'compiler guest',conclusion:'success'}]
    }]},
    scenarios:contract.scenarios.map(s=>({id:s.id,kind:s.kind,checks:[
      ...(s.kind==='compile'||s.kind==='compile-and-runtime' ? [{
        phase:'compile-negative',executed:true,assertions:1,logSha256:hash256,
        fixtureSha256:hash256,exitCode:1,diagnostic:'EXPECTED_STATIC_DIAGNOSTIC',
        stdoutBytes:0,artifacts:[]
      }]:[]),
      ...(s.kind!=='compile' ? [
        {phase:'compile-positive',executed:true,assertions:1,logSha256:hash256,
          fixtureSha256:hash256,exitCode:0,artifactSha256:hash256},
        {phase:'guest-run',executed:true,assertions:1,logSha256:hash256,
          fixtureSha256:hash256,exitCode:0,artifactSha256:hash256}
      ]:[])
    ]})),
  };
}
function verdict(mutate) {const r=receipt();mutate(r);return evaluateReceipt(r,contract);}

test('all canonical scenarios remain untrusted even if self-reported complete',()=>{
  const v=evaluateReceipt(receipt(),contract);
  assert.equal(v.covered,contract.scenarios.length);
  assert.equal(v.status,'CANDIDATE_FOR_INDEPENDENT_REVIEW');
  assert.equal(v.parityVerified,false);
});

test('zero-step or unassigned runner is runner-admission failure, never guest pass',()=>{
  for (const changes of [{steps:[]},{steps:null},{runnerId:0}]) {
    const v=verdict(r=>Object.assign(r.workflow.jobs[0],changes));
    assert.equal(v.status,'RUNNER_ADMISSION_FAILURE');
    assert.equal(v.parityVerified,false);
  }
});

test('synthetic exact heads, trees and compiler identities cannot be omitted or swapped',()=>{
  for (const field of ['headSha','rootTreeSha','checkedOutSha'])
    assert.ok(verdict(r=>{r[field]='bad';}).errors.some(s=>s.startsWith('MISSING_GIT_ID')));
  assert.ok(verdict(r=>{r.checkedOutSha='d'.repeat(40);}).errors.includes('NOT_EXACT_HEAD'));
  assert.ok(verdict(r=>{r.compiler.sourceHeadSha='e'.repeat(40);}).errors.includes('UNBOUND_COMPILER'));
  assert.ok(verdict(r=>{r.repository='other/private';}).errors.includes('REPOSITORY_MISMATCH'));
  assert.ok(verdict(r=>{r.workflow.headSha='f'.repeat(40);}).errors.includes('WORKFLOW_PROVENANCE'));
});

test('host-only, missing guest, and a forged pass all fail to prove runtime',()=>{
  assert.ok(verdict(r=>{r.scenarios[0].checks=[];}).errors.some(e=>e.startsWith('NO_EXECUTED_CHECKS')));
  const i=contract.scenarios.findIndex(s=>s.kind==='guest-runtime');
  assert.ok(verdict(r=>{r.scenarios[i].checks.pop();}).errors.some(e=>e.startsWith('MISSING_COMPILED_GUEST')));
  assert.ok(verdict(r=>{r.scenarios[i].checks[0].executed=false;}).errors.some(e=>e.startsWith('NO_EXECUTION_RECEIPT')));
});

test('compile-negative must be a semantic exit 1, with diagnostic and no IR/artifacts',()=>{
  const i=contract.scenarios.findIndex(s=>s.kind==='compile');
  assert.notEqual(i,-1);
  const variants=[{exitCode:2},{exitCode:127},{stdoutBytes:4},{diagnostic:''},{artifacts:['out.ll']}];
  for(const x of variants) {
    const v=verdict(r=>Object.assign(r.scenarios[i].checks[0],x));
    assert.ok(v.errors.some(e=>e.startsWith('INVALID_SEMANTIC_REJECTION')),JSON.stringify(x));
  }
});

test('duplicate, missing, or unknown scenario IDs fail closed',()=>{
  assert.ok(verdict(r=>r.scenarios.push(structuredClone(r.scenarios[0])))
    .errors.some(e=>e.startsWith('DUPLICATE_SCENARIO')));
  assert.ok(verdict(r=>r.scenarios.pop())
    .errors.some(e=>e.startsWith('MISSING_SCENARIO')));
  assert.ok(verdict(r=>r.scenarios[0].id='fake')
    .errors.some(e=>e.startsWith('UNKNOWN_SCENARIO')));
});

test('five target reports remain unverified candidates; duplicated backend rejected',()=>{
  const all=Object.keys(repos).map(receipt);
  const v=evaluateBatch(all,contract);
  assert.equal(v.status,'FIVE_BACKEND_CANDIDATE_FOR_INDEPENDENT_REVIEW');
  assert.equal(v.parityVerified,false);
  const bad=evaluateBatch([receipt('llvm'),receipt('llvm')],contract);
  assert.equal(bad.status,'UNVERIFIED_INCOMPLETE');
  assert.ok(bad.results[1].errors.includes('DUPLICATE_BACKEND'));
});

test('source-free contract names all expected domains and targets',()=>{
  assert.deepEqual(Object.keys(contract.scopes),['actor','thread','request','task']);
  assert.equal(contract.scopes.task.inheritance.includes('none by default'),true);
  assert.equal(contract.promotion.zeroStepWorkflowRunCountsAsEvidence,false);
  assert.equal(contract.promotion.aotArtifactExecutionRequired,true);
});

test('CLI rejects symlinks, directories and oversized evidence files before parsing',()=>{
  const dir=mkdtempSync(join(tmpdir(),'atto-scoped-evidence-'));
  try {
    const bin=fileURLToPath(new URL('../bin/verify-scoped-local-evidence.mjs',import.meta.url));
    const ordinary=join(dir,'ordinary.json');
    const oversized=join(dir,'oversized.json');
    const alias=join(dir,'alias.json');
    writeFileSync(ordinary,'{"test":"fixture"}');
    writeFileSync(oversized,'x'.repeat(2*1024*1024+1));
    const paths=[dir,oversized];
    if(process.platform!=='win32'){
      symlinkSync(ordinary,alias);
      paths.push(alias);
    }
    for(const path of paths){
      const run=spawnSync(process.execPath,[bin,path],{encoding:'utf8'});
      assert.equal(run.status,2,path+': malformed input was not rejected');
      assert.match(run.stderr,/SCOPED_LOCAL_EVIDENCE_INVALID:/);
    }
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
