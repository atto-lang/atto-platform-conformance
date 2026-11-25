import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTailCallReceipt } from '../bin/verify-tail-call-v1-receipt.mjs';

const h = 'a'.repeat(40), sha = 'b'.repeat(64), src = 'c'.repeat(64), exe = 'd'.repeat(64);
const manifest = {schemaVersion: 1, id: 'tail-calls-v1',
  backends: ['java', 'llvm', 'net', 'wasm', 'forge'], cases: [
  {id: 'deep', compile: 'accept', stdout: '0', tailDepth: 100000},
  {id: 'static', compile: 'reject', diagnosticClass: 'recursive-routine'},
  {id: 'dynamic', compile: 'accept', runtime: 'reject', diagnosticClass: 'recursive-routine'}
]};
const hashes = {deep: src, static: src, dynamic: src};
function valid() {
  return {schemaVersion:1, contractId:'tail-calls-v1', backend:'java', headSha:h,
    compilerSha256:sha, evidenceClass:'compiler-backed-guest', runId:42,
    runAttempt:1, jobId:17, runnerId:8,
    steps:[{name:'compile fixtures',status:'completed',conclusion:'success'},
           {name:'execute guest',status:'completed',conclusion:'success'}],
    cases:[
      {id:'deep',fixtureSha256:src,compilerSha256:sha,compile:'accepted',
       guest:'passed',stdout:'0',executedTailDepth:100000,
       stackPeakBytes:65536,stackBoundBytes:131072,executableSha256:exe},
      {id:'static',fixtureSha256:src,compilerSha256:sha,compile:'rejected',
       guest:'not-run',diagnosticClass:'recursive-routine'},
      {id:'dynamic',fixtureSha256:src,compilerSha256:sha,compile:'accepted',
       guest:'rejected',diagnosticClass:'recursive-routine',executableSha256:exe}
    ]};
}
const audit = candidate => verifyTailCallReceipt(candidate, manifest, h, hashes);
test('well-formed receipt stays untrusted until independent GitHub evidence', () => {
  assert.equal(audit(valid()).status, 'STRUCTURE_ONLY_UNTRUSTED');
});
const mutations = [
  ['zero steps', r => r.steps=[]],
  ['null steps', r => r.steps=null],
  ['no runner', r => r.runnerId=0],
  ['wrong head', r => r.headSha='0'.repeat(40)],
  ['wrong compiler hash', r => r.cases[0].compilerSha256='e'.repeat(64)],
  ['wrong source hash', r => r.cases[0].fixtureSha256='e'.repeat(64)],
  ['fake source-only', r => r.evidenceClass='source-only'],
  ['missing guest step', r => r.steps.pop()],
  ['failed compilation step', r => r.steps[0].conclusion='failure'],
  ['duplicate case', r => r.cases[2]=r.cases[0]],
  ['partial case coverage', r => r.cases.pop()],
  ['wrong stdout', r => r.cases[0].stdout='1'],
  ['missing stack proof', r => delete r.cases[0].stackPeakBytes],
  ['shallow execution', r => r.cases[0].executedTailDepth=10],
  ['dynamic rejected in compile phase', r => r.cases[2].compile='rejected'],
  ['static executed as guest', r => r.cases[1].guest='passed'],
  ['runtime rejection disguised as success', r => r.cases[2].guest='passed'],
  ['forged run id', r => r.runId=0]
];
for (const [label, mutate] of mutations) {
  test('rejects mutation: '+label, () => {
    const candidate=valid();mutate(candidate);
    assert.throws(() => audit(candidate));
  });
}
