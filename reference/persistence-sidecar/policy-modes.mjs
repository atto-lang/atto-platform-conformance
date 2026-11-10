// Host-only policy/actor reference. NOT a native Oreslang actor, compiler, or async storage adapter.
// The language's sealed StateAccess/critical-read/critical-write rules must be compiler enforced.
const MODES = new Set(['#none', '#snapshot', '#event_sourced', '#batched_sidecar']);
const BASES = new Set(['#snapshot', '#event_sourced']);
const ACKS = new Set(['#admitted', '#committed']);
const deny = (reason) => { throw new Error(reason); };

export function resolve_persistence_policy(spec = '#none') {
  const input = typeof spec === 'string' ? {mode: spec} : spec;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k => !['mode','underlying','ack'].includes(k))) deny('INVALID_POLICY');
  const {mode, underlying, ack} = input;
  if (!MODES.has(mode)) deny('INVALID_POLICY_MODE');
  if (mode === '#none') {
    if (underlying !== undefined || ack !== undefined) deny('INVALID_POLICY_COMBINATION');
    return Object.freeze({mode, storageKind: null, batched: false, ack: null});
  }
  if (mode === '#batched_sidecar') {
    if (!BASES.has(underlying) || (ack !== undefined && !ACKS.has(ack)))
      deny('BATCH_REQUIRES_DURABLE_UNDERLYING');
    return Object.freeze({mode, storageKind: underlying === '#snapshot' ? 'snapshot' : 'event',
      batched: true, ack: ack ?? '#committed'});
  }
  if (underlying !== undefined || (ack !== undefined && ack !== '#committed'))
    deny('INVALID_POLICY_COMBINATION');
  return Object.freeze({mode, storageKind: mode === '#snapshot' ? 'snapshot' : 'event',
    batched: false, ack: '#committed'});
}

// Strict plain JSON only; never serialize arena pointers, capabilities, class instances or accessors.
function clone_json(value) {
  const seen = new Set();
  function check(v, depth) {
    if (depth > 64) deny('STATE_TOO_DEEP');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v) &&
        (!Number.isInteger(v) || Number.isSafeInteger(v))) return;
    if (!v || typeof v !== 'object' || seen.has(v)) deny('NOT_SERIALIZABLE');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null) deny('NOT_SERIALIZABLE');
    seen.add(v);
    for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (!('value' in d) || k === '__proto__' || k === 'constructor' || k === 'prototype')
        deny('NOT_SERIALIZABLE');
      check(d.value, depth + 1);
    }
    seen.delete(v);
  }
  check(value, 0);
  return JSON.parse(JSON.stringify(value));
}
const encode = (v) => Buffer.from(JSON.stringify(clone_json(v)), 'utf8');
const decode = (b) => clone_json(JSON.parse(b.toString('utf8')));
function freeze_deep(v) {
  if (v && typeof v === 'object') {
    for (const child of Object.values(v)) freeze_deep(child);
    Object.freeze(v);
  }
  return v;
}
function synchronous(callback, data) {
  const result = callback(data);
  if (result && typeof result.then === 'function') deny('CRITICAL_CALLBACK_MAY_NOT_SUSPEND');
  return result;
}

