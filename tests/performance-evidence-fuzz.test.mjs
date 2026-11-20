import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePerformanceEvidence} from '../src/performance-evidence.mjs';

// All input reports are deliberately synthetic; these tests certify the
// validator's rejection behavior, not real execution or CI provenance.
function synthetic() {
  const hash=(c,n)=>c.repeat(n);
  return {schemaVersion:1,status:'MEASURED',family:'software',backend:'llvm',
    mode:'baseline-O2',sourceSha:hash('a',40),compilerSha256:hash('b',64),
    fixtureSha256:hash('c',64),toolchain:{name:'clang',version:'18.1.0'},
    environment:{target:'x86_64-linux',cpu:'fixture',clockPolicy:'pinned'},
    kind:'latency',unit:'ns',samples:[11,12,10,9,13],correctness:'PASS',
    evidence:[{stage:'correctness',sha256:hash('d',64),locator:'ci/correctness.json'},
      {stage:'benchmark',sha256:hash('e',64),locator:'ci/benchmark.json'}]};
}
test('10k deterministic malformed locator variants fail closed',()=>{
  let seed=0xfeedface;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  const good=['ci','raw-results','report_2026-10-18.json','metric.json'];
  const bad=['..','.','%2e','%2f','C:','\\','?query','#fragment',''];
  let rejected=0;
  for(let i=0;i<10000;i++){
    const parts=[...good];
    const index=random()%parts.length;
    parts[index]=bad[random()%bad.length];
    const r=synthetic();
    r.evidence[0].locator=parts.join('/');
    assert.throws(()=>validatePerformanceEvidence(r),/invalid evidence reference/);
    rejected++;
  }
  assert.equal(rejected,10000);
});
test('fuzzed numeric observations never certify provenance',()=>{
  let seed=0x7ec7babe;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let i=0;i<5000;i++){
    const r=synthetic();
    r.samples=Array.from({length:5},()=>random()%10000);
    const verified=validatePerformanceEvidence(r);
    assert.equal(verified.structurally_valid,true);
    assert.equal(verified.performance_claim_certified,false);
    assert.equal(verified.benchmark_execution_authenticated,false);
    assert.equal(verified.provenance_authenticated,false);
  }
});
