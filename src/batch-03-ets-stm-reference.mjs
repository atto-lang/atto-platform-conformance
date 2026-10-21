/**
 * Source-free, bounded ETS and STM semantic reference models for tasks 25-27.
 * These execute only on injected fixture values; no Oreslang guest capability
 * is minted, no carrier thread is blocked, and no runtime API is enabled.
 */
function must(ok,why){if(!ok)throw Error("BATCH03_DENIED: "+why);}
const ident=x=>typeof x==="string"&&/^[A-Za-z][A-Za-z0-9_:.@-]{0,95}$/.test(x);
const safe=x=>x===null||typeof x==="boolean"||
 (typeof x==="number"&&Number.isSafeInteger(x))||
 (typeof x==="string"&&x.length<=256&&!/[\u0000-\u001f]/.test(x));
const key=x=>typeof x==="string"&&ident(x);
const exactly=(x,n,label)=>must(x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join("|")===n.slice().sort().join("|"),label+" fields");
function principal(x){
 exactly(x,["domain","actor","generation"],"principal");
 must(ident(x.domain)&&ident(x.actor)&&Number.isSafeInteger(x.generation)&&
  x.generation>0,"authenticated principal fixture");
 return x.domain+"|"+x.actor+"|"+x.generation;
}
function value(x){must(safe(x),"immutable scalar-only fixture payload");return x;}

/**
 * SET-only ETS contract (not bag/ordered_set). Opaque JS token identity
 * simulates trusted capabilities; caller-supplied principals are NOT
 * authenticated Oreslang actor identities.
 */
