import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gitBlobSha, runNegativeGpuCompilerGate as run} from '../src/gpu-native-compiler-negative-gate.mjs';

const head = 'a'.repeat(40), tree = 'b'.repeat(40);
const control = Buffer.from('pub fnc launch(int x): int { return x; }\npub fnc main(): int { return launch(7); }\n');
function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'atto-gpu-runner-tests-'));
  const fixtureDir = path.join(root, 'fixtures/gpu-launch-v1');
  mkdirSync(fixtureDir, {recursive:true});
  const entries = [
    ['bad-type', 'GPU-LAUNCH-002'],
    ['bad-grid', 'GPU-LAUNCH-003']
  ].map(([id,diagnostic]) => {
    const pathName = `fixtures/gpu-launch-v1/${id}.atto`;
    const source = Buffer.from(`// ${diagnostic}\nlaunch saxpy() on gpu(device) {bad: 1}\n`);
    writeFileSync(path.join(root,pathName), source);
    return {id, expectation:'negative', path:pathName,
      expectedDiagnostic:diagnostic, gitBlobSha:gitBlobSha(source), observedResult:'NOT_EXECUTED'};
  });
  const compiler = path.join(root, 'fake-compiler.cjs');
  writeFileSync(compiler, `#!/usr/bin/env node
const fs = require('node:fs');
const mode=process.argv[2] || 'correct';
const file=process.argv[process.argv.length-1];
const source=fs.readFileSync(file,'utf8');
if (source.includes('pub fnc launch')) process.exit(mode==='bad-control'?1:0);
if (mode==='success-on-negative') process.exit(0);
if (mode==='artifact') fs.writeFileSync('bad.ll','fake artifact');
console.error((mode==='wrong-code'?'GPU-LAUNCH-008':source.match(/GPU-LAUNCH-\\d{3}/)?.[0])+': no implicit CPU fallback');
process.exit(1);
`,{mode:0o700});
  chmodSync(compiler,0o700);
  const opts = {sourceRoot:root, manifest:{schema:'attolang.gpu-explicit-launch-corpus/1', cases:entries},
    controlSource:control, backend:'llvm', compilerArgv:[compiler],sourceHead:head, sourceTree:tree};
  return {root, entries, opts};
}
function withFixture(f) {
  const fx=setup();
  try {f(fx);} finally {rmSync(fx.root,{recursive:true,force:true});}
}
test('positive scalar control and both negative compiler paths actually execute without GPU promotion',()=>withFixture(({opts})=>{
  const receipt=run(opts);
  assert.equal(receipt.negativeCount,2);
  assert.equal(receipt.scalarControlCompiled,true);
  assert.equal(receipt.compilerGuestExecuted,false);
  assert.equal(receipt.physicalGpuExecuted,false);
  assert.equal(receipt.evidenceClass,'COMPILER_PROCESS_NEGATIVE_ONLY_UNATTESTED');
  assert.equal(receipt.positives,'NOT_EXECUTED');
  assert.deepEqual(receipt.negatives.map(x=>x.diagnostic),['GPU-LAUNCH-002','GPU-LAUNCH-003']);
  assert.match(receipt.compilerSha256,/^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(receipt));
}));
test('wrong diagnostic or successful compilation of a negative are rejected',()=>withFixture(({opts})=>{
  assert.throws(()=>run({...opts,compilerArgv:[opts.compilerArgv[0],'wrong-code']}),/missing required diagnostic/);
  assert.throws(()=>run({...opts,compilerArgv:[opts.compilerArgv[0],'success-on-negative']}),/unsupported GPU source was compiled/);
}));
test('compiler-emitted artifacts, failed scalar controls and source changes are rejected',()=>withFixture(({opts,root,entries})=>{
  assert.throws(()=>run({...opts,compilerArgv:[opts.compilerArgv[0],'artifact']}),/created an executable or other artifact/);
  assert.throws(()=>run({...opts,compilerArgv:[opts.compilerArgv[0],'bad-control']}),/scalar compiler control/);
  writeFileSync(path.join(root,entries[0].path),'// modified source');
  assert.throws(()=>run(opts),/fixture modified/);
}));
test('malformed identities, unknown backends and fabricated evidence cannot run',()=>withFixture(({opts})=>{
  assert.throws(()=>run({...opts,sourceTree:''}),/head\/tree/);
  assert.throws(()=>run({...opts,backend:'cuda-cpu-fallback'}),/backend/);
  assert.throws(()=>run({...opts,compilerArgv:['relative'] }),/absolute executable path/);
  assert.throws(()=>run({...opts,controlSource:Buffer.alloc(0)}),/scalar compiler control/);
  assert.throws(()=>run({...opts,manifest:{schema:'wrong',cases:[]}}),/contract corpus/);
}));
test('actual Git blob computation uses blob header rather than file-content SHA',()=>{
  const payload=Buffer.from('GPU-LAUNCH-008\n');
  assert.notEqual(gitBlobSha(payload),createHash('sha1').update(payload).digest('hex'));
});
