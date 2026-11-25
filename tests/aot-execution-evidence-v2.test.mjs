import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAotExecutionEvidence as check} from '../lib/aot-execution-evidence-v2.mjs';
const commit='a'.repeat(40), tree='b'.repeat(40), digest='c'.repeat(64);
const expected={sourceCommit:commit,sourceTree:tree};
function good(backend='llvm',mode='full-aot') {
  return {
    schema:'atto.aot-execution-evidence.v2',backend,mode,status:'EXECUTED',
    trust:'trusted',isolation:'isolated',sourceCommit:commit,sourceTree:tree,
    sourceProgramSha256:digest,compilerSha256:digest,
    artifact:{kind:backend==='wasm'?'closed-guest-wasm-module':'linked-native-guest-executable',sha256:digest},
    closure:{macrosEliminated:true,importsResolved:true,genericsClosed:true,
      actorHandlersClosed:true,asyncContinuationsClosed:true,dispatchClosed:true,
      effectsChecked:true,ownershipChecked:true,runtimeCompilerAbsent:true},
    execution:{jobId:123,runnerName:'verified-job-externally',completedSteps:7,
      guestEntrypointRan:true,guestOutputSha256:digest,guestInterpreterUsed:false,
      runtimeGuestCompilerUsed:false,runtimeGuestJitUsed:false,aotBaselineRanWithoutJit:true}
  };
}
const classify=x=>check(x,expected);
for (const backend of ['java','llvm','net','wasm','cranelift']) {
  test(backend+': linked guest receipt is only structural and still needs independent review',()=>{
    const out=classify(good(backend));
    assert.equal(out.classification,'AOT_STRUCTURAL_REVIEW_REQUIRED');
    assert.equal(out.releaseQualified,false);
  });
}
test('hybrid needs a real JIT-off baseline even if optimization JIT ran',()=>{
  const x=good();x.mode='hybrid';x.execution.runtimeGuestJitUsed=true;
  assert.equal(classify(x).classification,'HYBRID_STRUCTURAL_REVIEW_REQUIRED');
  x.execution.aotBaselineRanWithoutJit=false;
  assert.equal(classify(x).classification,'INVALID');
});
test('JIT-only cannot masquerade as full AOT',()=>{
  const x=good();x.mode='jit';x.artifact.kind='jit-only-guest';
  x.execution.aotBaselineRanWithoutJit=false;
  x.closure.macrosEliminated=false;
  assert.equal(classify(x).classification,'JIT_ONLY_STRUCTURAL_REVIEW_REQUIRED');
  assert.equal(classify(x).releaseQualified,false);
});
for(const artifact of ['native-host-runtime','relocatable-guest-object','jit-only-guest','none']) {
  test('strict AOT rejects artifact substitution: '+artifact,()=>{
    const x=good();x.artifact.kind=artifact;
    assert.equal(classify(x).classification,'INVALID');
  });
}
test('Wasm runtime host cannot substitute for closed guest module',()=>{
  const x=good('wasm');x.artifact.kind='native-host-runtime';
  assert.equal(classify(x).classification,'INVALID');
});
for(const f of ['guestInterpreterUsed','runtimeGuestCompilerUsed','runtimeGuestJitUsed']) {
  test('strict AOT rejects runtime fallback: '+f,()=>{
    const x=good();x.execution[f]=true;
    assert.equal(classify(x).classification,'INVALID');
  });
}
for(const f of ['macrosEliminated','genericsClosed','actorHandlersClosed',
  'asyncContinuationsClosed','ownershipChecked','runtimeCompilerAbsent']) {
  test('full AOT denies missing semantic closure: '+f,()=>{
    const x=good();x.closure[f]=false;
    assert.equal(classify(x).classification,'INVALID');
  });
}
test('trust and actor isolation are independent dimensions',()=>{
  const x=good();x.trust='untrusted';x.isolation='shared';
  assert.equal(classify(x).classification,'AOT_STRUCTURAL_REVIEW_REQUIRED');
});
test('zero-step action failures are NOT_EXECUTED, not compiler test failures',()=>{
  const x=good();x.status='NOT_EXECUTED';x.artifact={kind:'none',sha256:null};
  x.execution.completedSteps=0;x.execution.jobId=null;x.execution.runnerName=null;
  x.execution.guestEntrypointRan=false;x.execution.guestOutputSha256=null;
  x.execution.aotBaselineRanWithoutJit=false;
  x.sourceProgramSha256=null;x.compilerSha256=null;
  assert.equal(classify(x).classification,'NOT_EXECUTED');
  x.status='FAILED';assert.equal(classify(x).classification,'INVALID');
});
test('unsupported does not imply verified parity',()=>{
  const x=good();x.status='UNSUPPORTED';x.artifact={kind:'none',sha256:null};
  x.execution.completedSteps=0;x.execution.jobId=null;x.execution.runnerName=null;
  x.execution.guestEntrypointRan=false;x.execution.guestOutputSha256=null;
  x.execution.aotBaselineRanWithoutJit=false;
  x.sourceProgramSha256=null;x.compilerSha256=null;
  assert.equal(classify(x).classification,'UNSUPPORTED');
  assert.equal(classify(x).releaseQualified,false);
});
test('compiler failure after real steps is distinguishable from runner failure',()=>{
  const x=good();x.status='FAILED';
  assert.equal(classify(x).classification,'EXECUTED_FAILED_NO_AOT_CREDIT');
});
test('trusted source mismatch denies any structural credit',()=>{
  assert.equal(check(good(),{sourceCommit:'d'.repeat(40),sourceTree:tree}).classification,'INVALID');
});
test('self-authored extra evidence fields and accessors fail closed',()=>{
  const x=good();x.releaseQualified=true;
  assert.equal(classify(x).classification,'INVALID');
  const y=good();Object.defineProperty(y.execution,'jobId',{enumerable:true,get(){throw Error('trap')}});
  assert.equal(classify(y).classification,'INVALID');
});
test('proxy traps fail closed, not as runtime errors',()=>{
  const x=new Proxy(good(),{getPrototypeOf(){throw Error('trap')}});
  assert.equal(classify(x).classification,'INVALID');
});
test('object shape mutation or shadowed members denied',()=>{
  assert.equal(classify(Object.create(good())).classification,'INVALID');
  const x=good();x.artifact.kind='linked-native-guest-executable';
  x.closure.poison=true;assert.equal(classify(x).classification,'INVALID');
});
test('no executed evidence if runner, steps or binary output is absent',()=>{
  for (const mutate of [
    x=>{x.execution.jobId=null},x=>{x.execution.runnerName=null},
    x=>{x.execution.completedSteps=0},x=>{x.execution.guestEntrypointRan=false},
    x=>{x.execution.guestOutputSha256=null},x=>{x.artifact.sha256=null}
  ]) {const x=good();mutate(x);assert.equal(classify(x).classification,'INVALID');}
});

