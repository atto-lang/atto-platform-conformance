import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ActorMeter,MeterFailure,MAX_U64,verifyMeteredCycles,verifyMeteredCalls,
  verifyPostOptimization,admitUntrustedForeignCall
} from '../reference/cooperative-meter.mjs';
import {validateManifest,validateReceipt,EvidenceError} from '../bin/verify_cooperative_execution.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../contracts/cooperative-execution-v1.json',import.meta.url)));
const make=(opts={})=>{
  const x=new ActorMeter({fuel:100000n,wallBudget:100000n,cpuBudget:100000n,...opts});
  x.enterOrResume(0n);return x;
};
const deny=(run,code)=>assert.throws(run,e=>e instanceof MeterFailure&&e.code===code);
const invalid=(m,code)=>assert.throws(()=>validateManifest(m),e=>e instanceof EvidenceError&&e.message===code);
const changed=()=>structuredClone(manifest);

test('polling interval remains immutable across instance-property shadowing',()=>{
  const a=make();assert.equal(a.interval,128);
  assert.throws(()=>{a.interval=65536},TypeError);
  Object.defineProperty(a,'interval',{value:65536});
  for(let i=0;i<128;i++)a.backedge(1n,0n);
  assert.equal(a.slowPolls,1n);
});
test('single logical cadence survives 127-step dispatch resets',()=>{
  const a=make();
  for(let i=0;i<128;i++){
    a.backedge(1n,0n);
    a.enterOrResume(0n);
  }
  assert.equal(a.slowPolls,1n);
  assert.equal(a.counter,128n);
  assert.equal(a.fuel,99872n);
});
test('counter retains remainder across heterogeneous resume chunks',()=>{
  const a=make();
  for(const chunk of [7,29,31,60]){
    for(let i=0;i<chunk;i++)a.backedge(1n,0n);
    a.enterOrResume(0n);
  }
  assert.equal(a.slowPolls,0n);
  a.backedge(1n,0n);
  assert.equal(a.slowPolls,1n);
});
test('straight-line basic blocks periodically poll without any backedge',()=>{
  const a=make();
  for(let i=0;i<127;i++)assert.equal(a.chargeBlock(1n,0n),false);
  assert.equal(a.slowPolls,0n);
  assert.equal(a.chargeBlock(1n,0n),true);
  assert.equal(a.slowPolls,1n);
});
test('mixed basic-block and backedge charges share one counter',()=>{
  const a=make();
  for(let i=0;i<64;i++)a.chargeBlock(1n,0n);
  for(let i=0;i<64;i++)a.backedge(1n,0n);
  assert.equal(a.slowPolls,1n);assert.equal(a.counter,128n);
});
test('cancellation is bounded even in straight-line block chain',()=>{
  const a=make();a.requestCancellation();
  for(let i=0;i<127;i++)a.chargeBlock(1n,0n);
  deny(()=>a.chargeBlock(1n,0n),'CANCELLED');
  assert.equal(a.closed,true);
});
test('wall expiration in long straight-line block checked at periodic poll',()=>{
  const a=make({wallBudget:7n});
  for(let i=0;i<127;i++)a.chargeBlock(1n,7n);
  deny(()=>a.chargeBlock(1n,7n),'WALL_EXHAUSTED');
});
test('invalid sample time does not change fuel or poll counter',()=>{
  const a=make();const fuel=a.fuel, count=a.counter;
  for(const elapsed of [undefined,-1n,MAX_U64+1n,0,1.2,'0',null]){
    deny(()=>a.chargeBlock(1n,elapsed),'INVALID_ELAPSED');
  }
  assert.equal(a.fuel,fuel);assert.equal(a.counter,count);
});
test('cannot spend fuel by passing a non-64-bit BigInt cost',()=>{
  const a=make();
  for(const cost of [1,0n,-1n,MAX_U64+1n,NaN]){
    deny(()=>a.chargeBlock(cost,0n),cost===0n?'ZERO_COST':'INVALID_BLOCK_COST');
  }
  assert.equal(a.fuel,100000n);assert.equal(a.counter,0n);
});
test('fuel exhaustion fails before increment or effect publication',()=>{
  const a=make({fuel:2n});
  assert.equal(a.chargeBlock(1n,0n),false);
  deny(()=>a.chargeBlock(1n,0n),'FUEL_EXHAUSTED');
  assert.equal(a.counter,1n);assert.equal(a.fuel,0n);
});
test('fuel does not wrap across UINT64 boundary',()=>{
  const a=make({fuel:MAX_U64});
  a.chargeBlock(MAX_U64-1n,0n);assert.equal(a.fuel,1n);
  deny(()=>a.chargeBlock(1n,0n),'FUEL_EXHAUSTED');
  assert.equal(a.fuel,0n);
});
test('CPU debt cannot reset after many physical turns',()=>{
  const a=make({cpuBudget:13n});
  a.chargeCpu(2n);a.enterOrResume(0n);
  a.chargeCpu(5n);a.enterOrResume(0n);
  deny(()=>a.chargeCpu(6n),'CPU_EXHAUSTED');
  assert.equal(a.cpu,13n);
});
test('cancellation on critical exit cannot publish pending handoff',()=>{
  const a=make({mode:'trusted'});
  a.enterCritical();
  for(let i=0;i<128;i++)a.backedge(1n,0n);
  assert.equal(a.deferred,true);
  a.requestCancellation();
  deny(()=>a.exitCritical(),'CANCELLED');
  assert.equal(a.handoffs,0n);
});
test('critical nesting is bounded and fail-stop on overflow',()=>{
  const a=make({mode:'trusted'});
  for(let i=0;i<4096;i++)a.enterCritical();
  deny(()=>a.enterCritical(),'CRITICAL_DEPTH_EXHAUSTED');
  assert.equal(a.closed,true);
});
test('critical underflow is denied',()=>{
  const a=make({mode:'trusted'});
  deny(()=>a.exitCritical(),'CRITICAL_UNDERFLOW');
});
test('cooperation during cancellation is fail-stop',()=>{
  const a=make({mode:'trusted'});
  a.requestCancellation();
  deny(()=>a.explicitCooperate(0n),'CANCELLED');
  assert.equal(a.handoffs,0n);
});
test('first admission rejects cancelled actor before any fuel is used',()=>{
  const a=new ActorMeter({fuel:2n,wallBudget:9n,cpuBudget:9n});
  a.requestCancellation();
  deny(()=>a.enterOrResume(0n),'CANCELLED');
  assert.equal(a.fuel,2n);assert.equal(a.closed,true);
});
test('untrusted malformed FFI descriptors fail closed rather than crashing',()=>{
  for(const x of [null,undefined,0,'process',[],{},Object.create(null),{isolation:'os-process'}])
    assert.equal(admitUntrustedForeignCall(x),false);
});
test('browser worker alone never admits hostile native FFI',()=>{
  for(const isolation of ['web-worker','jvm-thread','native-thread','shared-arena','graal-classloader'])
    assert.equal(admitUntrustedForeignCall({interruptible:true,isolation,deadlineEnforced:true}),false);
});
test('OS kill boundary still needs deadline enforcement',()=>{
  const base={interruptible:false,isolation:'os-process',deadlineEnforced:true};
  assert.equal(admitUntrustedForeignCall(base),true);
  assert.equal(admitUntrustedForeignCall({...base,deadlineEnforced:false}),false);
});

