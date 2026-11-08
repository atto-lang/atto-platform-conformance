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
  #mode; #critical=0; #cancelled=false; #closed=false;
  #slow=0n; #handoffs=0n; #deferred=false;
  constructor({fuel,wallBudget,cpuBudget,interval=128,counter=0n,mode='untrusted'}) {
    if (!INTERVALS.includes(interval)) throw new MeterFailure('INVALID_INTERVAL');
    if (mode !== 'trusted' && mode !== 'untrusted') throw new MeterFailure('INVALID_MODE');
    this.#fuel=uint(fuel,'FUEL'); this.#initial=this.#fuel;
    this.#counter=uint(counter,'COUNTER'); this.#wall=uint(wallBudget,'WALL_BUDGET');
    this.#cpuBudget=uint(cpuBudget,'CPU_BUDGET'); this.#mode=mode; this.interval=interval;
  }
  get fuel(){return this.#fuel;} get initialFuel(){return this.#initial;}
  get counter(){return this.#counter;} get slowPolls(){return this.#slow;}
  get handoffs(){return this.#handoffs;} get deferred(){return this.#deferred;}
  get cpu(){return this.#cpu;} get closed(){return this.#closed;}
  #deny(code){this.#closed=true;throw new MeterFailure(code);}
  #active(){if(this.#closed) throw new MeterFailure('ACTOR_CLOSED');}
  #check(elapsed){
    this.#active(); const t=uint(elapsed,'ELAPSED');
    if(t<this.#elapsed)this.#deny('CLOCK_ROLLBACK');
    this.#elapsed=t;
    if(t>=this.#wall)this.#deny('WALL_EXHAUSTED');
    if(this.#cpu>=this.#cpuBudget)this.#deny('CPU_EXHAUSTED');
    if(this.#fuel===0n)this.#deny('FUEL_EXHAUSTED');
  }
  enterOrResume(elapsed) {
    this.#check(elapsed);
    this.#counter=0n; // physical turn may reset cadence, NOT logical fuel/CPU/deadline
    if(this.#cancelled)this.#deny('CANCELLED');
  }
  chargeCpu(delta){
    this.#active(); const n=uint(delta,'CPU_DELTA');
    if(n>=this.#cpuBudget-this.#cpu){this.#cpu=this.#cpuBudget;this.#deny('CPU_EXHAUSTED');}
    this.#cpu+=n;
  }
  chargeBlock(cost){
    this.#active();const n=uint(cost,'BLOCK_COST');
    if(n===0n)throw new MeterFailure('ZERO_COST');
    if(n>=this.#fuel){this.#fuel=0n;this.#deny('FUEL_EXHAUSTED');}
    this.#fuel-=n;
  }
  requestCancellation(){this.#cancelled=true;}
  enterCritical(){this.#active();this.#critical++;}
  exitCritical(){
    this.#active();if(this.#critical===0)throw new MeterFailure('CRITICAL_UNDERFLOW');
    this.#critical--;
    if(!this.#critical && this.#deferred){
      this.#deferred=false;
      if(this.#mode==='trusted')this.#handoffs++;
    }
  }
  backedge(cost,elapsed){
    this.chargeBlock(cost);
    this.#counter=(this.#counter+1n)&MAX_U64;
    if((this.#counter&BigInt(this.interval-1))!==0n)return false;
    this.#slow++;this.#check(elapsed);
    if(this.#cancelled)this.#deny('CANCELLED');
    if(this.#mode==='trusted'){
      if(this.#critical)this.#deferred=true;
      else this.#handoffs++;
    }
    return true;
  }
  explicitCooperate(elapsed){
    this.#check(elapsed);
    if(this.#cancelled)this.#deny('CANCELLED');
    if(this.#mode!=='trusted')throw new MeterFailure('UNTRUSTED_COOPERATE_DISABLED');
    if(this.#critical)throw new MeterFailure('CRITICAL_SUSPENSION_DENIED');
    this.#handoffs++;
  }
}
/** Conservative HIR/MIR cycle oracle: delete charged vertices, then detect cycles. */
export function verifyMeteredCycles(blocks,entry){
  if(!Array.isArray(blocks)||blocks.length===0||blocks.length>4096||!Number.isSafeInteger(entry))
    throw new MeterFailure('INVALID_CFG');
  const map=new Map();
  for(const b of blocks){
    if(!Number.isSafeInteger(b.id)||map.has(b.id)||typeof b.charged!=='boolean'||
       !Array.isArray(b.next)||b.next.length>4096||
       b.next.some(n=>!Number.isSafeInteger(n))||
       (b.charged&&(!Number.isSafeInteger(b.weight)||b.weight<=0)))
      throw new MeterFailure('INVALID_CFG');
    map.set(b.id,b);
  }
  if(!map.has(entry)||blocks.some(b=>b.next.some(n=>!map.has(n))))
    throw new MeterFailure('INVALID_CFG');
  const reachable=new Set();
  function reach(id){
    if(reachable.has(id))return;
    reachable.add(id);
    for(const n of map.get(id).next)reach(n);
  }
  reach(entry);
  const state=new Map();
  function unmeteredCycle(id){
    if(map.get(id).charged)return false;
    if(state.get(id)===1)return true;
    if(state.get(id)===2)return false;
    state.set(id,1);
    for(const n of map.get(id).next)
      if(reachable.has(n)&&unmeteredCycle(n))return true;
    state.set(id,2);
    return false;
  }
  for(const id of reachable)if(unmeteredCycle(id))return false;
  return true;
}
/** Recursion SCC check, additionally requires actual runtime stack-depth quota. */
export function verifyMeteredCalls(functions){
  if(!Array.isArray(functions)||!functions.length||functions.length>4096)
    throw new MeterFailure('INVALID_CALL_GRAPH');
  const m=new Map();
  for(const f of functions){
    if(typeof f.name!=='string'||!f.name||m.has(f.name)||
       typeof f.charged!=='boolean'||!Array.isArray(f.calls)||f.calls.length>4096||
       f.calls.some(c=>typeof c!=='string')||
       (f.charged&&(!Number.isSafeInteger(f.weight)||f.weight<=0)))
      throw new MeterFailure('INVALID_CALL_GRAPH');
    m.set(f.name,f);
  }
  if(functions.some(f=>f.calls.some(c=>!m.has(c))))
    throw new MeterFailure('INVALID_CALL_GRAPH');
  const checked=new Set();
  function bad(name,path){
    if(m.get(name).charged)return false;
    if(path.has(name))return true;
    if(checked.has(name))return false;
    path.add(name);
    for(const c of m.get(name).calls)if(bad(c,path))return true;
    path.delete(name);checked.add(name);return false;
  }
  return !functions.some(f=>bad(f.name,new Set()));
}
/** Even an interruptible FFI wrapper can hang. Every hostile foreign call needs a kill boundary. */
export function admitUntrustedForeignCall({interruptible,isolation,deadlineEnforced}){
  if(typeof interruptible!=='boolean'||typeof deadlineEnforced!=='boolean')return false;
  return ['os-process','validated-wasm-isolate','hardware-compartment'].includes(isolation)&&deadlineEnforced;
}
