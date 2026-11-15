/**
 * Source-free, deterministic Atto actor execution oracle.
 * NOT a compiler, native-runtime test, scheduler, or evidence of five-backend parity.
 */
const fail = message => { throw new Error('INVALID_ACTOR_EXECUTION: ' + message); };
const ident = x => typeof x === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(x);
const size = (x, low, high) => Number.isSafeInteger(x) && x >= low && x <= high;
const requireId = (x, field) => { if (!ident(x)) fail(field); };
const requireEpoch = e => { if (!size(e, 1, 0x7fffffff)) fail('epoch'); };

export class ActorProtocolOracle {
  constructor({id, epoch=1, dataCapacity=4, controlCapacity=4, states, initial, transitions}) {
    requireId(id, 'actor ID'); requireEpoch(epoch);
    if (!size(dataCapacity, 1, 32) || !size(controlCapacity, 1, 4)) fail('capacity');
    if (!Array.isArray(states) || states.length < 1 || states.length > 32 ||
        states.some(s => !ident(s)) || new Set(states).size !== states.length ||
        !states.includes(initial)) fail('state set');
    if (!Array.isArray(transitions) || transitions.length > 128) fail('transitions');
    this.states = new Set(states);
    this.transitions = new Map();
    for (const t of transitions) {
      if (!t || Object.keys(t).sort().join() !== 'event,from,to' ||
          !states.includes(t.from) || !states.includes(t.to) || !ident(t.event)) fail('transition');
      const key = t.from + '/' + t.event;
      if (this.transitions.has(key)) fail('ambiguous transition');
      this.transitions.set(key, t.to);
    }
    this.id=id; this.epoch=epoch; this.dataCapacity=dataCapacity;
    this.controlCapacity=controlCapacity; this.state=initial;
    this.data=[]; this.control=[]; this.inflight=new Map();
    this.seen=new Set(); this.closed=false;
  }
  #admit(lane, {ticket, kind, epoch}) {
    requireId(ticket, 'ticket'); requireId(kind, 'message kind'); requireEpoch(epoch);
    if (epoch !== this.epoch) return 'STALE_EPOCH';
    if (this.closed) return 'CLOSED';
    if (this.seen.has(ticket)) return 'DUPLICATE_TICKET';
    const queue=lane==='CONTROL'?this.control:this.data;
    const cap=lane==='CONTROL'?this.controlCapacity:this.dataCapacity;
    if (queue.length >= cap) return 'FULL';
    queue.push({ticket,kind,epoch,lane}); this.seen.add(ticket);
    return 'ACCEPTED';
  }
  sendData(message) { return this.#admit('DATA', message); }
  // Host/supervisor-only ingress. Guest code never receives a CONTROL capability.
  sendControl(message) { return this.#admit('CONTROL', message); }
  // Guest-facing DATA reference selection. A supervisor CONTROL notice is
  // NEVER returned through DATA receive, even when its kind matches a guest pattern.
  // A delivered-but-unsettled CONTROL also fences further DATA processing.
  dispatch(acceptedDataKinds) {
    if (!Array.isArray(acceptedDataKinds) || acceptedDataKinds.length>32 ||
        acceptedDataKinds.some(k=>!ident(k))) fail('receive pattern');
    if (this.control.length ||
        [...this.inflight.values()].some(m=>m.lane==='CONTROL'))
      return {status:'CONTROL_PENDING'};
    const index=this.data.findIndex(m=>acceptedDataKinds.includes(m.kind));
    if (index<0) return {status:this.closed?'CLOSED':'SUSPENDED'};
    const message=this.data.splice(index,1)[0];
    this.inflight.set(message.ticket,message);
    return {status:'DELIVERED',ticket:message.ticket,kind:message.kind,lane:'DATA'};
  }
  // Trusted supervisor-side path ONLY. This JS method is a reference-model
  // operation, not an authorization token or an AttoLang guest API.
  dispatchControl() {
    const message=this.control.shift();
    if (!message) return {status:this.closed?'CLOSED':'SUSPENDED'};
    this.inflight.set(message.ticket,message);
    return {status:'DELIVERED',ticket:message.ticket,kind:message.kind,lane:'CONTROL'};
  }
  settle(ticket) {
    requireId(ticket,'ticket');
    if (!this.inflight.delete(ticket)) return 'INVALID';
    return 'SETTLED';
  }
  advance(event) {
    requireId(event,'event');
    const next=this.transitions.get(this.state+'/'+event);
    if (!next) return {status:'REJECTED',state:this.state};
    this.state=next;
    return {status:'TRANSITIONED',state:next};
  }
  close() {
    if (this.closed) return 'ALREADY_CLOSED';
    // Queued DATA is withdrawn; supervisor CONTROL must remain observable.
    this.closed=true; this.data.length=0;
    return 'CLOSED';
  }
  drained() { return this.closed && this.data.length===0 && this.control.length===0 && this.inflight.size===0; }
  restart(nextEpoch, initial) {
    requireEpoch(nextEpoch);
    if (nextEpoch<=this.epoch || !this.drained()) fail('unsafe restart or stale generation');
    // A real backend must separately prove physical quiescence and arena retirement.
    if (initial !== undefined && !this.states.has(initial)) fail('restart state');
    this.epoch=nextEpoch;this.closed=false;this.state=initial === undefined ? this.state : initial;
    this.seen.clear();
    return 'RESTARTED_MODEL_ONLY';
  }
}

/** Round-robin reference scheduling of *already resumable* continuation chunks. */
export function runBudgetedReference(actors, {budget=4, turns=64}={}) {
  if (!size(budget,1,1024) || !size(turns,1,100000) || !Array.isArray(actors) ||
      actors.length<1 || actors.length>32) fail('scheduler bounds');
  const ids=new Set();
  const ready=actors.map(a=>{
    if (!a || !ident(a.id) || ids.has(a.id) ||
        !size(a.work,0,1_000_000)) fail('runnable actor');
    ids.add(a.id);return {id:a.id,remaining:a.work};
  }).filter(a=>a.remaining>0);
  const history=[];
  while(ready.length && history.length<turns) {
    const actor=ready.shift();
    const charged=Math.min(budget,actor.remaining);
    actor.remaining-=charged;
    history.push({actor:actor.id,charged,remaining:actor.remaining});
    if(actor.remaining)ready.push(actor);
  }
  return {history,remaining:ready.map(a=>({...a})),
    allCompleted:ready.length===0,
    classification:'CONTINUATION_CHUNK_REFERENCE_ONLY',
    compiledGuestExecuted:false,nativePreemptionProven:false};
}

/** Logical ownership ledger only: does not allocate native actor arenas. */
export class OwnershipOracle {
  constructor() { this.resources=new Map(); }
  allocate(id, actor, epoch) {
    requireId(id,'resource');requireId(actor,'actor');requireEpoch(epoch);
    if(this.resources.has(id))return 'DUPLICATE_RESOURCE';
    this.resources.set(id,{actor,epoch,loans:0,alive:true});return 'ALLOCATED';
  }
  borrow(id, actor, epoch) {
    const r=this.resources.get(id);
    if(!r || !r.alive || r.actor!==actor || r.epoch!==epoch)return 'DENIED';
    r.loans++;return 'BORROWED';
  }
  release(id, actor, epoch) {
    const r=this.resources.get(id);
    if(!r || !r.alive || r.actor!==actor || r.epoch!==epoch || !r.loans)return 'DENIED';
    r.loans--;return 'RELEASED';
  }
  transfer(id, from, fromEpoch, to, toEpoch, transport) {
    const r=this.resources.get(id);
    if(!r || !r.alive || r.actor!==from || r.epoch!==fromEpoch)return 'DENIED';
    if(r.loans)return 'BORROW_LIVE';
    requireId(to,'recipient');requireEpoch(toEpoch);
    if(transport!=='LOCAL_MOVE')return 'SERIALIZATION_REQUIRED';
    r.actor=to;r.epoch=toEpoch;return 'MOVED';
  }
  reclaim(id, actor, epoch, physicallyQuiescent) {
    const r=this.resources.get(id);
    if(!r || !r.alive || r.actor!==actor || r.epoch!==epoch)return 'DENIED';
    if(r.loans || physicallyQuiescent!==true)return 'NOT_QUIESCENT';
    r.alive=false;return 'RECLAIMED_MODEL_ONLY';
  }
}

/** Big-endian v1 (u8 version, u16 length) frame, payload view aliases input. */
export function inspectBinaryFrame(bytes, maxPayload=65535) {
  if(!(bytes instanceof Uint8Array) || !size(maxPayload,0,65535))fail('binary input');
  if(bytes.byteLength<3)fail('truncated header');
  const version=bytes[0], length=(bytes[1]<<8)|bytes[2];
  if(version!==1 || length>maxPayload || length!==bytes.byteLength-3)
    fail('version, bounds, or payload length');
  return {version,length,payload:bytes.subarray(3),zeroCopyView:true,
    nativeZeroCopyProven:false};
}
