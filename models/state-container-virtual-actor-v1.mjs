// Source-free, single-threaded semantic reference model. NOT a guest runtime.
// It tests proposed invariants, not compilation, distributed placement or memory safety.
const isPromise = value => value !== null &&
  (typeof value === "object" || typeof value === "function") &&
  typeof value.then === "function";

function requireSync(value) {
  if (isPromise(value)) throw new TypeError("critical guard cannot suspend");
  return value;
}

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function guardedView(target) {
  const cache = new WeakMap();
  const revocations = [];
  function wrap(object) {
    if (!object || typeof object !== "object") return object;
    if (cache.has(object)) return cache.get(object);
    const { proxy, revoke } = Proxy.revocable(object, {
      get(source, key, receiver) { return wrap(Reflect.get(source, key, receiver)); },
      set(source, key, value, receiver) {
        if (value !== null && typeof value === "object") {
          throw new TypeError("reference-model writer requires scalar assignments");
        }
        return Reflect.set(source, key, value, receiver);
      },
      getOwnPropertyDescriptor(source, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
        // The model intentionally does not expose raw nested referents via descriptors.
        if (descriptor && "value" in descriptor && typeof descriptor.value === "object") {
          throw new TypeError("nested descriptor escape unsupported");
        }
        return descriptor;
      }
    });
    cache.set(object, proxy);
    revocations.push(revoke);
    return proxy;
  }
  return { view: wrap(target), revoke() { for (const revoke of revocations) revoke(); } };
}

export class StateContainerReference {
  #state; #readers = 0; #writer = false; #closed = false;
  constructor(initial) {
    if (!initial || typeof initial !== "object" || Array.isArray(initial))
      throw new TypeError("state root must be a record");
    this.#state = structuredClone(initial);
  }
  #checkOpen() { if (this.#closed) throw new Error("state container closed"); }
  read(callback) {
    this.#checkOpen();
    if (this.#writer) throw new Error("critical read conflicts with writer");
    this.#readers++;
    try {
      // Detached snapshot: returned data cannot alias the live state.
      return requireSync(callback(freezeDeep(structuredClone(this.#state))));
    } finally { this.#readers--; }
  }
  write(callback) {
    this.#checkOpen();
    if (this.#writer || this.#readers) throw new Error("critical write conflict");
    this.#writer = true;
    const guard = guardedView(this.#state);
    try {
      const result = requireSync(callback(guard.view));
      // This narrow reference model cannot prove returned mutable ownership.
      if (result !== null && (typeof result === "object" || typeof result === "function"))
        throw new TypeError("mutable alias escape from critical guard");
      return result;
    } finally {
      // Mutations before any failure remain visible: a guard is not a transaction.
      guard.revoke();
      this.#writer = false;
    }
  }
  close() {
    if (this.#readers || this.#writer) throw new Error("state container busy");
    this.#closed = true;
  }
}

// Identity is keyed by a tuple, not string concatenation; object handles are
// unforgeable in this reference process via a private WeakMap.
export class VirtualActorDirectoryReference {
  #factories = new Map();
  #records = new Map();
  #handles = new WeakMap();
  #incarnations = new WeakMap();
  #onControl;
  #capacity;
  #domain;
  constructor({ domain = "local", capacity = 8, onControl = () => {} } = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError("mailbox capacity must be positive");
    this.#domain = domain;
    this.#capacity = capacity;
    this.#onControl = onControl;
  }
  register(declarationId, create) {
    if (typeof declarationId !== "string" || !declarationId ||
        typeof create !== "function" || this.#factories.has(declarationId))
      throw new TypeError("invalid or duplicate virtual actor declaration");
    this.#factories.set(declarationId, create);
  }
  resolve(declarationId, key) {
    if (!this.#factories.has(declarationId)) throw new Error("unknown virtual actor");
    if (typeof key !== "string") throw new TypeError("virtual actor key must be a string");
    key = key.normalize("NFC");
    if (Buffer.byteLength(key, "utf8") > 256) throw new RangeError("key too long");
    const identity = JSON.stringify([this.#domain, declarationId, key]);
    let record = this.#records.get(identity);
    if (!record) {
      record = { declarationId, identity, key, incarnation: 0,
        active: false, actor: null, processing: false, mailbox: [] };
      this.#records.set(identity, record);
    }
    const ref = Object.freeze({ logicalId: identity });
    this.#handles.set(ref, record);
    return ref;
  }
  #record(ref) {
    const r = ref && this.#handles.get(ref);
    if (!r) throw new Error("invalid virtual actor capability");
    return r;
  }
  #activate(record) {
    if (record.active) return;
    if (record.incarnation >= Number.MAX_SAFE_INTEGER) throw new Error("incarnation exhausted");
    const incarnation = ++record.incarnation;
    const actor = this.#factories.get(record.declarationId)();
    if (!actor || typeof actor.receive !== "function")
      throw new TypeError("virtual actor activation must provide receive");
    record.actor = actor;
    record.active = true;
    record.currentIncarnation = incarnation;
  }
  incarnationCapability(ref) {
    const record = this.#record(ref);
    this.#activate(record);
    const token = Object.freeze({});
    this.#incarnations.set(token, { record, incarnation: record.incarnation });
    return token;
  }
  isCurrentIncarnation(token) {
    const cell = token && this.#incarnations.get(token);
    return !!cell && cell.record.active && cell.record.incarnation === cell.incarnation;
  }
  send(ref, message) {
    const record = this.#record(ref);
    // A rejected admission must not silently create a different acceptance.
    if (record.mailbox.length >= this.#capacity) return { ok: false, error: "BACKPRESSURE" };
    try { this.#activate(record); }
    catch { return { ok: false, error: "ACTIVATION_FAILED" }; }
    record.mailbox.push(structuredClone(message));
    return { ok: true, admitted: true, incarnation: record.incarnation };
  }
  deliverNext(ref) {
    const record = this.#record(ref);
    if (record.processing) throw new Error("already delivering");
    if (!record.active || !record.mailbox.length) return false;
    const message = record.mailbox.shift();
    record.processing = true;
    try {
      requireSync(record.actor.receive(message));
      return true;
    } catch (error) {
      // Panic and any accepted but undelivered messages get an explicit notice.
      const failed = 1 + record.mailbox.length;
      record.mailbox = [];
      record.active = false;
      record.actor = null;
      this.#onControl({ kind: "PANIC", logicalId: record.identity,
        incarnation: record.incarnation, failedAcceptedCount: failed,
        errorKind: error?.name ?? "Error" });
      return false;
    } finally { record.processing = false; }
  }
  deactivate(ref) {
    const record = this.#record(ref);
    if (record.processing || record.mailbox.length) throw new Error("virtual actor busy");
    record.active = false;
    record.actor = null;
  }
  inspect(ref) {
    const record = this.#record(ref);
    return Object.freeze({ active: record.active,
      incarnation: record.incarnation, queued: record.mailbox.length });
  }
}
