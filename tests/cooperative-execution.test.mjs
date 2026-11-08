import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ActorMeter,MeterFailure,MAX_U64,verifyMeteredCycles,verifyMeteredCalls,admitUntrustedForeignCall} from '../reference/cooperative-meter.mjs';
import {validateManifest,validateReceipt,EvidenceError} from '../bin/verify_cooperative_execution.mjs';
const m=JSON.parse(fs.readFileSync(new URL('../contracts/cooperative-execution-v1.json',import.meta.url)));
const meter=(opts={})=>{const a=new ActorMeter({fuel:100000n,wallBudget:100000n,cpuBudget:100000n,...opts});a.enterOrResume(0n);return a;};
const denied=(fn,code)=>assert.throws(fn,e=>e instanceof MeterFailure&&e.code===code);
const rejected=(r,code)=>assert.throws(()=>validateReceipt(r,m),e=>e instanceof EvidenceError&&e.message===code);
const receipt=(caseId='hot-path-127-no-slow-poll',backend='llvm')=>({
  backend,case_id:caseId,status:'passed',guest_executed:true,evidence_kind:'compiled-guest',
  head_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),artifact_sha256:'c'.repeat(64),
  fixture_sha256:'d'.repeat(64),workflow_run_id:123,workflow_attempt:1,job_id:456,
  workflow_url:'https://github.com/atto-lang/atto-source.'+backend+'/actions/runs/123',
  executed_job_steps:5,command:'./compile fixture.atto && ./guest',
  observed:m.cases.find(x=>x.id===caseId).expect,exit_code:0
});
test('17 cases, six unexecuted backend baselines',()=>assert.equal(validateManifest(m).size,17));
test('no fuel, CPU, or backedge may execute before first actor admission',()=>{
  const a=new ActorMeter({fuel:20n,wallBudget:100n,cpuBudget:100n});
  denied(()=>a.chargeBlock(1n),'METER_NOT_ADMITTED');
  denied(()=>a.chargeCpu(1n),'METER_NOT_ADMITTED');
  denied(()=>a.backedge(1n,0n),'METER_NOT_ADMITTED');
  denied(()=>a.enterCritical(),'METER_NOT_ADMITTED');
  assert.equal(a.fuel,20n);
  a.enterOrResume(0n);a.backedge(1n,0n);assert.equal(a.fuel,19n);
});
test('zero wall quota cannot run even one backedge on first admission',()=>{
  const a=new ActorMeter({fuel:20n,wallBudget:0n,cpuBudget:100n});
  denied(()=>a.enterOrResume(0n),'WALL_EXHAUSTED');assert.equal(a.closed,true);
});
test('zero CPU quota cannot run even one backedge on first admission',()=>{
  const a=new ActorMeter({fuel:20n,wallBudget:100n,cpuBudget:0n});
  denied(()=>a.enterOrResume(0n),'CPU_EXHAUSTED');assert.equal(a.closed,true);
});
test('127 fast-path backedges do not call the scheduler',()=>{
  const a=meter();for(let i=0;i<127;i++)assert.equal(a.backedge(1n,0n),false);
  assert.equal(a.slowPolls,0n);assert.equal(a.backedge(1n,0n),true);
  assert.equal(a.slowPolls,1n);assert.equal(a.handoffs,0n);
});
for(const interval of [32,64,128,256,512]){
  test('precise mask-amortized cadence '+interval,()=>{
    const a=meter({interval});
    for(let i=0;i<8192;i++)a.backedge(1n,0n);
    assert.equal(a.slowPolls,BigInt(8192/interval));
  });
}
test('trusted handoffs happen every 128th backedge',()=>{
  const a=meter({mode:'trusted'});for(let i=0;i<1024;i++)a.backedge(1n,0n);
  assert.equal(a.handoffs,8n);
});
for(const interval of [0,1,31,100,127,129,513,1024,-1,2.5]){
  test('non-power-of-two/unsafe interval rejected '+interval,()=>
    denied(()=>meter({interval}),'INVALID_INTERVAL'));
}
test('wrap-around of unsigned u64 preserves mask poll',()=>{
  const a=meter({counter:MAX_U64});assert.equal(a.backedge(1n,0n),true);
  assert.equal(a.counter,0n);assert.equal(a.slowPolls,1n);
});
test('fuel denies at exact boundary and saturates',()=>{
  const a=meter({fuel:5n});a.backedge(4n,0n);
  denied(()=>a.backedge(1n,0n),'FUEL_EXHAUSTED');assert.equal(a.fuel,0n);
});
test('no refueling after thousands of failed checks',()=>{
  const a=meter({fuel:1n});denied(()=>a.chargeBlock(1n),'FUEL_EXHAUSTED');
  for(let i=0;i<4096;i++)denied(()=>a.chargeBlock(1n),'ACTOR_CLOSED');
  assert.equal(a.fuel,0n);
});
test('negative, zero, and overflowing weights cannot meter',()=>{
  const a=meter();
  denied(()=>a.chargeBlock(-1n),'INVALID_BLOCK_COST');
  denied(()=>a.chargeBlock(0n),'ZERO_COST');
  denied(()=>a.chargeBlock(MAX_U64+1n),'INVALID_BLOCK_COST');
  assert.equal(a.fuel,100000n);
});
test('long straight-line charged block denies before effects',()=>{
  const a=meter({fuel:100n});denied(()=>a.chargeBlock(1000n),'FUEL_EXHAUSTED');
  assert.equal(a.slowPolls,0n);
});
test('nested inner and outer backedges both charged',()=>{
  const a=meter();for(let o=0;o<8;o++){for(let i=0;i<16;i++)a.backedge(2n,0n);a.backedge(3n,0n);}
  assert.equal(a.fuel,100000n-BigInt(8*(16*2+3)));
});
test('cancel serviced by next periodic poll',()=>{
  const a=meter();a.requestCancellation();
  for(let i=0;i<127;i++)a.backedge(1n,0n);
  denied(()=>a.backedge(1n,0n),'CANCELLED');
});
test('cancel enforced immediately on resume',()=>{
  const a=meter();a.requestCancellation();denied(()=>a.enterOrResume(0n),'CANCELLED');
});
test('await and dispatch cannot refill logical budget',()=>{
  const a=meter({fuel:300n});
  for(let i=0;i<128;i++)a.backedge(1n,0n);
  a.enterOrResume(1n);assert.equal(a.fuel,172n);assert.equal(a.counter,0n);
  for(let i=0;i<128;i++)a.backedge(1n,1n);
  denied(()=>a.backedge(44n,1n),'FUEL_EXHAUSTED');
});
test('logical wall deadline fails at exact equality',()=>{
  const a=meter({wallBudget:7n});a.enterOrResume(6n);
  denied(()=>a.enterOrResume(7n),'WALL_EXHAUSTED');
});
test('monotonic clock rollback denied across resume',()=>{
  const a=meter();a.enterOrResume(20n);denied(()=>a.enterOrResume(19n),'CLOCK_ROLLBACK');
});
test('carrier migration conserves CPU debt',()=>{
  const a=meter({cpuBudget:10n});a.chargeCpu(6n);a.enterOrResume(0n);
  denied(()=>a.chargeCpu(4n),'CPU_EXHAUSTED');
});
test('CPU budget saturates even at u64 boundary',()=>{
  const a=meter({cpuBudget:MAX_U64});
  denied(()=>a.chargeCpu(MAX_U64),'CPU_EXHAUSTED');assert.equal(a.cpu,MAX_U64);
});
test('untrusted actors do not suspend unsafe stacks',()=>{
  const a=meter();for(let i=0;i<512;i++)a.backedge(1n,0n);
  assert.equal(a.handoffs,0n);
  denied(()=>a.explicitCooperate(0n),'UNTRUSTED_COOPERATE_DISABLED');
});
test('nested trusted critical defers handoff until final release',()=>{
  const a=meter({mode:'trusted'});a.enterCritical();a.enterCritical();
  for(let i=0;i<128;i++)a.backedge(1n,0n);
  assert.equal(a.handoffs,0n);assert.equal(a.deferred,true);
  a.exitCritical();assert.equal(a.handoffs,0n);
  a.exitCritical();assert.equal(a.handoffs,1n);
});
test('critical guard never defers quota exhaustion',()=>{
  const a=meter({mode:'trusted',fuel:2n});a.enterCritical();a.backedge(1n,0n);
  denied(()=>a.backedge(1n,0n),'FUEL_EXHAUSTED');
});
test('explicit cooperate inside critical is refused',()=>{
  const a=meter({mode:'trusted'});a.enterCritical();
  denied(()=>a.explicitCooperate(0n),'CRITICAL_SUSPENSION_DENIED');
});
test('two actors have independent fuel and no quota reuse',()=>{
  const a=meter({fuel:5n}),b=meter({fuel:10n});
  a.backedge(1n,0n);b.backedge(1n,0n);
  denied(()=>a.backedge(4n,0n),'FUEL_EXHAUSTED');
  assert.equal(b.fuel,9n);assert.equal(b.closed,false);
});
test('unguarded cyclic CFG rejected',()=>assert.equal(verifyMeteredCycles([
  {id:0,charged:false,next:[1]},{id:1,charged:false,next:[1]}
],0),false));
test('a positive-charge loop survives static CFG admission',()=>assert.equal(verifyMeteredCycles([
  {id:0,charged:false,next:[1]},{id:1,charged:true,weight:1,next:[2]},
  {id:2,charged:false,next:[1,3]},{id:3,charged:false,next:[]}
],0),true));
test('continue edge bypassing charge rejected',()=>assert.equal(verifyMeteredCycles([
  {id:0,charged:false,next:[1]},{id:1,charged:false,next:[2,3]},
  {id:2,charged:true,weight:1,next:[1]},{id:3,charged:false,next:[1]}
],0),false));
test('zero cost checkpoint cannot legalize loop',()=>
  denied(()=>verifyMeteredCycles([{id:0,charged:true,weight:0,next:[0]}],0),'INVALID_CFG'));
