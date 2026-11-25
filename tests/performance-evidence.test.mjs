import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePerformanceEvidence} from '../src/performance-evidence.mjs';
const A='a'.repeat(40), B='b'.repeat(64), C='c'.repeat(64), D='d'.repeat(64);
const evidence=(stage)=>({stage,sha256:D,locator:'ci/raw-artifacts/results.json'});
const report=(status='UNCONFIGURED')=>({schemaVersion:1,status,family:'software',backend:'llvm',
  mode:'baseline-O2',sourceSha:A,compilerSha256:B,fixtureSha256:C,
  toolchain:{name:'clang',version:'unconfigured'},
  environment:{target:'unknown',cpu:'unknown',clockPolicy:'unknown'},
  kind:'latency',unit:'ns',samples:[],correctness:'UNVERIFIED',evidence:[]});
const ready=(status='MEASURED')=>{const r=report(status);r.toolchain.version='18.1.0';
  r.environment={target:'x86_64-linux',cpu:'test-cpu',clockPolicy:'pinned'};
  r.correctness='PASS';r.samples=[1,2,3,4,5];
  r.evidence=[evidence('correctness'),evidence('benchmark')];return r;};
const denies=(label,mutate)=>test(label,()=>{const r=ready();mutate(r);
  assert.throws(()=>validatePerformanceEvidence(r),/untrusted performance evidence:/);});

test('unconfigured selftest stays unverified',()=>{
  const v=validatePerformanceEvidence(report());
  assert.equal(v.structurally_valid,true);
  assert.equal(v.performance_claim_certified,false);
  assert.equal(v.provenance_authenticated,false);
});
test('structurally complete measured report never authenticates its own provenance',()=>{
  const v=validatePerformanceEvidence(ready());
  assert.equal(v.sample_count,5);
  assert.equal(v.benchmark_execution_authenticated,false);
  assert.equal(v.performance_claim_certified,false);
});
denies('inflated PASS status',r=>r.status='PASS');
denies('other backend family',r=>r.family='asic');
denies('unknown metric',r=>r.kind='made-up');
denies('foreign units',r=>r.unit='MHz');
denies('missing source commit',r=>r.sourceSha='0'.repeat(40));
denies('missing compiler identity',r=>r.compilerSha256='');
denies('missing fixture identity',r=>r.fixtureSha256='0'.repeat(64));
denies('missing correctness',r=>r.correctness='UNVERIFIED');
denies('missing raw artifacts',r=>r.evidence=[]);
denies('missing correctness artifact',r=>r.evidence=[evidence('benchmark')]);
denies('fewer independent samples',r=>r.samples=[1,2,3]);
denies('invalid sample',r=>r.samples[0]=Infinity);
denies('negative latency',r=>r.samples[0]=-1);
denies('unknown clock policy',r=>r.environment.clockPolicy='unknown');
denies('unexpected self-attestation',r=>r.authenticated=true);
denies('oversized evidence list',r=>r.evidence=Array.from({length:33},()=>evidence('benchmark')));
denies('unverified status with readings',r=>r.status='UNSUPPORTED');
denies('impossible status/method',r=>r.status='PLACE_ROUTE_VERIFIED');
denies('software synthesis claim',r=>r.status='SYNTH_ONLY');
test('FPGA P&R requires real artifact reference',()=>{
  const r=ready('PLACE_ROUTE_VERIFIED');r.family='fpga';r.backend='fpga';r.kind='ii';r.unit='cycles';
  r.samples=[1];r.evidence=[evidence('correctness'),evidence('place-route')];
  assert.equal(validatePerformanceEvidence(r).performance_claim_certified,false);
  r.evidence.pop();assert.throws(()=>validatePerformanceEvidence(r));
});
test('ASIC silicon cannot be certified MEASURED without a silicon evidence protocol',()=>{
  const r=ready();r.family='asic';r.backend='asic';r.kind='power';r.unit='mW';
  r.evidence.push(evidence('power-model'));
  assert.throws(()=>validatePerformanceEvidence(r),/ASIC measured silicon/);
});
test('ASIC mapped power requires both synthesis and a power model',()=>{
  const r=ready('SYNTH_ONLY');r.family='asic';r.backend='asic';r.kind='power';
  r.unit='mW';r.samples=[1];r.evidence=[evidence('correctness'),evidence('synthesis')];
  assert.throws(()=>validatePerformanceEvidence(r),/power-model/);
  r.evidence.push(evidence('power-model'));
  assert.equal(validatePerformanceEvidence(r).performance_claim_certified,false);
});
test('software MEASURED may not claim a benchmark using only board evidence',()=>{
  const r=ready();r.evidence=[evidence('correctness'),evidence('board')];
  assert.throws(()=>validatePerformanceEvidence(r),/software measurement requires benchmark/);
});
test('FPGA MEASURED requires placement, real board and benchmark artifacts',()=>{
  const r=ready();r.family='fpga';r.backend='fpga';r.kind='fmax';r.unit='MHz';
  r.evidence=[evidence('correctness'),evidence('benchmark')];
  assert.throws(()=>validatePerformanceEvidence(r),/FPGA measurement/);
  r.evidence.push(evidence('place-route'));
  assert.throws(()=>validatePerformanceEvidence(r),/FPGA measurement/);
  r.evidence.push(evidence('board'));
  assert.equal(validatePerformanceEvidence(r).performance_claim_certified,false);
});
test('CLI cannot turn structural validation into a green release gate',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ores-perf-')); const file=join(dir,'result.json');
  const cli=fileURLToPath(new URL('../bin/check-performance-evidence.mjs',import.meta.url));
  try {
    writeFileSync(file,JSON.stringify(ready()));
    const run=(p,...args)=>spawnSync(process.execPath,[cli,p,...args],{encoding:'utf8'});
    assert.equal(run(file).status,3);
    const okay=run(file,'--structural-only');
    assert.equal(okay.status,0,okay.stderr);
    assert.match(okay.stdout,/"performance_claim_certified": false/);
    const link=join(dir,'link.json');symlinkSync(file,link);
    assert.equal(run(link,'--structural-only').status,1);
    writeFileSync(file,JSON.stringify({...ready(),status:'PASS'}));
    assert.equal(run(file,'--structural-only').status,1);
    writeFileSync(file,Buffer.from([0x7b,0xff,0x7d])); // malformed UTF-8 JSON bytes
    assert.equal(run(file,'--structural-only').status,1);
    writeFileSync(file,' '.repeat(128*1024+1));
    assert.equal(run(file,'--structural-only').status,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('artifact locators are relative opaque paths, never URI or traversal capabilities',()=>{
  const invalid=['../secret','artifacts/../secret','artifacts/./entry',
    '/etc/passwd','C:\\windows\\secret','https://example.com/log.txt',
    'artifacts//entry','artifacts/%2e%2e/secret','artifacts\\secret',
    'artifacts/result#fragment','artifacts/result?query','artifacts/entry:foo',
    'artifacts/évidence','artifacts/trailing/'];
  for(const locator of invalid) {
    const r=ready();r.evidence[0].locator=locator;
    assert.throws(()=>validatePerformanceEvidence(r),/invalid evidence reference/,locator);
  }
  const r=ready();r.evidence[0].locator='ci/raw-artifacts/results_2026.10-18.json';
  assert.equal(validatePerformanceEvidence(r).performance_claim_certified,false);
});
