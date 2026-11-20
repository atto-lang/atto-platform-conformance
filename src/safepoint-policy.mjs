/** Executable policy model only: NOT a Java/LLVM compiler or scheduling proof. */
const kinds=new Set(['await','blocking-call','readch','writech','select','cooperate','auto-backedge','generator-value']);
export function admitSafePoint(input) {
 const p={hasHeapContinuation:false,liveBorrow:false,liveGuard:false,plainCritical:false,
   hostFrame:false,partialEffect:false,inCleanup:false,cleanupLowered:false,
   untrusted:false,quotaContinuous:false,...input};
 if(!kinds.has(p.kind))throw new TypeError('unknown suspension kind');
 const denied=(reason)=>({decision:p.kind==='auto-backedge'?'DEFER':'REJECT',reason});
 if(p.plainCritical)return denied('plain-critical-no-suspend');
 if(p.liveBorrow)return denied('loan-across-suspension');
 if(p.liveGuard)return denied('guard-across-suspension');
 if(p.hostFrame)return denied('host-frame-not-captured');
 if(p.partialEffect)return denied('partial-effect-not-committed');
 if(p.inCleanup&&!p.cleanupLowered)return denied('cleanup-not-lowered');
 if(p.untrusted&&!p.quotaContinuous)return denied('logical-quota-not-continuous');
 if(!p.hasHeapContinuation)return denied('continuation-not-lowered');
 return {decision:p.kind==='generator-value'?'EMIT_AND_PARK':'ADMIT',reason:'proven-heap-continuation'};
}
/** Wall time is a poll-triggered scheduling request, never a timer interrupt. */
export function budgetDecision({reductions,limit=512,elapsedNs,timeLimitNs=2_000_000,
 probeDue=true,peerRunnable=true,kind='auto-backedge',...safety}) {
 if(![reductions,limit,elapsedNs,timeLimitNs].every(x=>Number.isFinite(x)&&x>=0))
   throw new TypeError('invalid budget');
 if(!probeDue)return {decision:'CONTINUE',reason:'probe-not-due'};
 if(reductions<limit&&elapsedNs<timeLimitNs)return {decision:'CONTINUE',reason:'budget-remaining'};
 const gate=admitSafePoint({kind,...safety});
 if(gate.decision!=='ADMIT')return gate;
 if(!peerRunnable)return {decision:'CONTINUE',reason:'no-runnable-peer'};
 return {decision:'HANDOFF',reason:reductions>=limit?'reduction-budget':'time-budget'};
}
export function mayEnterActorWhileParked({serialActor=false,reason='cooperate',reentryPolicy=false,
 exclusiveStateLoan=false,criticalTicket=false}={}) {
 if(serialActor||criticalTicket||exclusiveStateLoan)return false;
 if(reason==='cooperate'||reason==='auto-backedge'||reason==='generator-value')return false;
 return reason==='await'&&reentryPolicy===true;
}
export class HandoffModel {
 constructor(){this.state='RUNNING';this.carrierActive=true;this.epochs=0;this.completions=0;this.finalizers=0;this.sideEffects=0;}
 commitEffect(){if(this.state!=='RUNNING')throw Error('not running');this.sideEffects++;}
 requestCooperate(){if(this.state!=='RUNNING')throw Error('invalid handoff');this.state='UNWINDING';}
 carrierExited(){
   if(!['UNWINDING','CANCEL_PENDING'].includes(this.state)||!this.carrierActive)throw Error('invalid physical exit');
   this.carrierActive=false;
   if(this.state==='CANCEL_PENDING'){this.state='CANCELLED';this.finalizers++;}
   else this.state='RUNNABLE';
 }
 resume(){if(this.state!=='RUNNABLE'||this.carrierActive)throw Error('overlapping resume');this.epochs++;this.carrierActive=true;this.state='RUNNING';}
 complete(){if(this.state!=='RUNNING')throw Error('not running');this.state='COMPLETE';this.carrierActive=false;this.completions++;}
 cancel(){
   if(['COMPLETE','CANCELLED','CANCEL_PENDING'].includes(this.state))return;
   if(this.carrierActive){this.state='CANCEL_PENDING';return;}
   this.state='CANCELLED';this.finalizers++;
 }
}
/** Demand-driven generator: yield value is not rt cooperate. */
export class AsyncGeneratorModel {
 constructor(){this.state='IDLE';this.emissions=0;this.disposals=0;this.pendingPull=false;}
 next(){if(!['IDLE','PARKED'].includes(this.state)||this.pendingPull)throw Error('concurrent or closed pull');this.pendingPull=true;this.state='RUNNING';}
 emit(){if(this.state!=='RUNNING'||!this.pendingPull)throw Error('emit without pull');this.emissions++;this.pendingPull=false;this.state='PARKED';}
 close(){if(this.state==='CLOSED'||this.state==='CLOSING')return;if(this.state==='RUNNING'){this.state='CLOSING';return;}this.state='CLOSED';this.pendingPull=false;this.disposals++;}
 producerExited(){if(this.state!=='CLOSING')throw Error('producer exit without close');this.state='CLOSED';this.pendingPull=false;this.disposals++;}
}
