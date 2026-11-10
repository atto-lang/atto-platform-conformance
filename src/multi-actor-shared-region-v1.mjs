/**
 * AttoLang multi-actor shared-region V1: SOURCE-FREE deterministic oracle.
 * Not a compiler, real RW lock, real concurrent runtime, or security boundary.
 * TrustedHost methods model privileged supervisor/scheduler entrypoints ONLY.
 */
const assert = (ok, why) => { if (!ok) throw new Error(why); };

function immutable_copy(value, budget = { nodes: 0 }, active = new WeakSet()) {
  if (value === null || ['string', 'boolean', 'bigint'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  assert(typeof value === 'object', 'singleton payload is not deeply immutable');
  assert(!active.has(value), 'cyclic singleton payload');
  assert(++budget.nodes <= 1024, 'singleton allocation budget exceeded');
  assert(Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null || Array.isArray(value),
    'singleton payload requires plain data');
  active.add(value);
  const entries = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) assert(value.length <= 1024, 'singleton allocation budget exceeded');
  const copy = Array.isArray(value) ? [] : Object.create(null);
  for (const key of Reflect.ownKeys(entries)) {
    assert(typeof key === 'string', 'symbol keys are not admitted');
    assert(++budget.nodes <= 1024, 'singleton allocation budget exceeded');
    const d = entries[key];
    assert(Object.hasOwn(d, 'value'), 'singleton getter/setter is not admitted');
    if (Array.isArray(value) && key === 'length') continue;
    const nested = immutable_copy(d.value, budget, active);
    Object.defineProperty(copy, key, { value: nested, enumerable: d.enumerable,
      configurable: false, writable: false });
  }
  if (Array.isArray(value)) copy.length = value.length;
  active.delete(value);
  return Object.freeze(copy);
}

export class ApplicationSingletonRegistryV1 {
  #cells = new Map();
  /** scope and canonicalId must be supplied by a trusted compiler/linker. */
  get(scope, canonicalId, init) {
    assert(typeof scope === 'string' && scope.length > 0, 'invalid domain');
    assert(typeof canonicalId === 'string' && canonicalId.length > 0, 'invalid declaration');
    assert(typeof init === 'function', 'initializer required');
    const key = JSON.stringify([scope, canonicalId]);
    const old = this.#cells.get(key);
    if (old) {
      if (old.state === 'ready') return old.value;
      if (old.state === 'failed') throw old.error;
      old.cycle = true;
      throw new Error('singleton initialization cycle');
    }
    const cell = { state: 'initializing', cycle: false };
    this.#cells.set(key, cell);
    try {
      const value = init();
      assert(!cell.cycle, 'singleton initialization cycle');
      assert(!(value && typeof value.then === 'function'), 'async initializer unsupported by V1 oracle');
      cell.value = immutable_copy(value);
      cell.state = 'ready';
      return cell.value;
    } catch (error) {
      cell.error = Object.freeze(error instanceof Error ? error : new Error('singleton initializer failed'));
      cell.state = 'failed';
      throw cell.error;
    }
  }
}

const actors = new WeakMap();
const executions = new WeakMap();
const INTERNAL = Symbol('private-runtime-admission');

export class TrustedMultiActorSharedHostV1 {
  #byActor = new Map();
  #regions = new Set();
  #incarnations = new Map();

  /** TRUSTED ONLY. An actor cannot mint its own actor identity or authority. */
  registerActor({ id, domain, slice, trust = 'trusted' }) {
    for (const s of [id, domain, slice]) assert(typeof s === 'string' && s.length > 0, 'invalid actor identity');
    assert(trust === 'trusted' || trust === 'untrusted', 'invalid trust domain');
    const key = JSON.stringify([domain, id]);
    const prior = this.#byActor.get(key);
    assert(!prior || !prior.live, 'actor incarnation already live');
    const generation = (this.#incarnations.get(key) ?? 0) + 1;
    assert(Number.isSafeInteger(generation), 'actor generation exhausted');
    this.#incarnations.set(key, generation);
    const handle = Object.freeze({});
    const state = { host: this, id, domain, slice, trust, generation, live: true, executions: new Map() };
    actors.set(handle, state);
    this.#byActor.set(key, state);
    return handle;
  }


  beginExecution(actor, logicalId) {
    const a = actors.get(actor);
    assert(a?.live && a.host === this, 'stale or forged actor');
    assert(typeof logicalId === 'string' && logicalId.length > 0, 'invalid execution');
    assert(!a.executions.has(logicalId), 'logical execution already active');
    const handle = Object.freeze({});
    const e = { host: this, actor, a, logicalId, live: true };
    a.executions.set(logicalId, e);
    executions.set(handle, e);
    return handle;
  }

  endExecution(execution) {
    const e = executions.get(execution);
    assert(e?.live && e.host === this, 'stale or forged execution');
    for (const region of this.#regions) assert(!region.hasExecution(execution), 'execution has active or pending loan');
    e.live = false;
    e.a.executions.delete(e.logicalId);
  }

  createRegion(ownerActor, initial = 0, bounds = {}) {
    const a = actors.get(ownerActor);
    assert(a?.live && a.host === this && a.trust === 'trusted', 'only live trusted owner may allocate shared region');
    assert(Number.isSafeInteger(initial), 'V1 reference region stores safe integer scalars only');
    const region = new MultiActorSharedRegionV1(this, ownerActor, initial, bounds);
    this.#regions.add(region);
    return region;
  }

  hasOutstandingLoan(execution, exceptRegion = null) {
    for (const region of this.#regions) {
      if (region !== exceptRegion && region.hasExecution(execution)) return true;
    }
    return false;
  }

  reclaimRegion(region) {
    assert(this.#regions.has(region), 'foreign or forged region');
    region.reclaim(INTERNAL);
  }

  stopActor(actor) {
    const a = actors.get(actor);
    assert(a?.live && a.host === this, 'unknown or stopped actor');
    a.live = false;
    for (const region of this.#regions) region.onActorStop(actor, INTERNAL);
    // Keep physical execution identities until their active loans unwind.
  }
}

class MultiActorSharedRegionV1 {
  #host;
  #owner;
  #domain;
  #epoch = 1;
  #value;
  #sealed = false;
  #reclaimed = false;
  #tickets = new Map(); // active and pending tickets only; never retain retired handles
  #ticketStates = new WeakMap(); // TEST-only terminal observation; no strong retention
  #grants = new Map();
  #pending = [];
  #maxPending;
  #maxReaders;
  #maxGrants;

  constructor(host, owner, initial, { maxPending = 16, maxReaders = 1024, maxGrants = 64 } = {}) {
    assert(host instanceof TrustedMultiActorSharedHostV1, 'trusted host required');
    for (const n of [maxPending, maxReaders, maxGrants]) assert(Number.isSafeInteger(n) && n >= 0, 'invalid quota');
    assert(maxReaders > 0, 'must permit at least one reader');
    this.#host = host;
    this.#owner = owner;
    this.#domain = actors.get(owner).domain;
    this.#value = initial;
    this.#maxPending = maxPending;
    this.#maxReaders = maxReaders;
    this.#maxGrants = maxGrants;
  }

  get stats() {
    const live = [...this.#tickets.values()].filter(t => t.state === 'active');
    return Object.freeze({ readers: live.filter(t => t.mode === 'read').length,
      writers: live.filter(t => t.mode === 'write').length,
      pending: this.#pending.length, grants: this.#grants.size, retainedTickets: this.#tickets.size, epoch: this.#epoch,
      sealed: this.#sealed, reclaimed: this.#reclaimed });
  }

  #actor(execution) {
    const e = executions.get(execution);
    assert(e?.live && e.host === this.#host && e.a.live, 'stale or forged execution');
    assert(e.a.trust === 'trusted' && e.a.domain === this.#domain,
      'cross-domain or untrusted shared-memory access denied');
    assert(!this.#sealed && !this.#reclaimed, 'region sealed');
    return e;
  }

  #ownerExecution(execution) {
    const e = this.#actor(execution);
    assert(e.actor === this.#owner, 'only region owner may authorize');
    return e;
  }

  delegate(ownerExecution, recipientExecution, mode) {
    this.#ownerExecution(ownerExecution);
    const e = executions.get(recipientExecution);
    const a = e?.a;
    assert(e?.live && a?.live && e.host === this.#host &&
      a.domain === this.#domain && a.trust === 'trusted',
      'cross-domain or stale recipient execution');
    assert(mode === 'read' || mode === 'write', 'invalid loan mode');
    assert(this.#grants.size < this.#maxGrants, 'grant quota exhausted');
    const grant = Object.freeze({});
    this.#grants.set(grant, { recipientExecution, mode, epoch: this.#epoch });
    return grant;
  }

  #hasExecution(execution) {
    return [...this.#tickets.values()].some(t => t.execution === execution &&
      (t.state === 'active' || t.state === 'pending'));
  }
  hasExecution(execution) { return this.#hasExecution(execution); }

  #active() {
    return [...this.#tickets.values()].filter(t => t.state === 'active');
  }

  request(execution, mode, grant = null) {
    const e = this.#actor(execution);
    assert(mode === 'read' || mode === 'write', 'invalid loan mode');
    assert(!this.#hasExecution(execution), 'recursive acquisition or upgrade denied');
    assert(!this.#host.hasOutstandingLoan(execution, this),
      'cross-region nested critical loans denied until a global lock-order proof exists');
    let delegated = null;
    if (e.actor === this.#owner) {
      assert(grant === null, 'owner cannot consume delegation');
    } else {
      delegated = this.#grants.get(grant);
      assert(delegated && delegated.recipientExecution === execution && delegated.mode === mode &&
        delegated.epoch === this.#epoch, 'invalid or stale delegation');
    }
    const live = this.#active();
    const readers = live.filter(t => t.mode === 'read').length;
    const canGrantNow = this.#pending.length === 0 &&
      (mode === 'read' ? readers < this.#maxReaders && live.every(t => t.mode === 'read') : live.length === 0);
    assert(canGrantNow || this.#pending.length < this.#maxPending, 'pending queue full');
    // Commit the one-use delegation only after all admission checks succeed.
    if (delegated) this.#grants.delete(grant);
    const ticket = Object.freeze({});
    const t = { execution, mode, state: canGrantNow ? 'active' : 'pending' };
    this.#tickets.set(ticket, t);
    this.#ticketStates.set(ticket, t.state);
    if (!canGrantNow) this.#pending.push(ticket);
    this.#check();
    return ticket;
  }

  ticketState(ticket) { return this.#tickets.get(ticket)?.state ?? this.#ticketStates.get(ticket) ?? 'invalid'; } // TEST instrumentation.

  #requireActive(execution, ticket, mode) {
    this.#actor(execution);
    const t = this.#tickets.get(ticket);
    assert(t?.execution === execution && t.state === 'active' && t.mode === mode,
      'missing, stale or foreign active lease');
  }

  read(execution, ticket) {
    this.#requireActive(execution, ticket, 'read');
    return this.#value;
  }
  write(execution, ticket, value) {
    this.#requireActive(execution, ticket, 'write');
    assert(Number.isSafeInteger(value), 'invalid scalar write');
    this.#value = value;
  }

  assertCanSuspend(execution) {
    this.#actor(execution);
    assert(!this.#hasExecution(execution), 'loan must not span await/select/yield');
  }

  release(execution, ticket) {
    // Cleanup is permitted for a stopped logical execution; access is not.
    const e = executions.get(execution);
    const t = this.#tickets.get(ticket);
    assert(e && t?.execution === execution && t.state === 'active', 'invalid/duplicate release');
    t.state = 'released';
    this.#ticketStates.set(ticket, 'released');
    this.#tickets.delete(ticket);
    this.#drain();
    this.#check();
  }

  cancel(execution, ticket) {
    const e = executions.get(execution);
    const t = this.#tickets.get(ticket);
    assert(e && t?.execution === execution && t.state === 'pending',
      'only pending reservations may be cancelled');
    this.#pending.splice(this.#pending.indexOf(ticket), 1);
    t.state = 'cancelled';
    this.#ticketStates.set(ticket, 'cancelled');
    this.#tickets.delete(ticket);
    this.#drain();
    this.#check();
  }

  #drain() {
    if (this.#sealed) return;
    const live = this.#active();
    if (live.some(t => t.mode === 'write')) return;
    let readers = live.length;
    while (this.#pending.length) {
      const next = this.#pending[0];
      const t = this.#tickets.get(next);
      if (t.mode === 'write' && readers > 0) break;
      if (t.mode === 'read' && readers >= this.#maxReaders) break;
      this.#pending.shift();
      t.state = 'active';
      this.#ticketStates.set(next, 'active');
      if (t.mode === 'write') break;
      readers++;
    }
  }

  #check() {
    const active = this.#active();
    const writers = active.filter(t => t.mode === 'write').length;
    const readers = active.length - writers;
    assert(writers <= 1 && (writers === 0 || readers === 0) && readers <= this.#maxReaders,
      'RW exclusion invariant violated');
    assert(this.#pending.length <= this.#maxPending && this.#grants.size <= this.#maxGrants,
      'bounded capacity invariant violated');
  }

  transferOwner(ownerExecution, nextActor) {
    this.#ownerExecution(ownerExecution);
    const a = actors.get(nextActor);
    assert(a?.live && a.host === this.#host && a.domain === this.#domain && a.trust === 'trusted' && nextActor !== this.#owner,
      'invalid new owner');
    assert(this.#active().length === 0 && this.#pending.length === 0 &&
      this.#grants.size === 0, 'owner move requires full quiescence and grant revocation');
    assert(Number.isSafeInteger(this.#epoch + 1), 'owner epoch exhausted');
    this.#owner = nextActor;
    this.#epoch++;
  }

  /** STOP prevents new access but does not release active physical loans. */
  seal(ownerExecution) {
    this.#ownerExecution(ownerExecution);
    this.#seal();
  }
  #seal() {
    this.#sealed = true;
    this.#grants.clear();
    for (const ticket of this.#pending) {
      this.#tickets.get(ticket).state = 'cancelled';
      this.#ticketStates.set(ticket, 'cancelled');
      this.#tickets.delete(ticket);
    }
    this.#pending = [];
  }

  onActorStop(actor, authority) {
    assert(authority === INTERNAL, 'only trusted runtime may stop actor region');
    if (actor === this.#owner) this.#seal();
    for (const ticket of [...this.#pending]) {
      if (executions.get(this.#tickets.get(ticket).execution)?.actor === actor) {
        const t = this.#tickets.get(ticket);
        t.state = 'cancelled';
        this.#ticketStates.set(ticket, 'cancelled');
        this.#tickets.delete(ticket);
        this.#pending.splice(this.#pending.indexOf(ticket), 1);
      }
    }
    for (const [grant, record] of this.#grants) {
      if (executions.get(record.recipientExecution)?.actor === actor) this.#grants.delete(grant);
    }
    this.#drain();
    this.#check();
  }

  reclaim(authority) {
    assert(authority === INTERNAL, 'only trusted runtime may reclaim');
    assert(this.#sealed && !this.#reclaimed && this.#active().length === 0 &&
      this.#pending.length === 0, 'reclamation requires sealed, physically quiescent region');
    this.#reclaimed = true;
    this.#value = null;
  }
}
