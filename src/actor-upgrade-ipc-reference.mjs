/**
 * Source-free bounded model for Oreslang hot upgrade and IPC receipt semantics.
 * NOT guest compiler/runtime, code loading, cryptographic transport authentication,
 * or an executable supervisor implementation.
 */
const SHA=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;
const error=m=>{throw Error("BATCH04_DENIED: "+m)};
const requireOk=(c,m)=>{if(!c)error(m)};
const pos=n=>Number.isSafeInteger(n)&&n>0;
const validId=x=>typeof x==="string"&&ID.test(x);
const validSha=x=>typeof x==="string"&&SHA.test(x);
function fields(x,names,label){
  requireOk(x!==null&&typeof x==="object"&&!Array.isArray(x)&&
    Object.keys(x).sort().join("|")===names.slice().sort().join("|"),label+" shape");
}
const pinKinds=new Set(["DATA","AWAIT","FFI","TIMER","CALLBACK","UNWIND"]);
const token=i=>Object.freeze({identity:i});

/**
 * Code-only upgrade retains actor logical ID, incarnation and mailbox
 * identity. Quiescence includes every suspendable code/FFI root.
 */
export class HotUpgradeGate {
  #actor;#kind;#inc=1;#route=1;#codeGeneration=1;
  #active;#pins=new Map();#serial=0;#frozen=false;#staged=null;#closed=false;
  constructor(image){
    fields(image,["actor","kind","code","abi","state","shared","policy"],"initial image");
    requireOk(validId(image.actor),"actor ID");
    requireOk(["SHARED","PRIVATE","UNTRUSTED"].includes(image.kind),"kind");
    for(const k of ["code","abi","state","shared","policy"])requireOk(validSha(image[k]),k);
    this.#actor=image.actor;this.#kind=image.kind;this.#active={...image};
  }
  identity(){return Object.freeze({actor:this.#actor,kind:this.#kind,
    incarnation:this.#inc,routeEpoch:this.#route,
    codeGeneration:this.#codeGeneration,code:this.#active.code});}
  acquire(kind){
    requireOk(!this.#frozen&&!this.#closed,"DATA admission frozen");
    requireOk(pinKinds.has(kind),"unknown native pin kind");
    requireOk(this.#pins.size<4096&&this.#serial<Number.MAX_SAFE_INTEGER,
      "pin budget/identity exhausted");
    const t=token(++this.#serial);
    this.#pins.set(t,{kind,code:this.#active.code});return t;
  }
  transfer(t,kind){
    const p=this.#pins.get(t);requireOk(p,"stale code pin");
    requireOk(pinKinds.has(kind),"unsupported suspended pin");
    p.kind=kind;
  }
  pinInfo(t){
    const p=this.#pins.get(t);requireOk(p,"foreign/retired code pin");
    return Object.freeze({...p});
  }
  release(t){requireOk(this.#pins.delete(t),"stale/double code release");}
  freeze(){requireOk(!this.#closed&&!this.#frozen,"duplicate freeze");this.#frozen=true;}
  stage(image){
    requireOk(this.#frozen&&!this.#staged&&!this.#closed,"stage outside unique freeze");
    fields(image,["kind","code","abi","state","shared","policy"],"candidate");
    requireOk(image.kind===this.#kind,"isolation placement mismatch");
    for(const k of ["code","abi","state","shared","policy"])requireOk(validSha(image[k]),k);
    for(const k of ["abi","state","shared","policy"])
      requireOk(image[k]===this.#active[k],"code-only schema/capability drift: "+k);
    requireOk(image.code!==this.#active.code,"duplicate code image");
    requireOk(this.#serial<Number.MAX_SAFE_INTEGER,"code stage ticket overflow");
    const t=token(++this.#serial);this.#staged={...image,t};return t;
  }
  abort(t){
    requireOk(this.#staged?.t===t&&this.#frozen,"foreign stage rollback");
    this.#staged=null;this.#frozen=false;
  }
  promote(t,expectedRoute){
    requireOk(this.#staged?.t===t&&this.#frozen&&!this.#closed,
      "foreign or stale code publication");
    requireOk(pos(expectedRoute)&&expectedRoute===this.#route,"route CAS mismatch");
    requireOk(this.#pins.size===0,"source code still pinned by in-flight turn");
    requireOk(this.#route<Number.MAX_SAFE_INTEGER&&
      this.#codeGeneration<Number.MAX_SAFE_INTEGER,"code epoch overflow");
    const {t:discard,...next}=this.#staged;
    this.#active={actor:this.#actor,...next};this.#staged=null;
    this.#route++;this.#codeGeneration++;this.#frozen=false;
    return this.identity();
  }
  restart(){
    requireOk(this.#frozen&&!this.#closed&&!this.#staged&&this.#pins.size===0,
      "restart before physical quiescence");
    requireOk(this.#inc<Number.MAX_SAFE_INTEGER&&this.#route<Number.MAX_SAFE_INTEGER,
      "actor incarnation overflow");
    this.#inc++;this.#route++;this.#frozen=false;return this.identity();
  }
  close(){
    requireOk(this.#pins.size===0&&!this.#staged,"close before code cleanup");
    this.#closed=true;this.#frozen=true;
  }
  inspect(){return Object.freeze({...this.identity(),pins:this.#pins.size,
    frozen:this.#frozen,staged:!!this.#staged,closed:this.#closed});}
}

/**
 * Local proxy admission, worker receive and terminal processing are distinct.
 * This is an at-most-once dispatch model. Receipts are synthetic correlations,
 * not proof of encrypted/signed network provenance.
 */
export class IpcReceiptLedger {
  #actor;#inc=1;#route=1;#session;#maxPending;#maxWire;
  #seq=0;#frame=0;#pending=new Map();#wire=0;
  constructor({actor,session,maxPending=64,maxTransport=8}={}){
    requireOk(validId(actor)&&validId(session),"IPC actor/session");
    requireOk(pos(maxPending)&&maxPending<=4096&&pos(maxTransport)&&
      maxTransport<=maxPending,"IPC credit bounds");
    this.#actor=actor;this.#session=session;
    this.#maxPending=maxPending;this.#maxWire=maxTransport;
  }
  admit(){
    if(this.#pending.size>=this.#maxPending)return null;
    requireOk(this.#seq<Number.MAX_SAFE_INTEGER,"IPC message sequence overflow");
    const seq=++this.#seq;
    this.#pending.set(seq,{state:"PROXY_ADMITTED",credit:false});
    return seq;
  }
  dispatch(seq){
    const record=this.#pending.get(seq);
    requireOk(record?.state==="PROXY_ADMITTED","double/foreign IPC dispatch");
    if(this.#wire>=this.#maxWire)return null;
    requireOk(this.#frame<Number.MAX_SAFE_INTEGER,"IPC frame sequence overflow");
    const receipt=Object.freeze({actor:this.#actor,incarnation:this.#inc,
      routeEpoch:this.#route,session:this.#session,logicalSequence:seq,
      frameSequence:++this.#frame});
    record.state="DISPATCHED";record.credit=true;record.receipt=receipt;this.#wire++;
    return receipt;
  }
  #matches(r){
    fields(r,["actor","incarnation","routeEpoch","session",
      "logicalSequence","frameSequence"],"IPC receipt");
    const record=this.#pending.get(r.logicalSequence);
    if(!record?.receipt)return false;
    const old=record.receipt;
    return old.actor===r.actor&&old.incarnation===r.incarnation&&
      old.routeEpoch===r.routeEpoch&&old.session===r.session&&
      old.logicalSequence===r.logicalSequence&&old.frameSequence===r.frameSequence&&
      r.incarnation===this.#inc&&r.routeEpoch===this.#route&&
      r.session===this.#session;
  }
  #release(r){
    if(r.credit){r.credit=false;this.#wire--;}
    requireOk(this.#wire>=0,"negative IPC transport credit");
  }
  received(r){
    if(!this.#matches(r))return false;
    const item=this.#pending.get(r.logicalSequence);
    if(item.state!=="DISPATCHED")return false;
    item.state="WORKER_RECEIVED";this.#release(item);return true;
  }
  terminal(r,kind){
    requireOk(["DONE","FAILED"].includes(kind),"IPC terminal kind");
    if(!this.#matches(r))return false;
    const item=this.#pending.get(r.logicalSequence);
    if(item.state!=="WORKER_RECEIVED")return false;
    this.#pending.delete(r.logicalSequence);return true;
  }
  loseSession(session,{restart=false}={}){
    requireOk(validId(session)&&session!==this.#session,"session rotation");
    requireOk(this.#route<Number.MAX_SAFE_INTEGER&&
      (!restart||this.#inc<Number.MAX_SAFE_INTEGER),"IPC epoch overflow");
    let ambiguous=0;
    for(const [seq,item] of this.#pending){
      if(["DISPATCHED","WORKER_RECEIVED"].includes(item.state)){
        this.#release(item);this.#pending.delete(seq);ambiguous++;
      }
    }
    this.#route++;if(restart)this.#inc++;
    this.#session=session;return ambiguous;
  }
  codeOnlyUpgrade(){
    requireOk(this.#route<Number.MAX_SAFE_INTEGER,"IPC route overflow");
    requireOk(![...this.#pending.values()].some(x=>
      ["DISPATCHED","WORKER_RECEIVED"].includes(x.state)),
      "unretired IPC message at route swap");
    this.#route++;
  }
  state(seq){return this.#pending.get(seq)?.state??"RETIRED";}
  inspect(){return Object.freeze({actor:this.#actor,incarnation:this.#inc,
    routeEpoch:this.#route,session:this.#session,sequence:this.#seq,
    pending:this.#pending.size,transport:this.#wire,
    maxPending:this.#maxPending,maxTransport:this.#maxWire});}
}

/** A failed dispatcher submission is never physical completion. */
export class StageDoneGate {
  #stages;#frames=0;#failure=null;#dispatchRejected=false;
  constructor(count){
    requireOk(pos(count)&&count<=1024,"bounded stages");
    this.#stages=new Set(Array.from({length:count},(_,i)=>i+1));
  }
  addFrame(){
    requireOk(this.#stages.size>0&&this.#frames<4096,
      "closed pipeline or route frame budget exceeded");
    this.#frames++;
  }
  retireFrame(){requireOk(this.#frames>0,"double route frame retirement");this.#frames--;}
  failed(stage,code){
    requireOk(this.#stages.has(stage)&&validId(code),"invalid stage failure");
    if(this.#failure===null)this.#failure=code;
  }
  rejectDispatch(){
    requireOk(this.#failure!==null,"dispatch rejection without failed stage");
    this.#dispatchRejected=true;
  }
  finalized(stage){requireOk(this.#stages.delete(stage),"double stage exit");}
  inspect(){
    const state=this.#stages.size||this.#frames?"PENDING":
      this.#failure===null?"DONE":"FAILED";
    return Object.freeze({state,liveStages:this.#stages.size,
      outstandingFrames:this.#frames,dispatchRejected:this.#dispatchRejected});
  }
}

/** Scratch must be admitted before transient binary encode/decode allocation. */
export class WireMemoryLedger {
  #scratchCap;#storedCap;#scratch=0;#stored=0;#serial=0;
  #encode=new Map();#frames=new Map();
  constructor({scratchCap,retainedCap}){
    requireOk(pos(scratchCap)&&pos(retainedCap),"wire byte budgets");
    this.#scratchCap=scratchCap;this.#storedCap=retainedCap;
  }
  reserve(n){
    requireOk(pos(n),"scratch preflight charge");
    if(n>this.#scratchCap-this.#scratch)return null;
    requireOk(this.#serial<Number.MAX_SAFE_INTEGER,"wire ticket overflow");
    const t=token(++this.#serial);this.#encode.set(t,n);this.#scratch+=n;return t;
  }
  commit(t,bytes){
    const initial=this.#encode.get(t);requireOk(initial!==undefined,"stale scratch ticket");
    requireOk(pos(bytes),"retained frame cost");
    if(bytes>this.#storedCap-this.#stored)return null;
    this.#encode.delete(t);this.#scratch-=initial;
    this.#frames.set(t,bytes);this.#stored+=bytes;return t;
  }
  abort(t){
    const initial=this.#encode.get(t);requireOk(initial!==undefined,"scratch release mismatch");
    this.#encode.delete(t);this.#scratch-=initial;
  }
  dequeue(t){
    const bytes=this.#frames.get(t);requireOk(bytes!==undefined,"duplicate frame release");
    this.#frames.delete(t);this.#stored-=bytes;
  }
  inspect(){return Object.freeze({scratch:this.#scratch,retained:this.#stored,
    encodes:this.#encode.size,frames:this.#frames.size,
    scratchCap:this.#scratchCap,retainedCap:this.#storedCap});}
}


/**
 * Model for one bounded ActorStream DATA edge.
 * request() is an abstract nonparking future registration, not a guest Future.
 * Successful queue commit consumes the sender-owned message exactly once.
 * Cancellation after commit cannot claw the message back from the recipient.
 */
export class EdgeCreditGate {
  #capacity;#waiterCap;#queued=[];#waiting=[];#seq=0;#sealed=false;
  #states=new Map();#completed=[];
  #terminal(t,state){
    this.#states.set(t,state);this.#completed.push(t);
    if(this.#completed.length>256)this.#states.delete(this.#completed.shift());
  }
  constructor({capacity,maxWaiters=64}={}){
    requireOk(pos(capacity)&&capacity<=4096&&pos(maxWaiters)&&maxWaiters<=4096,
      "bounded edge capacity");
    this.#capacity=capacity;this.#waiterCap=maxWaiters;
  }
  request(){
    requireOk(!this.#sealed,"edge admission sealed");
    if(this.#queued.length===this.#capacity&&
       this.#waiting.length>=this.#waiterCap)return null;
    requireOk(this.#seq<Number.MAX_SAFE_INTEGER,"edge admission ticket overflow");
    const t=token(++this.#seq);
    if(this.#waiting.length===0&&this.#queued.length<this.#capacity){
      this.#states.set(t,"COMMITTED");this.#queued.push(t);
    }else{
      this.#states.set(t,"WAITING");this.#waiting.push(t);
    }
    return t;
  }
  cancel(t){
    const state=this.#states.get(t);
    requireOk(state!==undefined,"foreign edge credit");
    if(state!=="WAITING")return false; // committed transfer irreversible
    const index=this.#waiting.indexOf(t);
    requireOk(index>=0,"edge wait queue corrupted");
    this.#waiting.splice(index,1);this.#terminal(t,"CANCELLED");
    return true;
  }
  dequeue(){
    requireOk(this.#queued.length>0,"edge credit underflow");
    const t=this.#queued.shift();
    requireOk(this.#states.get(t)==="COMMITTED","edge commit mismatch");
    this.#terminal(t,"DELIVERED");
    this.#promote();
    return t;
  }
  #promote(){
    if(this.#sealed)return;
    while(this.#waiting.length&&this.#queued.length<this.#capacity){
      const t=this.#waiting.shift();
      requireOk(this.#states.get(t)==="WAITING","waiter state mismatch");
      this.#states.set(t,"COMMITTED");this.#queued.push(t);
    }
  }
  stop(){
    this.#sealed=true;
    for(const t of this.#waiting)this.#terminal(t,"CANCELLED");
    this.#waiting.length=0;
    // Committed DATA remains counted until explicit dequeue/retirement.
  }
  retireCommitted(t){
    const index=this.#queued.indexOf(t);
    requireOk(index>=0&&this.#states.get(t)==="COMMITTED",
      "foreign/double edge retirement");
    this.#queued.splice(index,1);this.#terminal(t,"RETIRED");
    this.#promote();
  }
  status(t){return this.#states.get(t)??"UNKNOWN";}
  inspect(){return Object.freeze({queued:this.#queued.length,
    waiting:this.#waiting.length,tracked:this.#states.size,
    capacity:this.#capacity,maxWaiters:this.#waiterCap,sealed:this.#sealed});}
}
