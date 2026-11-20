/**
 * REQUEST_ACTOR_TASK_CONTEXT_V1 — source-free model, NOT scheduler authority.
 *
 * The request lifetime belongs to its generation-checked slot and leases.
 * The carrier binding is a temporary lookup convenience, never storage.
 * All methods here represent TRUSTED runtime calls, not guest APIs.
 */
const invalid=msg=>{throw new Error('INVALID_REQUEST_CONTEXT_MODEL: '+msg);};
const isPlain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  (Object.getPrototypeOf(o)===Object.prototype||Object.getPrototypeOf(o)===null)&&
  Object.values(Object.getOwnPropertyDescriptors(o)).every(d=>Object.hasOwn(d,'value'));
const id=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(s);
const validInt=n=>Number.isSafeInteger(n)&&n>0;
const immutableMeta=x=>{
  if(!isPlain(x)||
     Reflect.ownKeys(x).some(k=>typeof k!=='string'||
       !['request_id','trace_id','tenant_id','deadline_tick'].includes(k)))
    invalid('unknown request metadata');
  if(!id(x.request_id)||!id(x.trace_id)||!id(x.tenant_id)||
     !validInt(x.deadline_tick))invalid('malformed request metadata');
  return Object.freeze({...x});
};
const ownerKey=o=>{
  if(!isPlain(o)||
    Reflect.ownKeys(o).length!==3||!validInt(o.domain)||
    !validInt(o.slot)||!validInt(o.generation))invalid('actor owner');
  return [o.domain,o.slot,o.generation].join('/');
};
const key=h=>isPlain(h)&&validInt(h.slot)&&validInt(h.generation)&&
  Reflect.ownKeys(h).length===2;

export class RequestContextScopeModel {
  #slots;#free;#carrier=new Map();#nextLease=1;#leases=new Map();#liveRequests=new Set();
  constructor(capacity=16) {
    if(!validInt(capacity)||capacity>128)invalid('bounded capacity 1..128');
    this.#slots=Array.from({length:capacity},()=>({
      generation:0,phase:'FREE',owner:null,meta:null,leases:0
    }));
    this.#free=Array.from({length:capacity},(_,i)=>capacity-i-1);
  }
  #lookup(h) {
    if(!key(h)||h.slot>this.#slots.length)return null;
    const s=this.#slots[h.slot-1];
    return s.generation===h.generation && s.phase!=='FREE'&&s.phase!=='RETIRED'?s:null;
  }
  #recycle(h,s) {
    if(s.leases) return;
    if(s.phase!=='CLOSING')invalid('recycle while active');
    this.#liveRequests.delete(s.meta.tenant_id+"/"+s.meta.request_id);
    s.owner=null;s.meta=null;
    if(s.generation===Number.MAX_SAFE_INTEGER){s.phase='RETIRED';return;}
    s.phase='FREE';this.#free.push(h.slot-1);
  }
  #hold(h,s) {
    if(s.phase!=='OPEN')invalid('request is closed or cancelled');
    const lease=this.#nextLease++;
    if(!Number.isSafeInteger(lease))invalid('lease generation exhausted');
    s.leases++;this.#leases.set(lease,{slot:h.slot,generation:h.generation});
    return lease;
  }
  #release(lease) {
    const h=this.#leases.get(lease);
    if(!h)invalid('unknown or duplicate lease release');
    const s=this.#lookup(h);
    if(!s||s.leases<1)invalid('stale lifetime lease');
    this.#leases.delete(lease);s.leases--;
    if(s.phase==='CLOSING'&&s.leases===0)this.#recycle(h,s);
  }
  create(actor,metadata){
    const owner=ownerKey(actor),meta=immutableMeta(metadata);
    const requestKey=meta.tenant_id+"/"+meta.request_id;
    if(this.#liveRequests.has(requestKey))
      invalid('duplicate live tenant/request identity');
    if(!this.#free.length)return null; // bounded admission failure
    const idx=this.#free.pop(),s=this.#slots[idx];
    if(s.phase!=='FREE'||s.generation===Number.MAX_SAFE_INTEGER)
      invalid('slot reuse invariant');
    s.generation++;s.phase='OPEN';s.owner=owner;s.meta=meta;s.leases=0;
    this.#liveRequests.add(requestKey);
    return Object.freeze({slot:idx+1,generation:s.generation});
  }
  // Trusted scheduler may call this only after actor-incarnation/turn admission.
  // The boolean is a MODEL precondition, not a cryptographic authority proof.
  with_turn(handle,actor,carrierId,admitted,callback) {
    if(!id(carrierId)||admitted!==true||typeof callback!=='function')
      invalid('missing trusted scheduler admission');
    const s=this.#lookup(handle);
    if(!s||s.phase!=='OPEN'||s.owner!==ownerKey(actor))
      invalid('stale or foreign request/actor incarnation');
    const lease=this.#hold(handle,s);
    const previous=this.#carrier.get(carrierId)||null;
    const frame={handle,owner:s.owner,lease,previous};
    this.#carrier.set(carrierId,frame);
    try {
      const result=callback();
      if(result&&typeof result.then==='function')
        invalid('physical carrier scope cannot escape through await');
      return result;
    } finally {
      if(this.#carrier.get(carrierId)!==frame)
        invalid('carrier binding corrupted');
      if(previous)this.#carrier.set(carrierId,previous);
      else this.#carrier.delete(carrierId);
      this.#release(lease);
    }
  }
  current(carrierId) {
    const frame=this.#carrier.get(carrierId);
    if(!frame)return null;
    const s=this.#lookup(frame.handle);
    return s&&s.phase==='OPEN'&&s.owner===frame.owner?s.meta:null;
  }
  // An owned structured descendant keeps request storage live until exit.
  retain_child(handle,actor) {
    const s=this.#lookup(handle);
    if(!s||s.owner!==ownerKey(actor))invalid('invalid child request authority');
    return this.#hold(handle,s);
  }
  release_child(lease){this.#release(lease);}
  // Cancellation/response terminality blocks new lookups or continuations.
  close(handle,actor){
    const s=this.#lookup(handle);
    if(!s||s.phase!=='OPEN'||s.owner!==ownerKey(actor))
      return false;
    s.phase='CLOSING';this.#recycle(handle,s);return true;
  }
  // Diagnostics only. Neither a cancelled turn nor a detached callback is
  // permission to destroy an actor's heap.
  status(handle){
    const s=this.#lookup(handle);
    return s?Object.freeze({phase:s.phase,leases:s.leases}):null;
  }
  get available(){return this.#free.length;}
  get live_leases(){return this.#leases.size;}
}
