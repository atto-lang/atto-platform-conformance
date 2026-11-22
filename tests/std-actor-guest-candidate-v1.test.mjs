// Synthetic evidence/mutation tests only; no real Atto compiler runs here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readStdActorParity } from '../lib/std-actor-parity-v1.mjs';
import { classifyStdActorGuestCandidate } from '../lib/std-actor-guest-candidate-v1.mjs';
const manifest=readStdActorParity();
const head='a'.repeat(40),blob='b'.repeat(40),runId=12345;
const stepNames=[
  'Bind test execution to immutable source tree',
  'Compile actual native Atto namespace and relative import',
  'Build exact-head production Atto compiler',
  'Execute source contracts and compiled Wasm actor policy guests',
  'Assert exact-head Rust source tree remained unchanged'
];
function sample() {
  const run={id:runId,run_attempt:1,head_sha:head,repository:{full_name:'atto-lang/atto-source.rs'},status:'completed',conclusion:'success'};
  const job={id:23456,run_id:runId,runner_id:34567,status:'completed',conclusion:'success',
    steps:stepNames.map((name,i)=>({name,number:i+1,status:'completed',conclusion:'success'}))};
  const artifact={backend:'rs',repo:'atto-lang/atto-source.rs',sourceHead:head,compilerHead:head,
    sourceTree:blob,runId,runAttempt:1,toolchain:'rustc 1.85.1',target:'wasm32-node',
    sourceBlobs:{policy:blob,smoke:blob,boundaries:blob,namespacePositive:blob,future:blob},
    positive:{
      smoke:{fixture:'stdlib/actor/guest_smoke.atto',compilerExit:0,wasmValid:true,guestMainReturn:42,hostImports:[]},
      boundaries:{fixture:'stdlib/actor/guest_edges.atto',compilerExit:0,wasmValid:true,guestMainReturn:42,hostImports:[]},
      namespacePositive:{fixture:'stdlib/actor/guest_namespace_only.atto',compilerExit:0,wasmValid:true,guestMainReturn:42,hostImports:[]}
    },
    mutations:[['smoke',1],['smoke',18],['smoke',34],
      ['boundaries',100],['boundaries',166],['boundaries',232]]
      .map(([fixture,code])=>({fixture,injectedCode:code,compilerExit:0,wasmValid:true,guestMainReturn:code,hostImports:[]})),
    negative:manifest.guestTests.namespaceNegative.map(x=>({
      file:x.file,diagnostic:x.expectedDiagnostic,compilerExit:1,emittedArtifact:false
    }))
  };
  return {manifest,backend:'rs',expectedHead:head,requiredSteps:[...stepNames],run,job,artifact};
}
const assess=r=>classifyStdActorGuestCandidate(r);
function rejected(name,change){
  test('reject '+name,()=>{
    const x=sample();change(x);
    const result=assess(x);
    assert.equal(result.classification,'EVIDENCE_UNTRUSTED',name);
    assert.equal(result.policyGuestVerified,false);
    assert.equal(result.runtimeVerified,false);
  });
}
test('synthetic all-green can ONLY become external-review candidate, never PASS',()=>{
  const result=assess(sample());
  assert.equal(result.classification,'POLICY_EVIDENCE_CANDIDATE');
  assert.equal(result.policyGuestVerified,false);
  assert.equal(result.runtimeVerified,false);
});
test('bootstrap targets cannot be promoted with synthetic CI',()=>{
  const x=sample();x.backend='realtime';
  assert.equal(assess(x).classification,'NOT_IMPLEMENTED');
});
test('queued, missing, and zero-step jobs cannot become positive receipts',()=>{
  const missing=sample();delete missing.job;
  assert.equal(assess(missing).classification,'NOT_EXECUTED');
  const queued=sample();queued.run.status='queued';queued.job.status='queued';
  assert.equal(assess(queued).classification,'IN_PROGRESS');
  const empty=sample();empty.job.steps=[];empty.run.conclusion='failure';empty.job.conclusion='failure';
  assert.equal(assess(empty).classification,'RUNNER_ADMISSION_FAILURE');
});
test('failed executed job is actual failure, never a PASS',()=>{
  const x=sample();x.run.conclusion='failure';x.job.conclusion='failure';x.job.steps[0].conclusion='failure';
  assert.equal(assess(x).classification,'EXECUTION_FAILED');
});
rejected('wrong PR head',x=>x.expectedHead='c'.repeat(40));
rejected('wrong repository',x=>x.run.repository.full_name='somewhere/attacker');
rejected('untrusted run attempt',x=>x.artifact.runAttempt=2);
rejected('missing source root tree SHA',x=>x.artifact.sourceTree='not-a-sha');
rejected('mismatched compiler head',x=>x.artifact.compilerHead='c'.repeat(40));
rejected('compiler toolchain missing',x=>x.artifact.toolchain='');
rejected('missing source blob',x=>delete x.artifact.sourceBlobs.policy);
rejected('missing trusted backend step plan',x=>x.requiredSteps=[]);
rejected('duplicate step label',x=>x.job.steps.push({...x.job.steps[0],number:15}));
rejected('unexecuted required compiler build step',x=>x.job.steps[2].status='queued');
rejected('positive guest not valid Wasm',x=>x.artifact.positive.smoke.wasmValid=false);
rejected('positive guest returns wrong answer',x=>x.artifact.positive.boundaries.guestMainReturn=99);
rejected('positive guest gained ambient imports',x=>x.artifact.positive.smoke.hostImports=['env.secret']);
rejected('mutant count cut',x=>x.artifact.mutations.pop());
rejected('mutant returned constant 42',x=>x.artifact.mutations[1].guestMainReturn=42);
rejected('mutant did not execute',x=>x.artifact.mutations[0].wasmValid=false);
rejected('mutant added host import',x=>x.artifact.mutations[0].hostImports=['env.io']);
rejected('negative diagnostic weaker than contract',x=>x.artifact.negative[0].diagnostic='E_UNSUPPORTED');
rejected('negative compilation succeeded',x=>x.artifact.negative[0].compilerExit=0);
rejected('negative emitted executable artifact',x=>x.artifact.negative[0].emittedArtifact=true);