// This models scoped state access and durable acknowledgement for host tests only.
// The real language must forbid direct actor-state access in parser/typechecker/borrow checker.
export class PolicyActorReference {
  #state; #version = 0; #pending = null; #inScope = false;
  #withScope(fn) {
    if (this.#inScope) deny('ACTOR_REENTRANCY_DENIED');
    this.#inScope = true;
    try { return fn(); } finally { this.#inScope = false; }
  }
  constructor({sidecar = null, tenantId, actor, stateName = 'main', epoch = 1,
               policy = '#none', initialState, reducer = null, schemaVersion = 1}) {
    this.policy = resolve_persistence_policy(policy);
    this.sidecar = sidecar;
    this.tenantId = tenantId;
    this.actor = actor;
    this.stateName = stateName;
    this.epoch = epoch;
    this.schemaVersion = schemaVersion;
    this.reducer = reducer;
    this.initialState = freeze_deep(clone_json(initialState));
    this.#state = clone_json(initialState);
    if (this.policy.storageKind && !sidecar) deny('MISSING_STORAGE');
    if (this.policy.storageKind === 'event' && typeof reducer !== 'function') deny('MISSING_REDUCER');
    // Trust-bound configuration may not be changed after actor activation.
    // Private #state/#version/#pending still evolve despite freezing the shell.
    Object.freeze(this);
  }
  get version() { return this.#version; }
  get has_pending_write() { return this.#pending !== null; }
  // No mutable state reference is exposed to callers.
  handle_state(access, callback) {
    return this.#withScope(() => {
    if (typeof callback !== 'function') deny('INVALID_STATE_ACCESS');
    if (access === 'critical-read')
      return clone_json(synchronous(callback, freeze_deep(clone_json(this.#state))));
    if (access !== 'critical-write') deny('INVALID_STATE_ACCESS');
    // Durable writes must be staged then committed; no direct write-through alias.
    if (this.policy.mode !== '#none') deny('PERSISTED_WRITE_REQUIRES_COMMIT');
    const draft = clone_json(this.#state);
    synchronous(callback, draft);
    this.#state = clone_json(draft);
    });
  }
  #enqueue(opId, kind, payload, nextState) {
    if (this.#pending) deny('WRITE_ALREADY_PENDING');
    const envelope = {tenantId: this.tenantId, actor: this.actor, stateName: this.stateName,
      opId, epoch: this.epoch, expectedVersion: this.#version,
      kind, schemaVersion: this.schemaVersion, payload: encode(payload)};
    const receipt = this.sidecar.enqueue(envelope);
    if (receipt.status === 'committed') {
      if (!receipt.durable || !receipt.duplicate || receipt.version !== this.#version + 1)
        deny('RELOAD_REQUIRED');
      // Already-committed duplicate receipts are no more trustworthy than
      // async commit receipts. Check persisted op ID, exact bytes, and epoch.
      if (typeof this.sidecar.verifyCommit !== 'function') deny('UNVERIFIABLE_COMMIT');
      const verified = this.sidecar.verifyCommit(envelope);
      if (!verified || verified.opId !== opId || verified.status !== 'committed' ||
          verified.durable !== true || verified.version !== receipt.version)
        deny('OUTCOME_UNKNOWN');
      this.#state = clone_json(nextState);
      this.#version = verified.version;
      return receipt;
    }
    if (receipt.status !== 'admitted' || receipt.durable) deny('INVALID_ADMISSION_RECEIPT');
    this.#pending = {opId, envelope, nextState: clone_json(nextState), nextVersion: this.#version + 1};
    return receipt; // Never a durable success; caller must flush + apply_commit.
  }
  stage_snapshot(opId, critical_write_callback) {
    return this.#withScope(() => {
    if (this.policy.storageKind !== 'snapshot') deny('WRONG_STORAGE_KIND');
    if (this.#pending) deny('WRITE_ALREADY_PENDING');
    const draft = clone_json(this.#state);
    synchronous(critical_write_callback, draft);
    return this.#enqueue(opId, 'snapshot', draft, draft);
    });
  }
  stage_event(opId, event) {
    return this.#withScope(() => {
    if (this.policy.storageKind !== 'event') deny('WRONG_STORAGE_KIND');
    if (this.#pending) deny('WRITE_ALREADY_PENDING');
    const e = clone_json(event);
    const nextState = clone_json(synchronous((x) => this.reducer(clone_json(this.#state), x), e));
    return this.#enqueue(opId, 'event', e, nextState);
    });
  }
  // One logical command may emit multiple deterministic immutable events.
  // The runtime owns staging, single-flight admission and commit publication;
  // no mutable actor-state loan crosses the provider call.
  stage_events(opId, commandBytes, events, resultBytes = Buffer.from('null')) {
    return this.#withScope(() => {
      if (this.policy.storageKind !== 'event') deny('WRONG_STORAGE_KIND');
      if (this.#pending) deny('WRITE_ALREADY_PENDING');
      if (!Buffer.isBuffer(commandBytes) || !Buffer.isBuffer(resultBytes) ||
          !Array.isArray(events) || events.length === 0) deny('INVALID_COMMAND');
      if (typeof this.sidecar.enqueueCommand !== 'function' ||
          typeof this.sidecar.verifyCommand !== 'function') deny('UNSUPPORTED_COMMAND_PROTOCOL');
      let nextState = clone_json(this.#state);
      const ownedEvents = [];
      for (const event of events) {
        const owned = clone_json(event);
        nextState = clone_json(synchronous(x => this.reducer(clone_json(nextState), x), owned));
        ownedEvents.push(encode(owned));
      }
      if (!Number.isSafeInteger(this.#version + ownedEvents.length)) deny('VERSION_EXHAUSTED');
      const envelope = {tenantId:this.tenantId,actor:this.actor,stateName:this.stateName,
        opId,epoch:this.epoch,expectedVersion:this.#version,
        schemaVersion:this.schemaVersion,commandBytes:Buffer.from(commandBytes),
        events:ownedEvents,resultBytes:Buffer.from(resultBytes)};
      const receipt = this.sidecar.enqueueCommand(envelope);
      if (receipt.status === 'committed') {
        // Already durable on this or an earlier incarnation. Never apply the
        // candidate twice. Caller must reconcile/restore the committed state.
        const verified = this.sidecar.verifyCommand(envelope);
        if (!verified || verified.status !== 'committed' || !verified.durable ||
            verified.opId !== opId || verified.version !== receipt.version)
          deny('UNVERIFIABLE_COMMIT');
        deny('RELOAD_REQUIRED');
      }
      if (receipt.status !== 'admitted' || receipt.durable !== false)
        deny('INVALID_ADMISSION_RECEIPT');
      this.#pending = {kind:'command',opId,envelope,nextState,
        firstVersion:this.#version+1,eventCount:ownedEvents.length,
        nextVersion:this.#version+ownedEvents.length};
      return receipt;
    });
  }
  #verify_pending(p) {
    const verified = p.kind === 'command'
      ? this.sidecar.verifyCommand(p.envelope)
      : this.sidecar.verifyCommit(p.envelope);
    if (!verified || verified.opId !== p.opId || verified.status !== 'committed' ||
        verified.durable !== true || verified.version !== p.nextVersion)
      deny('OUTCOME_UNKNOWN');
    if (p.kind === 'command') {
      if (verified.firstVersion !== p.firstVersion ||
          verified.eventCount !== p.eventCount ||
          !Buffer.isBuffer(verified.resultBytes) ||
          !verified.resultBytes.equals(p.envelope.resultBytes))
        deny('OUTCOME_UNKNOWN');
    }
    return verified;
  }
  apply_commit(receipt) {
    return this.#withScope(() => {
    const p = this.#pending;
    if (!p || !receipt || receipt.opId !== p.opId) deny('UNMATCHED_RECEIPT');
    // A caller-supplied rejection is not evidence that storage rejected the operation.
    // The operation might already be durable with a lost ACK. Retain pending
    // identity until a trusted provider lookup establishes its outcome.
    if (receipt.status === 'rejected') deny('OUTCOME_UNKNOWN');
    if (receipt.status !== 'committed' || receipt.durable !== true ||
        receipt.version !== p.nextVersion) deny('OUTCOME_UNKNOWN');
    // Public receipts are not proof of a transaction. Confirm by reading the
    // trusted provider's persisted operation record before publishing state.
    if (p.kind === 'command') {
      if (receipt.firstVersion !== p.firstVersion ||
          receipt.eventCount !== p.eventCount ||
          !Buffer.isBuffer(receipt.resultBytes) ||
          !receipt.resultBytes.equals(p.envelope.resultBytes)) deny('OUTCOME_UNKNOWN');
    }
    if (typeof this.sidecar.verifyCommit !== 'function' && p.kind !== 'command')
      deny('UNVERIFIABLE_COMMIT');
    const verified = this.#verify_pending(p);
    this.#state = clone_json(p.nextState);
    this.#version = receipt.version;
    this.#pending = null;
    return {status: 'committed', durable: true, version: this.#version};
    });
  }
  // Lost ACK / uncertain commit reconciliation: only the trusted persisted op
  // record may authorize publication. A queued but uncommitted write remains
  // pending (and must be retried with the SAME opId, never a new operation).
  resolve_pending() {
    return this.#withScope(() => {
      const p = this.#pending;
      if (!p) deny('NO_PENDING_WRITE');
      if (p.kind !== 'command' && typeof this.sidecar.verifyCommit !== 'function')
        deny('UNVERIFIABLE_COMMIT');
      const raw = p.kind === 'command'
        ? this.sidecar.verifyCommand(p.envelope)
        : this.sidecar.verifyCommit(p.envelope);
      if (!raw) return {status:'pending', durable:false, opId:p.opId};
      const verified = this.#verify_pending(p);
      this.#state = clone_json(p.nextState);
      this.#version = verified.version;
      this.#pending = null;
      return {status:'committed', durable:true, version:this.#version};
    });
  }
  restore() {
    return this.#withScope(() => {
    if (this.#pending) deny('PENDING_OUTCOME_MUST_RESOLVE');
    if (this.policy.mode === '#none') { this.#state = clone_json(this.initialState); this.#version = 0; return; }
    if (typeof this.sidecar.loadFenced !== 'function') deny('UNVERIFIABLE_RESTORE');
    const loaded = this.sidecar.loadFenced({tenantId:this.tenantId,actor:this.actor,stateName:this.stateName,epoch:this.epoch});
    let value = clone_json(this.initialState), version = 0;
    if (loaded.snapshot) {
      if (loaded.snapshot.schemaVersion !== this.schemaVersion) deny('SCHEMA_MIGRATION_REQUIRED');
      value = decode(loaded.snapshot.payload);
      version = loaded.snapshot.version;
    }
    if (this.policy.storageKind === 'snapshot' && loaded.events.length) deny('WRONG_STORAGE_KIND');
    for (const e of loaded.events) {
      if (e.schemaVersion !== this.schemaVersion) deny('SCHEMA_MIGRATION_REQUIRED');
      if (e.version !== version + 1) deny('JOURNAL_GAP');
      value = clone_json(synchronous((x) => this.reducer(clone_json(value), x), decode(e.payload)));
      version = e.version;
    }
    if (version !== loaded.version) deny('JOURNAL_GAP');
    this.#state = value;
    this.#version = version;
    });
  }
}
