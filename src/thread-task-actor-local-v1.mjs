// SOURCE-FREE reference only: no pthreads, compiler, guest entry, TLS or Task runtime.
// Metadata supplied to this model represents trusted compiler/runtime decisions;
// this JavaScript implementation must never be used as an authorization provider.

export function inferTransferTraits(descriptor) {
  const active = new Set();
  function walk(d, depth) {
    let result = {send: false, sync: false};
    let entered = false;
    // Proxy traps, revoked proxies, and hostile prototype access must fail
    // closed just like throwing descriptor getters below.
    try {
      if (!d || typeof d !== 'object' || Array.isArray(d) ||
          Object.getPrototypeOf(d) !== Object.prototype || depth > 32 ||
          active.has(d)) return result;
      active.add(d);
      entered = true;
      const kind = d.kind;
      switch (kind) {
        case 'primitive':
          if (['int','bool','float','String','bytes'].includes(d.name)) {
            result = {send: true, sync: true};
          }
          break;
        case 'record': {
          if (!Array.isArray(d.fields) || d.fields.length > 256) break;
          const traits = [];
          // Array map/every skip sparse holes; a missing declared field must
          // never become vacuously Send+Sync.
          for (let i = 0; i < d.fields.length; i++) {
            if (!Object.hasOwn(d.fields, i)) {
              traits.length = 0;
              break;
            }
            traits.push(walk(d.fields[i], depth + 1));
          }
          if (traits.length === d.fields.length)
            result = {send: traits.every(x => x.send), sync: traits.every(x => x.sync)};
          break;
        }
        case 'box':
          // A uniquely owned box may move; its referent is not automatically Sync.
          result = walk(d.of, depth + 1);
          break;
        case 'arc': {
          // Atomic refcount only synchronizes counts, not the referent.
          const inner = walk(d.of, depth + 1);
          result = {send: inner.send && inner.sync, sync: inner.send && inner.sync};
          break;
        }
        case 'dyn':
          // Flags model compiler-verified AOT vtable witnesses; not caller-supplied proof.
          result = {send: d.sendWitness === true, sync: d.syncWitness === true};
          break;
        case 'mutex': {
          const inner = walk(d.of, depth + 1);
          result = {send: inner.send, sync: inner.send};
          break;
        }
        case 'atomic': {
          const inner = walk(d.of, depth + 1);
          result = {send: inner.send && inner.sync, sync: inner.send && inner.sync};
          break;
        }
        case 'cell':
          result = {send: walk(d.of, depth + 1).send, sync: false};
          break;
        case 'stateInit':
          result = {send: walk(d.of, depth + 1).send, sync: false};
          break;
        // Thread-/Task-/Actor-owned state is locality bound, never transport data.
        case 'threadState': case 'taskState': case 'actorState':
        case 'borrow': case 'raw': case 'closure': case 'function':
        case 'joinHandle': case 'actorRef': case 'rc': case 'ffi':
          break;
        default: break; // Unknown type is NOT implicitly Send.
      }
    } catch { result = {send: false, sync: false}; }
    finally { if (entered) active.delete(d); }
    return result;
  }
  return walk(descriptor, 0);
}

const validKey = k => typeof k === 'string' && /^[a-zA-Z_][a-zA-Z0-9_.]{0,63}$/.test(k);
const validTenant = t => typeof t === 'string' && t.length > 0 && t.length <= 64;
const same = (a,b) => a?.slot === b?.slot && a?.generation === b?.generation;
const fail = code => { throw new Error(code); };