test('4096-node acyclic CFG does not overflow JS call stack',()=>{
  const graph=Array.from({length:4096},(_,id)=>({id,charged:false,next:id===4095?[]:[id+1]}));
  assert.equal(verifyMeteredCycles(graph,0),true);
});
test('4096-node non-metered ring is rejected without recursive traversal',()=>{
  const graph=Array.from({length:4096},(_,id)=>({id,charged:false,next:[(id+1)%4096]}));
  assert.equal(verifyMeteredCycles(graph,0),false);
});
test('4096-node ring with one positive charge is accepted structurally',()=>{
  const graph=Array.from({length:4096},(_,id)=>({id,charged:id===4095,weight:id===4095?1:undefined,next:[(id+1)%4096]}));
  assert.equal(verifyMeteredCycles(graph,0),true);
});
test('CFG edge explosion rejected before traversing it',()=>{
  const graph=Array.from({length:4096},(_,id)=>({id,charged:false,next:Array.from({length:17},(_,k)=>k)}));
  deny(()=>verifyMeteredCycles(graph,0),'CFG_EDGE_LIMIT');
});
test('CFG rejects untrusted negative labels and malformed nodes',()=>{
  for(const graph of [
    [{id:-1,charged:false,next:[]}],
    [{id:0,charged:false,next:[-1]}],
    [null],
    [{id:0,charged:false,next:[0]},{id:0,charged:true,weight:1,next:[]}],
    [{id:0,charged:true,weight:0,next:[0]}]
  ])deny(()=>verifyMeteredCycles(graph,0),'INVALID_CFG');
});
test('optimizations that remove the only metered node fail structural gate',()=>{
  const before=[
    {id:0,charged:true,weight:1,next:[1]},
    {id:1,charged:false,next:[0]}
  ];
  const after=[{id:0,charged:false,next:[1]},{id:1,charged:false,next:[0]}];
  assert.equal(verifyPostOptimization(before,after,0),false);
  assert.equal(verifyPostOptimization(before,before,0),true);
});
test('4096-deep nonrecursive call graph does not overflow validator stack',()=>{
  const calls=Array.from({length:4096},(_,i)=>({name:'f'+i,charged:false,calls:i===4095?[]:['f'+(i+1)]}));
  assert.equal(verifyMeteredCalls(calls),true);
});
test('4096-deep recursive call graph without fuel is rejected',()=>{
  const calls=Array.from({length:4096},(_,i)=>({name:'f'+i,charged:false,calls:['f'+((i+1)%4096)]}));
  assert.equal(verifyMeteredCalls(calls),false);
});
test('4096-deep recursive call graph with a charged node is accepted',()=>{
  const calls=Array.from({length:4096},(_,i)=>({name:'f'+i,charged:i===2000,weight:i===2000?1:undefined,calls:['f'+((i+1)%4096)]}));
  assert.equal(verifyMeteredCalls(calls),true);
});
test('call graph rejects combinatorial edge explosion',()=>{
  const calls=Array.from({length:4096},(_,i)=>({name:'f'+i,charged:false,calls:Array.from({length:17},(_,k)=>'f'+k)}));
  deny(()=>verifyMeteredCalls(calls),'CALL_EDGE_LIMIT');
});
test('call graph rejects unknown symbols and negative charge',()=>{
  deny(()=>verifyMeteredCalls([{name:'f',charged:false,calls:['g']}]),'INVALID_CALL_GRAPH');
  deny(()=>verifyMeteredCalls([{name:'f',charged:true,weight:-1,calls:['f']}]),'INVALID_CALL_GRAPH');
});
function exhaustiveReachableNoCycle(adj,charged){
  const n=adj.length;const reachable=new Set([0]),q=[0];
  for(let i=0;i<q.length;i++)for(const j of adj[q[i]])if(!reachable.has(j)){reachable.add(j);q.push(j);}
  const edges=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
    reachable.has(i)&&reachable.has(j)&&!charged[i]&&!charged[j]&&adj[i].includes(j)));
  for(let k=0;k<n;k++)for(let i=0;i<n;i++)for(let j=0;j<n;j++)
    edges[i][j] ||= edges[i][k]&&edges[k][j];
  return !edges.some((row,i)=>row[i]);
}
function exhaustiveCallNoCycle(adj,charged){
  const n=adj.length;
  const edges=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>
    !charged[i]&&!charged[j]&&adj[i].includes(j)));
  for(let k=0;k<n;k++)for(let i=0;i<n;i++)for(let j=0;j<n;j++)
    edges[i][j] ||= edges[i][k]&&edges[k][j];
  return !edges.some((row,i)=>row[i]);
}
test('4096 exhaustively enumerated three-node CFGs match independent closure oracle',()=>{
  for(let graphMask=0;graphMask<512;graphMask++){
    const adj=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>j).filter(j=>graphMask&(1<<(i*3+j))));
    for(let charges=0;charges<8;charges++){
      const charged=Array.from({length:3},(_,i)=>Boolean(charges&(1<<i)));
      const blocks=adj.map((next,id)=>({id,next,charged:charged[id],weight:charged[id]?1:undefined}));
      assert.equal(verifyMeteredCycles(blocks,0),exhaustiveReachableNoCycle(adj,charged),graphMask+':'+charges);
    }
  }
});
test('4096 exhaustively enumerated call graphs match independent closure oracle',()=>{
  for(let graphMask=0;graphMask<512;graphMask++){
    const adj=Array.from({length:3},(_,i)=>Array.from({length:3},(_,j)=>j).filter(j=>graphMask&(1<<(i*3+j))));
    for(let charges=0;charges<8;charges++){
      const charged=Array.from({length:3},(_,i)=>Boolean(charges&(1<<i)));
      const calls=adj.map((next,i)=>({name:'f'+i,calls:next.map(j=>'f'+j),charged:charged[i],weight:charged[i]?1:undefined}));
      assert.equal(verifyMeteredCalls(calls),exhaustiveCallNoCycle(adj,charged),graphMask+':'+charges);
    }
  }
});