test('unreachable loop does not falsify reachable proof',()=>assert.equal(verifyMeteredCycles([
  {id:0,charged:false,next:[]},{id:1,charged:false,next:[1]}
],0),true));
test('missing CFG edge fails closed',()=>
  denied(()=>verifyMeteredCycles([{id:0,charged:false,next:[1]}],0),'INVALID_CFG'));
test('self recursion without a charge rejected',()=>assert.equal(verifyMeteredCalls([
  {name:'f',charged:false,calls:['f']}
]),false));
test('mutual recursion without a charge rejected',()=>assert.equal(verifyMeteredCalls([
  {name:'f',charged:false,calls:['g']},{name:'g',charged:false,calls:['f']}
]),false));
test('charged call SCC is allowed but still needs stack bound',()=>assert.equal(verifyMeteredCalls([
  {name:'f',charged:false,calls:['g']},{name:'g',charged:true,weight:1,calls:['f']}
]),true));
test('zero cost recursive charge is invalid',()=>
  denied(()=>verifyMeteredCalls([{name:'f',charged:true,weight:0,calls:['f']}]),'INVALID_CALL_GRAPH'));
test('unknown call target denied',()=>
  denied(()=>verifyMeteredCalls([{name:'f',charged:true,weight:1,calls:['native_unknown']}]),'INVALID_CALL_GRAPH'));
