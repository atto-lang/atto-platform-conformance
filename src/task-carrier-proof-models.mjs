/**
 * Oreslang concurrency batch 03: SOURCE-FREE bounded safety reference models.
 *
 * NOT a compiler plugin, runtime execution, a forged guest Send/Sync proof,
 * or permission to launch max=3 actor carriers. Deliberately no I/O, timers,
 * threads, callbacks, source checkout, GitHub action, or guest state access.
 */
export const DOMAINS=Object.freeze([
  "CONTROL","PRIVATE","SHARED","UNTRUSTED","LIFECYCLE_OBSERVER"
]);
const DOMAIN_SET=new Set(DOMAINS);
const FAIL=(reason)=>{throw Error("BATCH03_DENIED: "+reason);};
const check=(truth,reason)=>{if(!truth)FAIL(reason);};
const uint=(n)=>Number.isSafeInteger(n)&&n>=0;
const identity=(v)=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9_:.@-]{0,95}$/.test(v);
function exact(obj,keys,label){
  check(obj!==null&&typeof obj==="object"&&!Array.isArray(obj) &&
    Object.keys(obj).sort().join("|") === [...keys].sort().join("|"),
    label+" fields");
}
function domain(value){check(DOMAIN_SET.has(value),"unknown execution domain");}
const frozen=(value)=>Object.freeze(value);

/**
 * Pure accounting oracle for N physical execution-carrier permits.
 * Acquiring reserves potential physical startup; only enter() publishes a
 * worker as usable. A worker releases only after actual loop exit.
 */