test('canonical case kinds and expected outcomes cannot be rewritten',()=>{
  const m=changed();m.cases[0].expect='unmeasured-accept';
  invalid(m,'case-contract-downgrade');
  m.cases[0].expect=manifest.cases[0].expect;
  m.cases[0].kind='security';
  invalid(m,'case-contract-downgrade');
});
test('manifest cannot remove a security case and substitute filler',()=>{
  const m=changed();m.cases[0]={id:'invented',kind:'runtime',expect:'success'};
  invalid(m,'case-contract-downgrade');
});
test('mandatory independent kill-boundary cases cannot be dropped',()=>{
  const m=changed();m.evidence.boundary_required_for=[];
  invalid(m,'boundary-policy-downgrade');
});
test('mandatory receipt fields cannot be silently weakened',()=>{
  const m=changed();
  m.evidence.required_passed_fields=m.evidence.required_passed_fields.filter(k=>k!=='workflow_url');
  invalid(m,'evidence-fields-downgrade');
});
test('receipt evidence field cannot be duplicated in place of a missing field',()=>{
  const m=changed();m.evidence.required_passed_fields.splice(0,1,'job_id');
  invalid(m,'evidence-fields-downgrade');
});
test('malformed evidence policy fails as EvidenceError not a host exception',()=>{
  const m=changed();delete m.evidence;
  invalid(m,'evidence-states');
});
test('synthetic passing receipt still never grants verified guest status',()=>{
  const c=manifest.cases[0];
  const receipt={
    backend:'wasm',case_id:c.id,status:'passed',
    head_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),
    artifact_sha256:'c'.repeat(64),fixture_sha256:'d'.repeat(64),
    workflow_run_id:9,workflow_attempt:1,job_id:3,workflow_url:'https://github.com/atto-lang/atto-source.wasm/actions/runs/9',
    executed_job_steps:7,guest_executed:true,evidence_kind:'compiled-guest',
    command:'guest fixtures',observed:c.expect,exit_code:0
  };
  assert.equal(validateReceipt(receipt,manifest),'STRUCTURE_ONLY_NOT_CERTIFIED');
});