export class EtsSetReference {
 #table=new Map();#versions=new Map();#caps=new Map();#owner;#heir;#acl;#quota;#generation=1;
 #closed=false;#serial=0;
 constructor({owner,heir=null,access="private",maxEntries=64}={}){
  this.#owner=principal(owner);
  this.#heir=heir===null?null:principal(heir);
  must(heir===null||heir.domain===owner.domain,"ETS heir trust domain");
  must(["private","protected","public"].includes(access),"ETS ACL");
  must(Number.isSafeInteger(maxEntries)&&maxEntries>0&&maxEntries<=4096,"ETS quota");
  this.#acl=access;this.#quota=maxEntries;
 }
 issue(owner){ // called by a hypothetical *trusted* owner registry, never guest
  must(!this.#closed&&principal(owner)===this.#owner,"ETS owner mint");
  const cap=Object.freeze({etsCap:++this.#serial});
  this.#caps.set(cap,{principal:this.#owner,generation:this.#generation,privilege:"owner"});
  return cap;
 }
 delegate(ownerCap,owner,to){
  this.#auth(ownerCap,owner,"write");
  const p=principal(to);
  must(to.domain===owner.domain,"ETS cross-domain capability");
  if(this.#acl==="private")must(p===this.#owner,"private ETS cannot delegate");
  const cap=Object.freeze({etsCap:++this.#serial});
  this.#caps.set(cap,{principal:p,generation:this.#generation,
   privilege:p===this.#owner?"owner":this.#acl});
  return cap;
 }
 #nextVersion(k){
  const prior=this.#versions.get(k)||0;
  must(prior<Number.MAX_SAFE_INTEGER,"ETS entry generation exhausted");
  const next=prior+1;this.#versions.set(k,next);return next;
 }
 #auth(cap,who,op){
  const claim=this.#caps.get(cap),actor=principal(who);
  must(!this.#closed&&claim&&claim.generation===this.#generation&&
   claim.principal===actor,"stale, forged or foreign ETS capability");
  if(op==="write")must(claim.privilege==="owner"||claim.privilege==="public",
   "ETS write prohibited by protected/private ACL");
 }
 lookup(cap,actor,k){
  this.#auth(cap,actor,"read");must(key(k),"ETS key");
  return {present:this.#table.has(k),value:this.#table.get(k)??null,
   version:this.#versions.get(k)||0};
 }
 insert(cap,actor,k,v){
  this.#auth(cap,actor,"write");must(key(k),"ETS key");value(v);
  must(this.#table.has(k)||this.#table.size<this.#quota,"ETS entry quota");
  this.#nextVersion(k);this.#table.set(k,v);
 }
 insertNew(cap,actor,k,v){
  this.#auth(cap,actor,"write");must(key(k),"ETS key");value(v);
  if(this.#table.has(k))return false;
  must(this.#table.size<this.#quota,"ETS entry quota");
  this.#nextVersion(k);this.#table.set(k,v);return true;
 }
 compareExchange(cap,actor,k,expected,updated){
  this.#auth(cap,actor,"write");must(key(k),"ETS key");value(expected);value(updated);
  if(!this.#table.has(k)||!Object.is(this.#table.get(k),expected))return false;
  this.#nextVersion(k);this.#table.set(k,updated);return true;
 }
 /** Versioned CAS is the ABA-aware shape required by a real ETS ABI. */
 compareExchangeVersioned(cap,actor,k,expected,version,updated){
  this.#auth(cap,actor,"write");must(key(k),"ETS key");
  value(expected);value(updated);
  must(Number.isSafeInteger(version)&&version>0,"ETS CAS version");
  if(!this.#table.has(k)||!Object.is(this.#table.get(k),expected)||
     this.#versions.get(k)!==version)return false;
  this.#nextVersion(k);this.#table.set(k,updated);return true;
 }
 take(cap,actor,k){
  this.#auth(cap,actor,"write");must(key(k),"ETS key");
  if(!this.#table.has(k))return {present:false,value:null};
  const result=this.#table.get(k);
  this.#nextVersion(k);this.#table.delete(k);return {present:true,value:result};
 }
 snapshot(cap,actor){
  this.#auth(cap,actor,"read");
  must(this.#table.size<=this.#quota,"ETS snapshot quota");
  return Object.freeze([...this.#table.entries()].map(([k,v])=>Object.freeze([k,v])));
 }
 ownerExit(owner){
  must(!this.#closed&&principal(owner)===this.#owner,"ETS owner exit authority");
  ++this.#generation;this.#caps.clear();
  if(this.#heir===null){this.#closed=true;this.#table.clear();return null;}
  this.#owner=this.#heir;this.#heir=null;
  const cap=Object.freeze({etsCap:++this.#serial});
  this.#caps.set(cap,{principal:this.#owner,generation:this.#generation,privilege:"owner"});
  return cap;
 }
 inspect(){return {closed:this.#closed,entries:this.#table.size,
  generation:this.#generation,liveCaps:this.#caps.size,
  guestApiVerified:false};}
}

/**
 * STM reference: transaction is immutable declarative data, NOT a retryable
 * user callback. Read-version validation and staged writes are one JS turn.
 * No claim of atomicity between hosts, workers, processes or Oreslang actors.
 */
export class StmReference {
 #refs=new Map();#serial=0;
 create(initial){
  value(initial);const ref=Object.freeze({tref:++this.#serial});
  this.#refs.set(ref,{value:initial,version:1});return ref;
 }
 #get(ref){const x=this.#refs.get(ref);must(x!==undefined,"foreign TRef");return x;}
 snapshot(ref){const x=this.#get(ref);return Object.freeze({value:x.value,version:x.version});}
 commit({reads,writes,effects=[]}={}){
  must(Array.isArray(reads)&&reads.length>0&&reads.length<=128,"bounded STM read set");
  must(Array.isArray(writes)&&writes.length<=128&&Array.isArray(effects)&&
    effects.every(e=>["stm-read","stm-write","pure-compute"].includes(e)),
    "retryable STM effect admission");
  const expected=new Map();
  for(const r of reads){
   exactly(r,["ref","version"],"STM read");
   const x=this.#get(r.ref);
   must(Number.isSafeInteger(r.version)&&r.version>0&&!expected.has(r.ref),
    "invalid/duplicate STM read");
   expected.set(r.ref,r.version);
  }
  const updates=new Map();
  for(const w of writes){
   exactly(w,["ref","value"],"STM write");
   this.#get(w.ref);value(w.value);
   must(expected.has(w.ref)&&!updates.has(w.ref),"STM write without checked read");
   updates.set(w.ref,w.value);
  }
  for(const [ref,v] of expected)
   if(this.#get(ref).version!==v)
    return Object.freeze({status:"CONFLICT_RETRY_REQUIRED",committed:false});
  for(const ref of updates.keys())
   must(this.#get(ref).version<Number.MAX_SAFE_INTEGER,"STM version exhausted");
  for(const [ref,newValue] of updates){
   const target=this.#get(ref);target.value=newValue;target.version++;
  }
  return Object.freeze({status:"COMMITTED_REFERENCE_ONLY",committed:true,
    changed:updates.size,guestExecutionVerified:false});
 }
 inspect(){return {referenceCount:this.#refs.size,guestStmVerified:false};}
}
