// SOURCE-FREE reference only. No AttoLang compiler, native VM, Wasm memory,
// preemptive kill or physical isolation executes here.
// A trusted scheduler owns this API. Guest code receives ONLY the per-turn
// borrowed interface; tenant handles and actor grants never enter guest code.
const TENANT_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const GUESTS = new Set(["validated-wasm", "truffle-isolate"]);
const die = code => { throw new Error(code); };
const positive = n => Number.isSafeInteger(n) && n > 0;

export class TenantVmActorContainmentV1 {
  #tenants = new Map();
  #tenantGrants = new WeakMap();
  #actorGrants = new WeakMap();
  #nextGeneration = 1;
  #nextActorEpoch = 1;
  #maxTenants;
  #maxHostMailBytes;
  #hostQueuedBytes = 0;

  constructor({maxTenants = 32, maxHostMailBytes = 65536} = {}) {
    if (!positive(maxTenants) || !positive(maxHostMailBytes)) die("INVALID_HOST_BUDGET");
    this.#maxTenants = maxTenants;
    this.#maxHostMailBytes = maxHostMailBytes;
  }

  // Only the trusted root can create a VM, after authenticating its tenant.
  // A caller-provided tenant label is never sufficient authorization.
  createTenant(id, {guestCode = "validated-wasm", maxActors = 16,
    maxHeapBytes = 65536, maxMailBytes = 8192, maxMessagesPerActor = 16} = {}) {
    if (typeof id !== "string" || !TENANT_ID.test(id) || id === "." || id === "..")
      die("INVALID_TENANT_ID");
    if (!GUESTS.has(guestCode)) die("UNTRUSTED_GUEST_CODE_DENIED");
    if (![maxActors, maxHeapBytes, maxMailBytes, maxMessagesPerActor].every(positive))
      die("INVALID_TENANT_BUDGET");
    if (this.#tenants.has(id)) die("DUPLICATE_TENANT");
    if (this.#tenants.size >= this.#maxTenants) die("TENANT_CAPACITY");
    if (!Number.isSafeInteger(this.#nextGeneration + 1)) die("GENERATION_EXHAUSTED");
    const handle = Object.freeze({id, generation: this.#nextGeneration++});
    const state = {handle, id, phase: "running", guestCode, maxActors, maxHeapBytes,
      maxMailBytes, maxMessagesPerActor, actors: new Map(), heapBytes: 0, mailBytes: 0};
    this.#tenants.set(id, state);
    this.#tenantGrants.set(handle, state);
    return handle;
  }

  #tenant(handle, allowQuiescing = false) {
    const state = handle && this.#tenantGrants.get(handle);
    if (!state || this.#tenants.get(state.id) !== state || state.handle !== handle)
      die("STALE_OR_FOREIGN_TENANT");
    if (state.phase !== "running" && !(allowQuiescing && state.phase === "quiescing"))
      die("TENANT_ADMISSION_CLOSED");
    return state;
  }

  #actor(tenant, grant) {
    const actor = grant && this.#actorGrants.get(grant);
    if (!actor || actor.grant !== grant || actor.tenant !== tenant ||
        tenant.actors.get(actor.id) !== actor) die("STALE_OR_FOREIGN_ACTOR");
    return actor;
  }

  spawnActor(handle, id, {heapBytes = 64} = {}) {
    const tenant = this.#tenant(handle);
    if (!positive(id) || !positive(heapBytes)) die("INVALID_ACTOR_ADMISSION");
    if (tenant.actors.has(id)) die("DUPLICATE_ACTOR");
    if (tenant.actors.size >= tenant.maxActors) die("ACTOR_CAPACITY");
    if (heapBytes > tenant.maxHeapBytes - tenant.heapBytes) die("TENANT_HEAP_QUOTA");
    if (!Number.isSafeInteger(this.#nextActorEpoch + 1)) die("ACTOR_EPOCH_EXHAUSTED");
    const grant = Object.freeze({actorId: id, epoch: this.#nextActorEpoch++});
    const actor = {tenant, id, grant, heap: new Uint8Array(heapBytes), mailbox: [],
      queuedBytes: 0, activeTurn: null};
    tenant.actors.set(id, actor);
    this.#actorGrants.set(grant, actor);
    tenant.heapBytes += heapBytes;
    return grant;
  }

  // This is the *trusted scheduler's* entry point. It supplies a borrowed
  // actor-local view instead of a mutable VM/heap pointer or tenant handle.
  enterActor(handle, grant, callback) {
    const tenant = this.#tenant(handle);
    const actor = this.#actor(tenant, grant);
    if (actor.activeTurn !== null) die("ACTOR_REENTRANCY_DENIED");
    if (typeof callback !== "function") die("INVALID_TURN");
    const token = {};
    actor.activeTurn = token;
    const checkTurn = () => {
      if (actor.activeTurn !== token || tenant.phase !== "running" ||
          tenant.actors.get(actor.id) !== actor) die("TURN_REVOKED");
    };
    const checkOffset = offset => {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= actor.heap.length)
        die("ACTOR_MEMORY_BOUNDS");
    };
    const turn = Object.freeze({
      read: offset => { checkTurn(); checkOffset(offset); return actor.heap[offset]; },
      write: (offset, value) => {
        checkTurn(); checkOffset(offset);
        if (!Number.isInteger(value) || value < 0 || value > 255) die("INVALID_BYTE");
        actor.heap[offset] = value;
      },
      send: (target, payload) => {
        checkTurn();
        const recipient = this.#actor(tenant, target); // rejects cross-tenant refs
        if (!(payload instanceof Uint8Array) ||
            (typeof SharedArrayBuffer !== "undefined" && payload.buffer instanceof SharedArrayBuffer))
          die("UNSAFE_MESSAGE_PAYLOAD");
        if (recipient.mailbox.length >= tenant.maxMessagesPerActor) die("ACTOR_MAIL_QUOTA");
        if (payload.byteLength > tenant.maxMailBytes - tenant.mailBytes) die("TENANT_MAIL_QUOTA");
        if (payload.byteLength > this.#maxHostMailBytes - this.#hostQueuedBytes)
          die("HOST_MAIL_QUOTA");
        const owned = new Uint8Array(payload); // immutable ownership boundary by copy
        recipient.mailbox.push(owned);
        recipient.queuedBytes += owned.byteLength;
        tenant.mailBytes += owned.byteLength;
        this.#hostQueuedBytes += owned.byteLength;
      },
      receive: () => {
        checkTurn();
        const owned = actor.mailbox.shift();
        if (owned === undefined) return null;
        actor.queuedBytes -= owned.byteLength;
        tenant.mailBytes -= owned.byteLength;
        this.#hostQueuedBytes -= owned.byteLength;
        const answer = new Uint8Array(owned); // never give out the private queued buffer
        owned.fill(0);
        return answer;
      }
    });
    try {
      const outcome = callback(turn);
      if (outcome !== null && typeof outcome === "object" && typeof outcome.then === "function")
        die("ASYNC_TURN_REQUIRES_EXPLICIT_CONTINUATION");
      return outcome;
    } finally {
      actor.activeTurn = null;
    }
  }

  #retire(tenant, actor) {
    if (actor.activeTurn !== null) die("ACTIVE_ACTOR_TURN");
    const count = actor.queuedBytes;
    for (const msg of actor.mailbox) msg.fill(0);
    actor.mailbox.length = 0;
    actor.queuedBytes = 0;
    actor.heap.fill(0);
    tenant.heapBytes -= actor.heap.length;
    tenant.mailBytes -= count;
    this.#hostQueuedBytes -= count;
    tenant.actors.delete(actor.id);
    this.#actorGrants.delete(actor.grant);
  }

  retireActor(handle, grant) {
    const tenant = this.#tenant(handle, true);
    this.#retire(tenant, this.#actor(tenant, grant));
  }

  quiesceTenant(handle) {
    const tenant = this.#tenant(handle);
    tenant.phase = "quiescing"; // publish admission fence before draining
  }

  destroyTenant(handle) {
    const tenant = this.#tenant(handle, true);
    if (tenant.phase !== "quiescing" || tenant.actors.size || tenant.mailBytes || tenant.heapBytes)
      die("TENANT_DRAIN_REQUIRED");
    tenant.phase = "destroyed";
    this.#tenants.delete(tenant.id);
    this.#tenantGrants.delete(handle);
  }

  // Source-free logical kill only. NOT evidence of preempting running guest code.
  killTenant(handle) {
    const tenant = this.#tenant(handle, true);
    tenant.phase = "quiescing";
    for (const actor of [...tenant.actors.values()]) this.#retire(tenant, actor);
  }

  snapshot(handle) {
    const tenant = this.#tenant(handle, true);
    return Object.freeze({phase: tenant.phase, actors: tenant.actors.size,
      heapBytes: tenant.heapBytes, queuedBytes: tenant.mailBytes,
      hostQueuedBytes: this.#hostQueuedBytes, generation: handle.generation});
  }
}
