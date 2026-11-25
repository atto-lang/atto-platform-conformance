// Source-free reference model for tenant-isolation v2: many tenant VM-isolates
// in one OS process. It does NOT execute real .atto/.ores actors, allocate a
// real private heap or interrupt real threads; it fixes the admission and
// lifecycle semantics every backend must reproduce.

const TENANT_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const BOUNDARIES = new Set(["trusted-inprocess", "vm-isolate"]);
const UNTRUSTED_GUEST_CODE = new Set(["validated-wasm", "truffle-isolate"]);
const GUEST_CODE = new Set([...UNTRUSTED_GUEST_CODE, "cil", "native"]);
const LIMIT_KEYS = ["heapBytes", "turnDeadlineMs"];

function fail(code) { throw new Error(code); }
function positive(n) { return Number.isSafeInteger(n) && n > 0; }

function checkLimits(limits) {
  if (limits === null || typeof limits !== "object" || Array.isArray(limits) ||
      Object.getPrototypeOf(limits) !== Object.prototype) fail("ISOLATE_LIMITS_REQUIRED");
  const keys = Object.keys(limits);
  if (keys.length !== LIMIT_KEYS.length || keys.some(k => !LIMIT_KEYS.includes(k)))
    fail("ISOLATE_LIMITS_REQUIRED");
  for (const k of LIMIT_KEYS) if (!positive(limits[k])) fail("ISOLATE_LIMITS_REQUIRED");
  return Object.freeze({...limits});
}

export class TenantIsolateReference {
  #entries = new Map();
  #next = 1;
  #limit;
  #capacity;
  #hostMailLimit;
  #hostMail = 0;

  constructor({maxTenants = 2, maxInflight = 1, maxHostMailBytes = 1 << 20} = {}) {
    if (!positive(maxTenants) || !positive(maxInflight) || !positive(maxHostMailBytes))
      fail("INVALID_ROOT_LIMITS");
    this.#limit = maxTenants;
    this.#capacity = maxInflight;
    this.#hostMailLimit = maxHostMailBytes;
  }