// Synchronous reference for ownership invariants; no real concurrent execution.
// A bound carrier is a test precondition, never an authentication token for guest code.
export class LocalStateThreadModel {
  #capacity; #threads = new Map(); #slotGeneration = new Map();
  #tasks = new Map(); #actors = new Map(); #nextId = 0;
  #current = null;
  constructor({capacity = 4} = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024)
      fail('INVALID_CAPACITY');
    this.#capacity = capacity;
  }

  #thread(h) {
    const t = this.#threads.get(h?.slot);
    if (!t || !same(t.handle,h)) fail('STALE_THREAD_GENERATION');
    return t;
  }
  #task(h) {
    const t = this.#tasks.get(h?.id);
    if (!t || t.handle.generation !== h?.generation)
      fail('STALE_TASK_GENERATION');
    return t;
  }
  #actor(h) {
    const a = this.#actors.get(h?.id);
    if (!a || a.handle.generation !== h?.generation)
      fail('STALE_ACTOR_GENERATION');
    return a;
  }
  #bound(type) {
    if (!this.#current?.[type]) fail('NO_ACTIVE_' + type.toUpperCase());
    return this.#current[type];
  }
  spawn({entryStatic = false, entrySuspends = false, entryKind = 'named',
    compilerLowered = false, captureOwned = false, captureStatic = false,
    captureType = null, argType, resultType, permit = false, tenant = 'default'} = {}) {
    if (!validTenant(tenant) || !permit) fail('THREAD_ADMISSION_DENIED');
    if (!entryStatic || entrySuspends) fail('THREAD_ENTRY_NOT_STATIC');
    // This is only a source-free model of compiler-trusted metadata.
    // Caller-provided flags MUST NOT become a real guest authorization API.
    if (entryKind === 'named') {
      if (compilerLowered || captureType !== null || captureOwned || captureStatic)
        fail('THREAD_ENTRY_SHAPE_MISMATCH');
    } else if (entryKind === 'owned-closure') {
      if (compilerLowered !== true || captureOwned !== true || captureStatic !== true)
        fail('THREAD_ENTRY_NOT_STATIC');
      if (!captureType || !inferTransferTraits(captureType).send)
        fail('THREAD_CAPTURE_NOT_SEND');
    } else {
      fail('THREAD_ENTRY_NOT_STATIC');
    }
    if (!inferTransferTraits(argType).send ||
        !inferTransferTraits(resultType).send)
      fail('THREAD_NOT_SEND');
    let slot = 0;
    for (let n = 1; n <= this.#capacity; n++) {
      if (!this.#threads.has(n)) { slot = n; break; }
    }
    if (!slot) fail('THREAD_CAPACITY_EXHAUSTED');
    const priorGeneration = this.#slotGeneration.get(slot) || 0;
    if (priorGeneration >= Number.MAX_SAFE_INTEGER) fail('THREAD_GENERATION_EXHAUSTED');
    const generation = priorGeneration + 1;
    this.#slotGeneration.set(slot, generation);
    const handle = Object.freeze({slot,generation,tenant});
    this.#threads.set(slot, {handle, status:'RUNNING', stopRequested:false,
      locals:new Map(), result:undefined});
    return handle;
  }
  requestStop(h) {
    const t = this.#thread(h);
    if (t.status !== 'RUNNING') fail('THREAD_ALREADY_EXITED');
    t.stopRequested = true;
  }
  stopRequested(h) { return this.#thread(h).stopRequested; }
  complete(h, result) {
    const t = this.#thread(h);
    if (t.status !== 'RUNNING') fail('THREAD_ALREADY_EXITED');
    if (this.#current?.thread && same(this.#current.thread,h))
      fail('THREAD_STILL_BOUND');
    t.locals.clear(); // TLS destructors modeled as retirement, not executed here.
    t.result = result; t.status = 'EXITED';
  }
  join(h) {
    const t = this.#thread(h);
    if (t.status !== 'EXITED') fail('THREAD_NOT_PHYSICALLY_EXITED');
    this.#threads.delete(h.slot);
    return t.result;
  }
  createTask(tenant = 'default') {
    if (!validTenant(tenant)) fail('INVALID_TENANT');
    if (this.#nextId >= Number.MAX_SAFE_INTEGER) fail('LOCAL_ID_EXHAUSTED');
    const handle = Object.freeze({id:++this.#nextId,generation:1,tenant});
    this.#tasks.set(handle.id,{handle,locals:new Map(),active:false});
    return handle;
  }
  retireTask(h) {
    const t=this.#task(h);
    if (t.active) fail('TASK_STILL_BOUND');
    t.locals.clear(); this.#tasks.delete(h.id);
  }
  createActor(tenant = 'default') {
    if (!validTenant(tenant)) fail('INVALID_TENANT');
    if (this.#nextId >= Number.MAX_SAFE_INTEGER) fail('LOCAL_ID_EXHAUSTED');
    const handle=Object.freeze({id:++this.#nextId,generation:1,tenant});
    this.#actors.set(handle.id,{handle,locals:new Map(),active:false});
    return handle;
  }
  restartActor(h) {
    const a=this.#actor(h);
    if (a.active) fail('ACTOR_STILL_BOUND');
    if (h.generation >= Number.MAX_SAFE_INTEGER) fail('ACTOR_GENERATION_EXHAUSTED');
    a.locals.clear();
    a.handle=Object.freeze({id:h.id,generation:h.generation+1,tenant:h.tenant});
    return a.handle;
  }
  retireActor(h) {
    const a=this.#actor(h);
    if (a.active) fail('ACTOR_STILL_BOUND');
    a.locals.clear();this.#actors.delete(h.id);
  }
  withExecution(threadHandle, {task = null, actor = null} = {}, fn) {
    if (typeof fn !== 'function') fail('INVALID_HOST_TEST_CALLBACK');
    const t=this.#thread(threadHandle);
    if (t.status !== 'RUNNING') fail('THREAD_NOT_RUNNING');
    const taskRec=task ? this.#task(task) : null;
    const actorRec=actor ? this.#actor(actor) : null;
    if (taskRec?.active || actorRec?.active) fail('LOCAL_CONTEXT_REENTRANCY');
    if (taskRec && task.tenant !== threadHandle.tenant ||
        actorRec && actor.tenant !== threadHandle.tenant)
      fail('TENANT_MISMATCH');
    const previous=this.#current;
    if (taskRec) taskRec.active=true;
    if (actorRec) actorRec.active=true;
    this.#current={thread:threadHandle,task,actor};
    try {
      const result = fn();
      if (result && typeof result.then === 'function') fail('ASYNC_MODEL_CALLBACK_FORBIDDEN');
      return result;
    }
    finally {
      this.#current=previous;
      if (taskRec) taskRec.active=false;
      if (actorRec) actorRec.active=false;
    }
  }
  #store(scope) {
    const h=this.#bound(scope);
    return scope === 'thread' ? this.#thread(h).locals :
      scope === 'task' ? this.#task(h).locals : this.#actor(h).locals;
  }
  setLocal(scope,key,value) {
    if (!['thread','task','actor'].includes(scope) || !validKey(key))
      fail('INVALID_LOCAL_KEY');
    const s=this.#store(scope);
    if (!s.has(key) && s.size >= 128) fail('LOCAL_KEY_CAPACITY_EXHAUSTED');
    s.set(key,value);
  }
  getLocal(scope,key) {
    if (!['thread','task','actor'].includes(scope) || !validKey(key))
      fail('INVALID_LOCAL_KEY');
    const s=this.#store(scope);
    return s.has(key) ? s.get(key) : undefined;
  }
}
