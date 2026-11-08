/** Source-free checkpoint oracle. NOT AttoLang code generation or a hostile-tenant sandbox. */
export const MAX_U64 = (1n << 64n) - 1n;
export const INTERVALS = Object.freeze([32,64,128,256,512]);
export class MeterFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function uint(value, label) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_U64)
    throw new MeterFailure('INVALID_' + label);
  return value;
}
export class ActorMeter {
  #fuel; #initial; #counter; #elapsed=0n; #wall; #cpu=0n; #cpuBudget;
  #mode; #interval; #critical=0; #cancelled=false; #closed=false; #admitted=false;
  #slow=0n; #handoffs=0n; #deferred=false;
  constructor({fuel,wallBudget,cpuBudget,interval=128,counter=0n,mode='untrusted'}) {
    if (!INTERVALS.includes(interval)) throw new MeterFailure('INVALID_INTERVAL');
    if (mode !== 'trusted' && mode !== 'untrusted') throw new MeterFailure('INVALID_MODE');
    this.#fuel=uint(fuel,'FUEL'); this.#initial=this.#fuel;
    this.#counter=uint(counter,'COUNTER'); this.#wall=uint(wallBudget,'WALL_BUDGET');
    this.#cpuBudget=uint(cpuBudget,'CPU_BUDGET'); this.#mode=mode; this.#interval=interval;
  }
  get fuel(){return this.#fuel;} get initialFuel(){return this.#initial;}
  get counter(){return this.#counter;} get slowPolls(){return this.#slow;}
  get handoffs(){return this.#handoffs;} get deferred(){return this.#deferred;}
  get cpu(){return this.#cpu;} get closed(){return this.#closed;}
  get interval(){return this.#interval;}
  #deny(code){this.#closed=true;throw new MeterFailure(code);}
  #active(){if(this.#closed) throw new MeterFailure('ACTOR_CLOSED');if(!this.#admitted)throw new MeterFailure('METER_NOT_ADMITTED');}
  #check(elapsed){
    if(this.#closed)throw new MeterFailure('ACTOR_CLOSED');
    const t=uint(elapsed,'ELAPSED');
    if(t<this.#elapsed)this.#deny('CLOCK_ROLLBACK');
    this.#elapsed=t;
    if(t>=this.#wall)this.#deny('WALL_EXHAUSTED');
    if(this.#cpu>=this.#cpuBudget)this.#deny('CPU_EXHAUSTED');
    if(this.#fuel===0n)this.#deny('FUEL_EXHAUSTED');
  }
  enterOrResume(elapsed) {
    this.#check(elapsed);
    if(this.#cancelled)this.#deny('CANCELLED');
    // A logical task carries its sampling cadence across all physical resumes.
    // Resetting here lets frequent 127-step resumes evade the slow path.
    this.#admitted=true;
  }
  chargeCpu(delta){
    this.#active(); const n=uint(delta,'CPU_DELTA');
    if(n>=this.#cpuBudget-this.#cpu){this.#cpu=this.#cpuBudget;this.#deny('CPU_EXHAUSTED');}
    this.#cpu+=n;
  }
  chargeBlock(cost,elapsed){
    this.#active();
    const n=uint(cost,'BLOCK_COST');
    if(n===0n)throw new MeterFailure('ZERO_COST');
    // Every instrumented basic block (not only backedges) contributes to polling.
    // elapsed is host-supplied monotonic time; the actual wall check is slow-path only.
    uint(elapsed,'ELAPSED');
    if(n>=this.#fuel){this.#fuel=0n;this.#deny('FUEL_EXHAUSTED');}
    this.#fuel-=n;
    this.#counter=(this.#counter+1n)&MAX_U64;
    if((this.#counter&BigInt(this.#interval-1))!==0n)return false;
    this.#slow++;this.#check(elapsed);
    if(this.#cancelled)this.#deny('CANCELLED');
    if(this.#mode==='trusted'){
      if(this.#critical)this.#deferred=true;
      else this.#handoffs++;
    }
    return true;
  }
  requestCancellation(){this.#cancelled=true;}
  enterCritical(){
    this.#active();
    if(this.#critical>=4096)this.#deny('CRITICAL_DEPTH_EXHAUSTED');
    this.#critical++;
  }
  exitCritical(){
    this.#active();if(this.#critical===0)throw new MeterFailure('CRITICAL_UNDERFLOW');
    this.#critical--;
    if(this.#cancelled)this.#deny('CANCELLED');
    if(!this.#critical && this.#deferred){
      this.#deferred=false;
      if(this.#mode==='trusted')this.#handoffs++;
    }
  }
  backedge(cost,elapsed){
    return this.chargeBlock(cost,elapsed);
  }
  explicitCooperate(elapsed){
    this.#active();
    this.#check(elapsed);
    if(this.#cancelled)this.#deny('CANCELLED');
    if(this.#mode!=='trusted')throw new MeterFailure('UNTRUSTED_COOPERATE_DISABLED');
    if(this.#critical)throw new MeterFailure('CRITICAL_SUSPENSION_DENIED');
    this.#handoffs++;
  }
}
/** Iterative O(V + E) verifier; stack use is bounded by a worklist on the heap. */
function noUnmeteredCycles(map, starts, successors) {
  const state=new Map();
  for(const start of starts){
    if(map.get(start).charged||state.get(start)===2)continue;
    state.set(start,1);
    const stack=[{key:start,nextIndex:0}];
    while(stack.length){
      const frame=stack[stack.length-1];
      const edges=successors(map.get(frame.key));
      if(frame.nextIndex===edges.length){
        state.set(frame.key,2);stack.pop();continue;
      }
      const child=edges[frame.nextIndex++];
      if(map.get(child).charged)continue;
      if(state.get(child)===1)return false;
      if(state.get(child)===2)continue;
      state.set(child,1);stack.push({key:child,nextIndex:0});
    }
  }
  return true;
}
/** Rejects cycles lacking a positive guaranteed charge; not a post-codegen proof. */
export function verifyMeteredCycles(blocks,entry){
  if(!Array.isArray(blocks)||blocks.length===0||blocks.length>4096||
     !Number.isSafeInteger(entry)||entry<0)throw new MeterFailure('INVALID_CFG');
  const map=new Map();
  let edgeCount=0;
  for(const b of blocks){
    if(!b||!Number.isSafeInteger(b.id)||b.id<0||map.has(b.id)||
       typeof b.charged!=='boolean'||!Array.isArray(b.next)||
       b.next.length>4096||b.next.some(n=>!Number.isSafeInteger(n)||n<0)||
       (b.charged&&(!Number.isSafeInteger(b.weight)||b.weight<=0)))
      throw new MeterFailure('INVALID_CFG');
    edgeCount+=b.next.length;
    if(edgeCount>65536)throw new MeterFailure('CFG_EDGE_LIMIT');
    map.set(b.id,b);
  }
  if(!map.has(entry)||blocks.some(b=>b.next.some(n=>!map.has(n))))
    throw new MeterFailure('INVALID_CFG');
  const reachable=new Set([entry]),queue=[entry];
  for(let i=0;i<queue.length;i++){
    for(const dest of map.get(queue[i]).next)
      if(!reachable.has(dest)){reachable.add(dest);queue.push(dest);}
  }
  return noUnmeteredCycles(map,reachable,b=>b.next);
}
/** Every recursive SCC must hit a charge; separate stack-depth enforcement still required. */
export function verifyMeteredCalls(functions){
  if(!Array.isArray(functions)||!functions.length||functions.length>4096)
    throw new MeterFailure('INVALID_CALL_GRAPH');
  const map=new Map();
  let edgeCount=0;
  for(const f of functions){
    if(!f||typeof f.name!=='string'||!f.name||map.has(f.name)||
       typeof f.charged!=='boolean'||!Array.isArray(f.calls)||
       f.calls.length>4096||f.calls.some(c=>typeof c!=='string'||!c)||
       (f.charged&&(!Number.isSafeInteger(f.weight)||f.weight<=0)))
      throw new MeterFailure('INVALID_CALL_GRAPH');
    edgeCount+=f.calls.length;
    if(edgeCount>65536)throw new MeterFailure('CALL_EDGE_LIMIT');
    map.set(f.name,f);
  }
  if(functions.some(f=>f.calls.some(c=>!map.has(c))))
    throw new MeterFailure('INVALID_CALL_GRAPH');
  return noUnmeteredCycles(map,map.keys(),f=>f.calls);
}
/** Optimized control flow is independently rechecked; no claim of semantic IR equality. */
export function verifyPostOptimization(before,after,entry){
  return verifyMeteredCycles(before,entry)&&verifyMeteredCycles(after,entry);
}
/** Even an interruptible FFI wrapper can hang. Every hostile foreign call needs a kill boundary. */
export function admitUntrustedForeignCall(descriptor){
  if(!descriptor||typeof descriptor!=='object'||Array.isArray(descriptor))return false;
  const {interruptible,isolation,deadlineEnforced}=descriptor;
  if(typeof interruptible!=='boolean'||typeof deadlineEnforced!=='boolean')return false;
  return ['os-process','validated-wasm-isolate','hardware-compartment'].includes(isolation)&&deadlineEnforced;
}