  #check(handle) {
    const e = handle && this.#entries.get(handle.id);
    if (!e || e.handle !== handle || e.epoch !== handle.epoch) fail("STALE_TENANT_HANDLE");
    return e;
  }

  create(id, {untrusted = false, boundary = "trusted-inprocess", guestCode,
              limits, processSandbox = false, mailBytes = 1 << 16} = {}) {
    if (!positive(mailBytes)) fail("INVALID_MAIL_QUOTA");
    if (typeof id !== "string" || !TENANT_ID.test(id) || id === "." || id === "..")
      fail("INVALID_ID");
    if (typeof untrusted !== "boolean") fail("INVALID_TRUST_FLAG");
    if (typeof boundary !== "string") fail("INVALID_BOUNDARY");
    if (typeof processSandbox !== "boolean") fail("INVALID_PROCESS_SANDBOX_FLAG");
    if (!BOUNDARIES.has(boundary)) fail("UNSUPPORTED_BOUNDARY");
    // A process sandbox is optional defense in depth. This model has none, so
    // asking for one must fail rather than be silently ignored.
    if (processSandbox) fail("OS_SANDBOX_NOT_IMPLEMENTED");
    if (untrusted && boundary !== "vm-isolate") fail("VM_ISOLATE_REQUIRED");
    let checkedLimits = null;
    if (boundary === "vm-isolate") {
      if (!GUEST_CODE.has(guestCode)) fail("UNKNOWN_GUEST_CODE");
      if (untrusted && guestCode === "native") fail("UNTRUSTED_NATIVE_CODE_REFUSED");
      if (untrusted && guestCode === "cil") fail("UNTRUSTED_CIL_REFUSED");
      if (untrusted && !UNTRUSTED_GUEST_CODE.has(guestCode)) fail("UNKNOWN_GUEST_CODE");
      checkedLimits = checkLimits(limits);
    } else if (guestCode !== undefined || limits !== undefined) {
      fail("ISOLATE_OPTIONS_WITHOUT_ISOLATE");
    }
    if (this.#entries.has(id)) fail("DUPLICATE_TENANT");
    if (this.#entries.size >= this.#limit) fail("TENANT_QUOTA");
    if (this.#next >= Number.MAX_SAFE_INTEGER) fail("GENERATION_EXHAUSTED");
    const handle = Object.freeze({id, epoch: this.#next++});
    this.#entries.set(id, {handle, epoch: handle.epoch, phase: "created", state: 0, heapUsed: 0,
      work: 0, leases: new Set(), scalarTurn: false, maxInflight: this.#capacity,
      limits: checkedLimits, kill: null, endReason: null, mailLimit: mailBytes, mail: new Map()});
    return handle;
  }

  start(h) { const e = this.#check(h); if (e.phase !== "created") fail("PHASE"); e.phase = "running"; }

  lease(h) {
    const e = this.#check(h);
    if (e.phase !== "running") fail("ADMISSION_CLOSED");
    const loan = Object.freeze({identity: Symbol("resource-lease")});
    e.leases.add(loan);
    return loan;
  }

  release(h, loan) {
    const e = this.#check(h);
    if (!e.leases.delete(loan)) fail("FOREIGN_OR_REPLAYED_LEASE");
  }

  #end(e, reason) {
    if (e.phase === "running" || e.phase === "created") e.phase = "quiescing";
    e.endReason ??= reason;
    // The isolate's memory is discarded with it; nothing is unwound.
    e.state = 0;
    e.heapUsed = 0;
    // A dead isolate returns all of its queued mail to the host.
    for (const bytes of e.mail.values()) this.#hostMail -= bytes;
    e.mail.clear();
  }

  // call(state, alloc) runs one guest turn. alloc(bytes) charges the tenant's
  // private heap; the guest never sees another tenant's state or allocator.
  async invoke(h, call) {
    const e = this.#check(h);
    if (e.phase !== "running" || e.work >= e.maxInflight || e.scalarTurn) fail("ADMISSION_CLOSED");
    e.work++;
    e.scalarTurn = true;
    let timer;
    let killed;
    const killSignal = new Promise((_, reject) => { killed = reject; });
    e.kill = killed;
    const alloc = bytes => {
      if (!positive(bytes)) fail("INVALID_ALLOCATION");
      if (e.kill !== killed) fail("TENANT_KILLED");
      if (e.limits && e.heapUsed + bytes > e.limits.heapBytes) fail("HEAP_LIMIT");
      e.heapUsed += bytes;
    };
    const racers = [Promise.resolve().then(() => call(e.state, alloc)), killSignal];
    if (e.limits) racers.push(new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("DEADLINE")), e.limits.turnDeadlineMs);
    }));
    try {
      const delta = await Promise.race(racers);
      // An inflight turn may finish while the tenant drains, unless the
      // isolate already ended (kill, trap, limit).
      if (e.endReason !== null || (e.phase !== "running" && e.phase !== "quiescing")) fail("STOPPED");
      if (!Number.isSafeInteger(delta)) fail("INVALID_RESULT");
      const next = e.state + delta;
      if (!Number.isSafeInteger(next)) fail("OVERFLOW");
      e.state = next;
      return next;
    } catch (err) {
      // Trap, heap limit, deadline or kill: this isolate ends, nobody else does.
      this.#end(e, err instanceof Error ? err.message : "GUEST_TRAP");
      throw err;
    } finally {
      clearTimeout(timer);
      killSignal.catch(() => {});
      e.kill = null;
      e.work--;
      e.scalarTurn = false;
    }
  }

  // Host-initiated termination. It needs no cooperation from guest code and
  // abandons any running turn.
  kill(h) {
    const e = this.#check(h);
    if (e.phase === "stopped") fail("PHASE");
    const running = e.kill;
    this.#end(e, "TENANT_KILLED");
    if (running) running(new Error("TENANT_KILLED"));
  }

  snapshot(h) {
    const e = this.#check(h);
    return {phase: e.phase, epoch: e.epoch, state: e.state, active: e.work,
      heapUsed: e.heapUsed, endReason: e.endReason};
  }

  shutdown(h) {
    const e = this.#check(h);
    if (e.phase !== "running" && e.phase !== "created") fail("PHASE");
    e.phase = "quiescing";
  }

  stop(h) {
    const e = this.#check(h);
    if (e.phase !== "quiescing" || e.work || e.leases.size) fail("DRAIN_REQUIRED");
    e.phase = "stopped";
  }

  // Queue bytes of mail for the tenant. Bounded per tenant and per host, not
  // only per mailbox. Returns an opaque message token for take().
  send(h, bytes) {
    const e = this.#check(h);
    if (e.phase !== "running") fail("ADMISSION_CLOSED");
    if (!positive(bytes)) fail("INVALID_MAIL");
    let queued = 0;
    for (const b of e.mail.values()) queued += b;
    if (bytes > e.mailLimit - queued) fail("TENANT_MAIL_QUOTA");
    if (bytes > this.#hostMailLimit - this.#hostMail) fail("HOST_MAIL_QUOTA");
    const token = Object.freeze({identity: Symbol("mail")});
    e.mail.set(token, bytes);
    this.#hostMail += bytes;
    return token;
  }

  // Deliver one message; its bytes return to both quotas.
  take(h, token) {
    const e = this.#check(h);
    const bytes = e.mail.get(token);
    if (bytes === undefined) fail("FOREIGN_OR_REPLAYED_MAIL");
    e.mail.delete(token);
    this.#hostMail -= bytes;
  }

  mailUsage(h) {
    const e = this.#check(h);
    let tenant = 0;
    for (const b of e.mail.values()) tenant += b;
    return {tenant, host: this.#hostMail};
  }

  destroy(h) {
    const e = this.#check(h);
    if (e.phase !== "stopped") fail("STOP_REQUIRED");
    for (const bytes of e.mail.values()) this.#hostMail -= bytes;
    this.#entries.delete(h.id);
  }
}