export class CarrierBudgetModel {
  #cap;
  #counts=new Map(DOMAINS.map(x=>[x,0]));
  #live=new Map();
  #serial=0;
  #closed=false;
  constructor(cap){
    check(Number.isSafeInteger(cap)&&cap>=5&&cap<=256,"global cap 5..256");
    this.#cap=cap;
  }
  #require(ticket){
    const entry=this.#live.get(ticket);
    check(entry!==undefined,"foreign, stale or retired carrier permit");
    return entry;
  }
  acquire(requested){
    domain(requested);
    check(!this.#closed,"carrier budget closed");
    const counts=new Map(this.#counts);
    counts.set(requested,counts.get(requested)+1);
    const total=[...counts.values()].reduce((a,b)=>a+b,0);
    const missing=DOMAINS.reduce((sum,x)=>sum+Math.max(0,1-counts.get(x)),0);
    if(this.#cap-total<missing)return null; // never park
    const ticket=frozen({permitSymbol:++this.#serial});
    this.#live.set(ticket,{domain:requested,entered:false});
    this.#counts.set(requested,counts.get(requested));
    return ticket;
  }
  enter(ticket){
    const state=this.#require(ticket);
    check(!state.entered,"worker entered twice");
    check(!this.#closed,"worker entered after shutdown seal");
    state.entered=true;
  }
  failStartup(ticket){
    const state=this.#require(ticket);
    check(!state.entered,"started workers must physically exit");
    this.#retire(ticket,state);
  }
  exit(ticket){
    const state=this.#require(ticket);
    check(state.entered,"cannot publish physical exit before loop enters");
    this.#retire(ticket,state);
  }
  #retire(ticket,state){
    this.#live.delete(ticket);
    this.#counts.set(state.domain,this.#counts.get(state.domain)-1);
  }
  seal(){this.#closed=true;}
  finished(){return this.#closed&&this.#live.size===0;}
  inspect(){
    const counts=Object.fromEntries(this.#counts);
    const entered=[...this.#live.values()].filter(x=>x.entered).length;
    return frozen({cap:this.#cap,counts:frozen(counts),
      total:this.#live.size,entered,pendingStartup:this.#live.size-entered,
      closed:this.#closed,shutdownComplete:this.finished()});
  }
}

/** Compiler-only structural auto-trait *model*. Unknown nominal/FFI: denied. */
export function deriveSendSync(type){
  const seen=new WeakSet();
  const recurse=(t,depth)=>{
    check(depth<=48,"auto trait recursion budget");
    check(t!==null&&typeof t==="object"&&!Array.isArray(t),"malformed type");
    check(!seen.has(t),"recursive/aliased type descriptor unsupported");
    seen.add(t);
    try {
      check(typeof t.kind==="string","type kind");
      const fields=Object.keys(t).sort().join("|");
      if(t.kind==="scalar"){
        check(fields==="kind|name" && ["bool","int","float","string"].includes(t.name),
          "non-core scalar type");
        return {send:true,sync:true};
      }
      if(t.kind==="opaque"||t.kind==="rc"||t.kind==="ffi"){
        if(t.kind==="opaque"||t.kind==="ffi")exact(t,["kind"],"opaque type");
        else exact(t,["kind","value"],"rc type");
        return {send:false,sync:false};
      }
      if(t.kind==="borrow"){
        exact(t,["kind","value","mutable"],"borrow type");
        check(typeof t.mutable==="boolean","borrow mutability");
        const inner=recurse(t.value,depth+1);
        return t.mutable?{send:false,sync:false}:
          {send:inner.sync,sync:inner.sync};
      }
      if(t.kind==="record"||t.kind==="tuple"){
        exact(t,["kind","items"],"compound type");
        check(Array.isArray(t.items)&&t.items.length<=64,"compound width");
        const traits=t.items.map(v=>recurse(v,depth+1));
        return {send:traits.every(x=>x.send),sync:traits.every(x=>x.sync)};
      }
      if(["option","list","arc","weak","mutex","rwlock","cell","refcell"].includes(t.kind)){
        exact(t,["kind","value"],"container type");
        const a=recurse(t.value,depth+1);
        if(t.kind==="arc"||t.kind==="weak")return {send:a.send&&a.sync,sync:a.send&&a.sync};
        if(t.kind==="mutex")return {send:a.send,sync:a.send};
        if(t.kind==="rwlock")return {send:a.send,sync:a.send&&a.sync};
        if(t.kind==="cell"||t.kind==="refcell")return {send:a.send,sync:false};
        return a;
      }
      FAIL("unknown trait type, not guest-safe");
    }finally{seen.delete(t);}
  };
  return frozen(recurse(type,0));
}

/**
 * Source-free lexical loan reservation oracle. Provenance and layout booleans
 * are *fixture data only*, never guest-supplied runtime authorization.
 */
export class ScopedLoanModel {
  #children=new Map();
  #generations=new Map();
  #owner=null;
  #sealed=false;
  #serial=0;
  static #place(place){
    exact(place,["domain","owner","allocation","generation","unique","path"],"loan place");
    check(identity(place.domain)&&identity(place.owner)&&
      uint(place.allocation)&&place.allocation>0&&
      uint(place.generation)&&place.generation>0&&
      typeof place.unique==="boolean","loan provenance");
    check(Array.isArray(place.path)&&place.path.length<=32,"loan projection budget");
    for(const p of place.path){
      if(p.kind==="field"){
        exact(p,["kind","name","proven"],"field projection");
        check(identity(p.name)&&typeof p.proven==="boolean","field layout");
      }else if(p.kind==="range"){
        exact(p,["kind","from","to","proven"],"range projection");
        check(uint(p.from)&&uint(p.to)&&p.to>p.from &&
          typeof p.proven==="boolean","range layout");
      }else FAIL("unknown loan projection");
    }
  }
  static #mayAlias(a,b){
    if(a.domain!==b.domain||a.owner!==b.owner)return true;
    if(a.allocation!==b.allocation)return !(a.unique&&b.unique);
    if(a.generation!==b.generation)return true;
    const provenAncestor=(path,index)=>path.slice(0,index).every(x=>x.proven);
    for(let i=0;i<Math.min(a.path.length,b.path.length);i++){
      const x=a.path[i],y=b.path[i];
      if(x.kind!==y.kind)return true;
      if(x.kind==="field"){
        if(x.name!==y.name)return !(x.proven&&y.proven&&
          provenAncestor(a.path,i)&&provenAncestor(b.path,i));
        if(!x.proven||!y.proven)return true;
      }else{
        if((x.to<=y.from||y.to<=x.from) && x.proven&&y.proven&&
          provenAncestor(a.path,i)&&provenAncestor(b.path,i))return false;
        if(x.from!==y.from||x.to!==y.to||!x.proven||!y.proven)return true;
      }
    }
    return true;
  }
  static conflicts(a,b){
    ScopedLoanModel.#place(a.place);ScopedLoanModel.#place(b.place);
    check(["READ","WRITE"].includes(a.mode)&&["READ","WRITE"].includes(b.mode),
      "loan access mode");
    if(a.place.domain!==b.place.domain||a.place.owner!==b.place.owner)return true;
    return (a.mode==="WRITE"||b.mode==="WRITE") &&
      ScopedLoanModel.#mayAlias(a.place,b.place);
  }
  admit(claims){
    check(!this.#sealed,"TaskScope sealed");
    check(Array.isArray(claims)&&claims.length<=128,"loan claim budget");
    check(this.#children.size<512,"child Task budget");
    let owner=this.#owner;const generations=new Map(this.#generations);
    for(const c of claims){
      exact(c,["place","mode","type"],"Task capture");
      ScopedLoanModel.#place(c.place);
      check(["READ","WRITE"].includes(c.mode),"Task capture mode");
      // This is the declared referent value type. Lifetime/owner/capture
      // authority still must come from the real compiler.
      const traits=deriveSendSync(c.type);
      // A shared &T being Send does not confer a mutable write capability.
      check(c.mode!=="WRITE"||c.type.kind!=="borrow",
        "borrowed referent is not mutable Task write authority");
      check(c.mode==="READ"?traits.sync:traits.send,"Send/Sync Task capture");
      const o=c.place.domain+"|"+c.place.owner;
      if(owner===null)owner=o;
      check(owner===o,"mixed Task owner/domain");
      const key=o+"|"+c.place.allocation;
      if(generations.has(key))check(generations.get(key)===c.place.generation,
        "stale allocation generation");
      generations.set(key,c.place.generation);
      for(const state of this.#children.values()){
        for(const prior of state.claims)
          check(!ScopedLoanModel.conflicts(c,prior),"overlapping live child loan");
      }
    }
    for(let i=0;i<claims.length;i++)
      for(let j=0;j<i;j++)
        check(!ScopedLoanModel.conflicts(claims[i],claims[j]),
          "overlapping loan inside one Task");
    check(generations.size<=8192,"allocation ledger budget");
    // All-or-none commit after every proof has passed.
    this.#owner=owner;this.#generations=generations;
    const ticket=frozen({loanSymbol:++this.#serial});
    this.#children.set(ticket,{claims:[...claims],cancel:false});
    return ticket;
  }
  #child(ticket){
    const child=this.#children.get(ticket);
    check(child!==undefined,"foreign/stale Task loan");
    return child;
  }
  cancel(ticket){this.#child(ticket).cancel=true;}
  cancellationRequested(ticket){return this.#child(ticket).cancel;}
  quiescent(ticket){this.#child(ticket);this.#children.delete(ticket);}
  parentMayAccess(c){
    exact(c,["place","mode","type"],"parent claim");
    ScopedLoanModel.#place(c.place);
    check(["READ","WRITE"].includes(c.mode),"parent access mode");
    if(this.#sealed)return false;
    const owner=c.place.domain+"|"+c.place.owner;
    if(owner!==this.#owner)return false;
    if(this.#generations.get(owner+"|"+c.place.allocation)!==c.place.generation)
      return false;
    const t=deriveSendSync(c.type);
    if(c.mode==="WRITE"&&c.type.kind==="borrow")return false;
    if(!(c.mode==="READ"?t.sync:t.send))return false;
    return ![...this.#children.values()].some(x=>x.claims.some(y=>
      ScopedLoanModel.conflicts(c,y)));
  }
  structuralBarrier(place,nextGeneration){
    ScopedLoanModel.#place(place);
    check(!this.#sealed,"sealed structural barrier");
    check(uint(nextGeneration)&&nextGeneration>place.generation,
      "generation must increase");
    const owner=place.domain+"|"+place.owner;
    check(owner===this.#owner,"foreign structural authority");
    const key=owner+"|"+place.allocation;
    check(this.#generations.get(key)===place.generation,"stale structural generation");
    for(const state of this.#children.values())
      for(const claim of state.claims)
        check(!ScopedLoanModel.#mayAlias({...place,path:[]},claim.place),
          "layout mutation while aliasing Task loan live");
    this.#generations.set(key,nextGeneration);
  }
  finish(){
    check(this.#children.size===0,"scope finish before physical Task quiescence");
    this.#sealed=true;this.#owner=null;this.#generations.clear();
  }
  inspect(){return frozen({active:this.#children.size,sealed:this.#sealed,
    recordedAllocations:this.#generations.size});}
}

/**
 * Abstract sealed actor-state RW admission, not guest callbacks. Allows 1 or
 * 3 simultaneous logical read turns; never concurrently grants a writer.
 * STOP fences the queue before awaiting physical callback retirement.
 */
export class ActorStateRwModel {
  #actor;#epoch;#max;#requests=[];#live=new Map();#serial=0;#stopped=false;
  constructor({actor,epoch,maxThreads=1}={}){
    check(identity(actor)&&uint(epoch)&&epoch>0,"actor incarnation");
    check(maxThreads===1||maxThreads===3,"actor max carrier capacity");
    this.#actor=actor;this.#epoch=epoch;this.#max=maxThreads;
  }
  request(mode,turn,epoch=this.#epoch){
    check(["READ","WRITE"].includes(mode)&&identity(turn),"actor RW request");
    check(epoch===this.#epoch && !this.#stopped,"stale/stopped actor generation");
    check(!this.#requests.some(x=>x.turn===turn)&&
      ![...this.#live.values()].some(x=>x.turn===turn),"duplicate continuation turn");
    check(this.#requests.length+this.#live.size<1024,"actor RW queue capacity");
    const ticket=frozen({actorRwSymbol:++this.#serial});
    this.#requests.push({mode,turn,ticket,epoch});this.#grant();
    return ticket;
  }
  #grant(){
    if(this.#stopped)return;
    while(this.#requests.length && this.#live.size<this.#max){
      const next=this.#requests[0];
      const writerLive=[...this.#live.values()].some(x=>x.mode==="WRITE");
      if(writerLive || (next.mode==="WRITE"&&this.#live.size!==0))break;
      this.#requests.shift();this.#live.set(next.ticket,next);
      if(next.mode==="WRITE")break;
    }
  }
  status(ticket){
    if(this.#live.has(ticket))return "ACTIVE";
    if(this.#requests.some(x=>x.ticket===ticket))return "QUEUED";
    return "STALE";
  }
  release(ticket){
    check(this.#live.has(ticket),"only physically retiring active ticket may release");
    this.#live.delete(ticket);this.#grant();
  }
  cancelQueued(ticket){
    const i=this.#requests.findIndex(x=>x.ticket===ticket);
    check(i>=0,"cannot cancel a granted or stale actor loan");
    this.#requests.splice(i,1);this.#grant();
  }
  suspend(ticket){
    // Holding any actor state loan across an await is forbidden until the
    // compiler can prove a pinned suspension-safe loan and fresh resume.
    check(this.#live.has(ticket),"suspension without active actor loan");
    FAIL("actor state loan cannot cross await/select/IO");
  }
  stop(){
    this.#stopped=true;this.#requests.length=0;
  }
  finished(){return this.#stopped&&this.#live.size===0;}
  inspect(){
    const active=[...this.#live.values()];
    const writers=active.filter(x=>x.mode==="WRITE").length;
    check(writers<=1&&(writers===0||active.length===1)&&active.length<=this.#max,
      "actor RW grant invariant violated");
    return frozen({actor:this.#actor,epoch:this.#epoch,maxThreads:this.#max,
      active:active.length,writers,queued:this.#requests.length,
      stopped:this.#stopped,physicallyRetired:this.finished()});
  }
}