test('structural review cannot be mistaken for successful release gating',()=>{
  for(const x of [good('llvm','full-aot'),good('wasm','hybrid'),good('java','jit')]) {
    if(x.mode==='jit') { x.artifact.kind='jit-only-guest'; }
    const out=classify(x);
    assert.equal(out.ok,false);
    assert.equal(out.releaseQualified,false);
    assert.equal(out.structurallyValid,true);
  }
});

test('unexecuted receipt rejects forged job and output witnesses',()=>{
  const base=good();base.status='NOT_EXECUTED';
  base.sourceProgramSha256=null;base.compilerSha256=null;
  base.artifact={kind:'none',sha256:null};
  base.execution={jobId:null,runnerName:null,completedSteps:0,
    guestEntrypointRan:false,guestOutputSha256:null,
    guestInterpreterUsed:false,runtimeGuestCompilerUsed:false,
    runtimeGuestJitUsed:false,aotBaselineRanWithoutJit:false};
  assert.equal(classify(base).classification,'NOT_EXECUTED');
  for(const mutation of [
    x=>{x.execution.jobId=99},x=>{x.execution.runnerName='runner'},
    x=>{x.execution.guestOutputSha256=digest},
    x=>{x.execution.aotBaselineRanWithoutJit=true},
    x=>{x.compilerSha256=digest},x=>{x.sourceProgramSha256=digest},
    x=>{x.execution.guestInterpreterUsed=true}
  ]) {
    const x=structuredClone(base);mutation(x);
    assert.equal(classify(x).classification,'INVALID');
  }
});
test('failed compiler requires admitted job and nonzero executed steps',()=>{
  const x=good();x.status='FAILED';
  assert.equal(classify(x).classification,'EXECUTED_FAILED_NO_AOT_CREDIT');
  for(const mutate of [y=>{y.execution.jobId=null},y=>{y.execution.runnerName=null},
    y=>{y.execution.completedSteps=0}]) {
    const y=structuredClone(x);mutate(y);
    assert.equal(classify(y).classification,'INVALID');
  }
});

test('receipt rejects hidden and symbol-keyed metadata at every record boundary', () => {
  for (const mutate of [
    x => Object.defineProperty(x, 'releaseQualified', {value:true}),
    x => {x[Symbol('hidden-proof')] = 'PASS';},
    x => Object.defineProperty(x.artifact, 'alternateDigest', {value:digest}),
    x => {x.artifact[Symbol.for('alternate-artifact')] = digest;},
    x => Object.defineProperty(x.closure, 'runtimeCodegenApproved', {value:true}),
    x => {x.closure[Symbol('codegen')] = true;},
    x => Object.defineProperty(x.execution, 'runnerVerified', {value:true}),
    x => {x.execution[Symbol('runner')] = 'fake';}
  ]) {
    const claim=good();
    mutate(claim);
    const result=classify(claim);
    assert.equal(result.classification, 'INVALID');
    assert.equal(result.releaseQualified, false);
  }
});

test('required receipt fields must be enumerable own data, never hidden getters', () => {
  for (const [section,key] of [
    [null,'sourceCommit'],['artifact','kind'],['closure','dispatchClosed'],
    ['execution','jobId']
  ]) {
    const claim=good();
    const target=section===null?claim:claim[section];
    const descriptor=Object.getOwnPropertyDescriptor(target,key);
    Object.defineProperty(target,key,{...descriptor,enumerable:false});
    assert.equal(classify(claim).classification,'INVALID',key);
  }
  const claim=good();
  Object.defineProperty(claim.closure,'ownershipChecked',{
    enumerable:true,get(){throw Error('untrusted accessor');}
  });
  assert.equal(classify(claim).classification,'INVALID');
});

test('runner label must not be a blank, control-character or multiline provenance claim', () => {
  for(const label of ['', ' ', ' runner', 'runner ', '\u0000', 'job\nother', 'runner\rverified', 'runner\u007f']) {
    const claim=good();
    claim.execution.runnerName=label;
    assert.equal(classify(claim).classification,'INVALID',JSON.stringify(label));
  }
});

test('frozen JSON-shaped receipt remains structurally reviewable', () => {
  const claim=good();
  Object.freeze(claim.artifact);
  Object.freeze(claim.closure);
  Object.freeze(claim.execution);
  Object.freeze(claim);
  assert.equal(classify(claim).classification,'AOT_STRUCTURAL_REVIEW_REQUIRED');
  assert.equal(classify(claim).releaseQualified,false);
});
