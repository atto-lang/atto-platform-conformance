/**
 * Source-free security reference oracles, not production runtime authorization.
 * All issuer/clock/scope inputs in these fixtures must be trusted host inputs
 * in a real backend. None of these models grants NETWORK or CONTROL to guest.
 */
const DENY = s => { throw Error("SECURITY_ORACLE_DENY: " + s); };
const check = (ok,s) => { if(!ok) DENY(s); };
const strict = (x, keys, s) => check(x && typeof x==="object" && !Array.isArray(x)
    && Object.keys(x).sort().join("|") === [...keys].sort().join("|"), s+" fields");
const positive = v => Number.isSafeInteger(v) && v>0;
const nonnegative = v => Number.isSafeInteger(v) && v>=0;
const ident = s => typeof s==="string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(s);
const NS = 1000000000n;

/**
 * Atomic multi-scope supervisor/lineage/tenant model. Token bucket credits
 * are charged on committed admission and NEVER refunded by cancellation.
 * Only pending/physical message credits are retired on completion.
 */
export class HierarchicalOutboundQuotaModel {
  #scopes;#leases=new Map();#count=0;#closed=false;#incarnation=1;
  constructor(scopes){
    check(Array.isArray(scopes)&&scopes.length===4,"four owned quota scopes");
    check(scopes.every(s=>s!==null&&typeof s==="object"),"quota descriptor");
    const required=new Set(["actor","lineage","supervisor","tenant"]);
    const seen=new Set();
    this.#scopes=scopes.map(s=>{
      strict(s,["kind","id","ratePerSecond","burst","bytesPerSecond","byteBurst","maxOutstanding"],"scope");
      check(required.has(s.kind)&&ident(s.id)&&!seen.has(s.kind),"scope owner");
      seen.add(s.kind);
      for(const key of ["ratePerSecond","burst","bytesPerSecond","byteBurst","maxOutstanding"])
        check(positive(s[key])&&s[key]<=10000000,"bounded quota settings");
      return {kind:s.kind,id:s.id,rate:s.ratePerSecond,burst:s.burst,
        bytesRate:s.bytesPerSecond,bytesBurst:s.byteBurst,limit:s.maxOutstanding,
        tokens:BigInt(s.burst)*NS,bytes:BigInt(s.byteBurst)*NS,
        active:0,at:0n};
    });
    check(seen.size===4,"missing quota ancestor");
  }
  #time(now){
    check(typeof now==="bigint"&&now>=0n&&now<=BigInt(Number.MAX_SAFE_INTEGER)*NS,
      "trusted monotonic clock required");
  }
  #refill(s,now){
    check(now>=s.at,"monotonic clock rollback denied");
    const elapsed=now-s.at;
    s.tokens=s.tokens+BigInt(s.rate)*elapsed;
    s.bytes=s.bytes+BigInt(s.bytesRate)*elapsed;
    const maxTokens=BigInt(s.burst)*NS,maxBytes=BigInt(s.bytesBurst)*NS;
    if(s.tokens>maxTokens)s.tokens=maxTokens;
    if(s.bytes>maxBytes)s.bytes=maxBytes;
    s.at=now;
  }
  admit(bytes,now){
    check(!this.#closed,"closed quota gate");
    check(positive(bytes)&&bytes<=10000000,"preflight serialized size");
    this.#time(now);
    // Clock/identity validation and capacity checks precede *all* debits;
    // this is a pure reference oracle, not concurrent host synchronization.
    for(const s of this.#scopes)this.#refill(s,now);
    for(const s of this.#scopes){
      if(s.active>=s.limit)return {accepted:false,reason:"OUTSTANDING"};
      if(s.tokens<NS)return {accepted:false,reason:"RATE"};
      if(s.bytes<BigInt(bytes)*NS)return {accepted:false,reason:"BYTES"};
    }
    check(this.#count<Number.MAX_SAFE_INTEGER,"lease generation exhausted");
    const lease=Object.freeze({quotaLease:++this.#count});
    for(const s of this.#scopes){s.tokens-=NS;s.bytes-=BigInt(bytes)*NS;s.active++;}
    this.#leases.set(lease,{incarnation:this.#incarnation,done:false});
    return {accepted:true,lease};
  }
  finish(lease){
    const entry=this.#leases.get(lease);
    check(entry&&!entry.done,"foreign/duplicate quota credit release");
    entry.done=true;this.#leases.delete(lease);
    for(const s of this.#scopes){check(s.active>0,"quota accounting underflow");s.active--;}
  }
  restart(){
    check(!this.#closed,"closed lineage");
    check(this.#incarnation<Number.MAX_SAFE_INTEGER,"lineage epoch exhausted");
    // Preserve token balances and ancestor credits across reincarnation.
    this.#incarnation++;
  }
  stop(){
    this.#closed=true;
    // Outstanding physical operations retain credits until broker closes.
  }
  inspect(){
    return Object.freeze({incarnation:this.#incarnation,closed:this.#closed,
      outstanding:this.#leases.size,scopes:this.#scopes.map(s=>Object.freeze({
        kind:s.kind,id:s.id,active:s.active,
        tokenWhole:Number(s.tokens/NS),bytesWhole:Number(s.bytes/NS)}))});
  }
}

/** Abstract trusted per-open-description FD capability/duplication registry. */
export class TrustedFdAliasModel {
  #next=0;#handles=new Map();#watches=new Map();#cap=new Map();#numbers=new Map();
  #limit;
  constructor(limit=64){check(positive(limit)&&limit<=4096,"FD watcher capacity");this.#limit=limit;}
  open(fd){
    check(nonnegative(fd)&&fd<=1048576,"invalid OS fd");
    const handle=Object.freeze({fdHandle:++this.#next});
    const description=Object.freeze({openDescription:this.#next});
    this.#handles.set(handle,{fd,description,closed:false});
    return handle;
  }
  duplicate(handle,newFd){
    const old=this.#require(handle);check(!old.closed,"duplicate closed handle");
    check(nonnegative(newFd)&&newFd<=1048576,"invalid dup fd");
    const next=Object.freeze({fdHandle:++this.#next});
    this.#handles.set(next,{fd:newFd,description:old.description,closed:false});
    return next;
  }
  #require(handle){
    const v=this.#handles.get(handle);
    check(v!==undefined,"foreign FD capability");
    return v;
  }
  watch(handle){
    const v=this.#require(handle);
    check(!v.closed,"closed FD capability");
    check(this.#watches.size<this.#limit,"FD watcher capacity exhausted");
    check(!this.#cap.has(v.description),"duplicated open-file description watch");
    check(!this.#numbers.has(v.fd),"same numeric FD already watched");
    const t=Object.freeze({watchTicket:++this.#next});
    this.#watches.set(t,{description:v.description,fd:v.fd});
    this.#cap.set(v.description,t);this.#numbers.set(v.fd,t);return t;
  }
  retire(ticket){
    const r=this.#watches.get(ticket);
    check(r,"foreign/double watcher retirement");
    this.#watches.delete(ticket);
    this.#cap.delete(r.description);this.#numbers.delete(r.fd);
  }
  close(handle){
    const v=this.#require(handle);
    check(!this.#cap.has(v.description),"close while alias capability is watched");
    // Closed numeric handles do not retain an unbounded host object tombstone.
    // The opaque handle identity is never reused even when its integer FD is.
    this.#handles.delete(handle);
  }
  inspect(){return Object.freeze({watches:this.#watches.size,
    identities:this.#cap.size,numbers:this.#numbers.size});}
}

/** Nominal guest command alone is never trusted supervisor CONTROL. */
export class TrainingControlModel {
  #actor;#incarnation=1;#run=1;#step=0;#weightVersion=1;
  #permit;#stopped=false;
  constructor(actor){check(ident(actor),"ML actor");this.#actor=actor;this.#rotate();}
  #rotate(){this.#permit=Object.freeze({controlAuthority:this.#incarnation});}
  controlAuthorityForHost(){return this.#permit;} // fixture: runtime-only, not a guest API
  data(command){
    check(!this.#stopped,"actor stopped");
    strict(command,["kind","run","incarnation","step"],"ML DATA");
    check(command.kind==="Gradient"||command.kind==="Forward","untrusted CONTROL in DATA");
    check(command.run===this.#run && command.incarnation===this.#incarnation
      && command.step===this.#step,"stale ML DATA epoch");
    return true;
  }
  commit(auth,{run,incarnation,expectedVersion,step}){
    check(!this.#stopped&&auth===this.#permit,"missing supervisor CONTROL authority");
    check(run===this.#run&&incarnation===this.#incarnation&&
      expectedVersion===this.#weightVersion&&step===this.#step,
      "stale ML optimizer publication");
    check(this.#weightVersion<Number.MAX_SAFE_INTEGER,"version overflow");
    this.#weightVersion++;this.#step++;return this.inspect();
  }
  restart(){
    check(this.#incarnation<Number.MAX_SAFE_INTEGER&&
      this.#run<Number.MAX_SAFE_INTEGER,"ML restart overflow");
    this.#incarnation++;this.#run++;this.#step=0;this.#weightVersion=1;
    this.#stopped=false;this.#rotate();
  }
  stop(auth){check(auth===this.#permit,"CONTROL required");this.#stopped=true;}
  inspect(){return Object.freeze({actor:this.#actor,incarnation:this.#incarnation,
    run:this.#run,step:this.#step,weightVersion:this.#weightVersion,
    stopped:this.#stopped});}
}

/** Unsupported native/Java transport actor modes remain fail-closed. */
export function transportActorAdmission(descriptor){
  strict(descriptor,["transport","role","serial","requires","with"],"transport declaration");
  check(typeof descriptor.serial==="boolean" && Array.isArray(descriptor.requires)
    && Array.isArray(descriptor.with),"transport syntax");
  check(descriptor.requires.every(ident)&&descriptor.with.every(ident),
    "unvalidated capabilities");
  check(["mail","http","ipc","tcp","ffi","proxy","websocket"].includes(descriptor.transport),
    "unknown transport mode");
  check(["actor","unary","stream"].includes(descriptor.role),"unknown actor role");
  if(descriptor.transport!=="mail"||descriptor.role!=="actor"||
    descriptor.serial||descriptor.requires.length||descriptor.with.length){
    return Object.freeze({status:"UNSUPPORTED",guestExecution:"DENIED",
      reason:"NO_AUTHENTICATED_LOWERING"});
  }
  return Object.freeze({status:"LOCAL_MAIL_ONLY",guestExecution:"REFERENCE_NOT_PROOF"});
}