test('foreign calls require an independently killable boundary',()=>{
  assert.equal(admitUntrustedForeignCall({interruptible:false,isolation:'thread',deadlineEnforced:true}),false);
  assert.equal(admitUntrustedForeignCall({interruptible:true,isolation:'thread',deadlineEnforced:true}),false);
  assert.equal(admitUntrustedForeignCall({interruptible:false,isolation:'os-process',deadlineEnforced:true}),true);
  assert.equal(admitUntrustedForeignCall({interruptible:false,isolation:'os-process',deadlineEnforced:false}),false);
});
test('receipt is STRUCTURE_ONLY even if syntactically valid',()=>{
  assert.equal(validateReceipt(receipt(),m),'STRUCTURE_ONLY_NOT_CERTIFIED');
});
for(const backend of Object.keys(m.backends)){
  test('backend '+backend+' is not accidentally certified',()=>{
    assert.equal(validateReceipt(receipt('hot-path-127-no-slow-poll',backend),m),'STRUCTURE_ONLY_NOT_CERTIFIED');
  });
}
for(const key of ['head_sha','tree_sha','artifact_sha256','fixture_sha256']){
  test('reject missing '+key,()=>{
    const r=receipt();delete r[key];rejected(r,'missing:'+key);
  });
  test('reject malformed '+key,()=>{
    const r=receipt();r[key]='pending';rejected(r,'invalid:'+key);
  });
}
for(const key of ['workflow_run_id','workflow_attempt','job_id','executed_job_steps']){
  test('reject zero '+key,()=>{
    const r=receipt();r[key]=0;
    rejected(r,key==='executed_job_steps'?'zero-step-run':'nonzero-job-provenance');
  });
}
for(const kind of ['host-model','parser-only','source-check','skipped',null]){
  test('host-only evidence is not a guest: '+kind,()=>{
    const r=receipt();r.evidence_kind=kind;rejected(r,'guest-execution-required');
  });
}
test('wrong repo or run URL does not count',()=>{
  const r=receipt();r.workflow_url='https://github.com/atto-lang/atto-source.java/actions/runs/123';
  rejected(r,'wrong-workflow-target');
  r.workflow_url='https://github.com/atto-lang/atto-source.llvm/actions/runs/999';
  rejected(r,'wrong-workflow-target');
});
test('guest flag and observed outcome required',()=>{
  const r=receipt();r.guest_executed=false;rejected(r,'guest-execution-required');
  r.guest_executed=true;r.observed='PASS';rejected(r,'unverified-outcome');
});
test('nonzero guest exit cannot be a passing receipt',()=>{
  const r=receipt();r.exit_code=42;rejected(r,'nonzero-exit');
});
test('hostile native FFI kill needs independent sandbox and neighbor survival',()=>{
  const r=receipt('untrusted-ffi-hard-kill');
  rejected(r,'no-independent-boundary');
  r.enforced_boundary='thread';r.independent_termination_tested=true;r.neighbor_survived=true;
  rejected(r,'no-independent-boundary');
  r.enforced_boundary='os-process';r.neighbor_survived=false;
  rejected(r,'no-verified-kill');
  r.neighbor_survived=true;
  assert.equal(validateReceipt(r,m),'STRUCTURE_ONLY_NOT_CERTIFIED');
});
test('unsupported needs reason and no executed guest',()=>{
  const r={backend:'forge',case_id:m.cases[0].id,status:'unsupported'};
  rejected(r,'nonexecution-must-not-claim-guest');
  r.reason='not implemented';
  assert.equal(validateReceipt(r,m),'NON_PROMOTING');
  r.guest_executed=true;rejected(r,'nonexecution-must-not-claim-guest');
});
test('not_executed is not promotable by changing label',()=>{
  const r={backend:'net',case_id:m.cases[0].id,status:'not_executed',reason:'zero-step CI'};
  assert.equal(validateReceipt(r,m),'NON_PROMOTING');
  r.status='passed';rejected(r,'missing:head_sha');
});
test('unknown status, backend or case cannot pass',()=>{
  const r=receipt();r.backend='unknown';rejected(r,'unknown-backend');
  r.backend='llvm';r.case_id='unknown';rejected(r,'unknown-case');
  r.case_id=m.cases[0].id;r.status='certified';rejected(r,'unknown-status');
});
test('manifest cannot self-promote backends',()=>{
  const changed=structuredClone(m);changed.backends.java.status='PASSED';
  assert.throws(()=>validateManifest(changed),e=>e instanceof EvidenceError);
});
test('manifest cannot change interval contract to 100',()=>{
  const changed=structuredClone(m);changed.polling.default_interval=100;
  assert.throws(()=>validateManifest(changed),e=>e instanceof EvidenceError);
});
test('duplicate case IDs are invalid',()=>{
  const changed=structuredClone(m);changed.cases.push({...changed.cases[0]});
  assert.throws(()=>validateManifest(changed),e=>e instanceof EvidenceError);
});