for(const interval of [32,64,128,256,512]){
  test('host monotonic clock invoked only once every '+interval+' charged blocks',()=>{
    const a=make({interval});
    let calls=0;
    const clock=()=>{calls++;return 0n;};
    for(let i=0;i<interval*4;i++)a.chargeBlock(1n,clock);
    assert.equal(calls,4);
    assert.equal(a.slowPolls,4n);
    assert.equal(a.fuel,100000n-BigInt(interval*4));
  });
}
test('per-backedge clock reads are amortized even with mixed charge sites',()=>{
  const a=make();let calls=0;
  const clock=()=>{calls++;return 0n;};
  for(let i=0;i<64;i++)a.backedge(1n,clock);
  for(let i=0;i<64;i++)a.chargeBlock(1n,clock);
  assert.equal(calls,1);
});
test('clock provider failure closes the actor at its first due poll',()=>{
  const a=make();let reads=0;
  const clock=()=>{reads++;throw Error('clock down');};
  for(let i=0;i<127;i++)a.chargeBlock(1n,clock);
  assert.equal(reads,0);
  deny(()=>a.chargeBlock(1n,clock),'CLOCK_SOURCE_FAILURE');
  assert.equal(reads,1);assert.equal(a.closed,true);
  deny(()=>a.chargeBlock(1n,0n),'ACTOR_CLOSED');
});
test('clock provider cannot throw forged MeterFailure to leave actor alive',()=>{
  const a=make();const clock=()=>{throw new MeterFailure('BENIGN');};
  for(let i=0;i<127;i++)a.backedge(1n,clock);
  deny(()=>a.backedge(1n,clock),'CLOCK_SOURCE_FAILURE');
  assert.equal(a.closed,true);
});
test('reentrant clock provider fails closed without refueling',()=>{
  const a=make();const clock=()=>a.chargeBlock(1n,0n);
  for(let i=0;i<127;i++)a.chargeBlock(1n,clock);
  deny(()=>a.chargeBlock(1n,clock),'CLOCK_REENTRANCY');
  assert.equal(a.fuel,99872n);
  assert.equal(a.closed,true);
});
test('invalid clock result fails closed at 128th charge',()=>{
  const a=make();const clock=()=>undefined;
  for(let i=0;i<127;i++)a.chargeBlock(1n,clock);
  deny(()=>a.chargeBlock(1n,clock),'INVALID_ELAPSED');
  assert.equal(a.closed,true);
});
test('async clock result cannot be treated as monotonic number',()=>{
  const a=make();const clock=async()=>0n;
  for(let i=0;i<127;i++)a.chargeBlock(1n,clock);
  deny(()=>a.chargeBlock(1n,clock),'INVALID_ELAPSED');
  assert.equal(a.closed,true);
});
test('clock rollback on second slow poll is denied',()=>{
  const a=make();let clockTime=10n;
  const clock=()=>clockTime;
  for(let i=0;i<128;i++)a.chargeBlock(1n,clock);
  clockTime=9n;
  for(let i=0;i<127;i++)a.chargeBlock(1n,clock);
  deny(()=>a.chargeBlock(1n,clock),'CLOCK_ROLLBACK');
  assert.equal(a.closed,true);
});
test('fuel exhaustion takes precedence and does not invoke expensive clock',()=>{
  const a=make({fuel:1n});let reads=0;
  deny(()=>a.chargeBlock(1n,()=>{reads++;return 0n;}),'FUEL_EXHAUSTED');
  assert.equal(reads,0);
});
test('initial admission invalid clock fails closed',()=>{
  const a=new ActorMeter({fuel:10n,wallBudget:20n,cpuBudget:20n});
  deny(()=>a.enterOrResume(undefined),'INVALID_ELAPSED');
  assert.equal(a.closed,true);
});
