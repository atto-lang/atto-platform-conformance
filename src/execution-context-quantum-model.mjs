/** A deterministic architecture model ONLY — not the Oreslang compiler/runtime. */
export class ExecutionContextQuantumModel {
  constructor({clock, every=64, reductions=512, quantumNs=2_000_000, fuel=100000}={}) {
    if(typeof clock!=='function')throw TypeError('clock required');
    for(const n of [every,reductions,quantumNs,fuel])if(!Number.isSafeInteger(n)||n<=0)throw TypeError('positive integer budgets required');
    this.clock=clock; this.every=every; this.initialReductions=reductions;
    this.quantumNs=quantumNs; this.fuel=fuel;this.phase='RUNNING';
    this.carrierActive=true;this.executionEpoch=0;this.leaseHeld=true;
    this.dispatchStart=clock();this.clockReads=1;this.probeCountdown=every;
    this.reductionsRemaining=reductions;this.pendingPC=null;this.unwindStack=[];
    this.cancelRequested=false;this.cleaned=false;this.completedCleanup=[];
    this.totalBackedges=0;this.handoffs=0;
  }
  registerDefer(name){if(this.phase!=='RUNNING')throw Error('register requires running task');this.unwindStack.push(name);}
  backedge(postCommitPc,{provenSafePoint=true,peerRunnable=true,weight=1}={}) {
    if(this.phase!=='RUNNING'||!this.carrierActive)throw Error('not running');
    if(!Number.isSafeInteger(weight)||weight<1)throw TypeError('weight');
    if(--this.fuel<0)throw Error('logical fuel exhausted');
    this.totalBackedges++;this.reductionsRemaining-=weight;
    this.probeCountdown--;
    if(this.probeCountdown>0&&this.reductionsRemaining>0)return 'RUN';
    this.probeCountdown=this.every;
    // The cost of the monotonic clock is paid only on the slow path.
    this.clockReads++;const elapsed=this.clock()-this.dispatchStart;
    if(this.reductionsRemaining>0&&elapsed<this.quantumNs)return 'RUN';
    if(!provenSafePoint)return 'DEFER';
    if(!peerRunnable)return 'RUN';
    this.pendingPC=postCommitPc;this.phase='UNWINDING';this.handoffs++;return 'HANDOFF';
  }
  carrierExited(){
    if(!this.carrierActive||!['UNWINDING','CANCEL_REQUESTED'].includes(this.phase))throw Error('invalid exit');
    this.carrierActive=false;this.phase=this.cancelRequested?'CLEANUP_READY':'RUNNABLE';
  }
  resume(){
    if(this.phase!=='RUNNABLE'||this.carrierActive)throw Error('resume before physical exit or duplicate');
    this.phase='RUNNING';this.carrierActive=true;this.executionEpoch++;
    this.dispatchStart=this.clock();this.clockReads++;this.probeCountdown=this.every;
    this.reductionsRemaining=this.initialReductions;
    return this.pendingPC;
  }
  cancel(){
    if(this.cleaned||this.phase==='CANCEL_REQUESTED'||this.phase==='CLEANUP_READY')return;
    this.cancelRequested=true;
    if(this.carrierActive)this.phase='CANCEL_REQUESTED';
    else this.phase='CLEANUP_READY';
  }
  drainCancelledCleanup(){
    if(this.phase!=='CLEANUP_READY'||this.carrierActive)throw Error('cleanup requires own non-running lane');
    if(this.cleaned)return;
    while(this.unwindStack.length)this.completedCleanup.push(this.unwindStack.pop());
    this.cleaned=true;this.leaseHeld=false;this.phase='CANCELLED';
  }
}
/** Any unbounded CFG cycle that avoids a proven safepoint is unsafe. */
export function hasYieldFreeCycle({nodes,edges,entry}) {
  const byId=new Map(nodes.map(n=>[n.id,n]));
  if(byId.size!==nodes.length||!byId.has(entry))throw TypeError('invalid graph');
  const adj=new Map(nodes.map(n=>[n.id,[]]));
  for(const [a,b] of edges){if(!byId.has(a)||!byId.has(b))throw TypeError('unknown node');adj.get(a).push(b);}
  // Visit each reachable node once; avoid variadic push on high fan-out CFGs.
  const reachable=new Set([entry]),walk=[entry];
  while(walk.length){
    const u=walk.pop();
    for(const v of adj.get(u))if(!reachable.has(v)){reachable.add(v);walk.push(v);}
  }
  // Remove proven safepoints, then use Kahn's algorithm on the induced graph.
  // A nonempty residual after eliminating zero-indegree vertices is a cycle.
  const indegree=new Map();
  for(const u of reachable)if(!byId.get(u).safePoint)indegree.set(u,0);
  for(const u of indegree.keys())for(const v of adj.get(u)){
    if(indegree.has(v))indegree.set(v,indegree.get(v)+1);
  }
  const ready=[];
  for(const [u,count] of indegree)if(count===0)ready.push(u);
  let removed=0;
  while(ready.length){
    const u=ready.pop();removed++;
    for(const v of adj.get(u))if(indegree.has(v)){
      const count=indegree.get(v)-1;indegree.set(v,count);
      if(count===0)ready.push(v);
    }
  }
  return removed!==indegree.size;
}
