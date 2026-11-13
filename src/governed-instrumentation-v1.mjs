// Source-free reference model for governed runtime instrumentation (tracing
// probes and JIT-recompiled tracing variants). It does NOT compile code, patch
// dispatch tables or export OTLP; it fixes the rules every backend follows.

const MODES = new Set(["off", "probes", "deep"]);
const TRUSTED_PRODUCERS = new Set(["validated-wasm", "truffle-isolate"]);
const FORBIDDEN_ATTRIBUTE = /(^|\.)(payload|body|password|passwd|secret|token|authorization|cookie|api[_-]?key|credential)s?$/i;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

function fail(code) { throw new Error(code); }
function positive(n) { return Number.isSafeInteger(n) && n > 0; }

export class InstrumentationReference {
  #functions = new Map(); // fnId -> record
  #compiling = new Map(); // tenant -> active compile count
  #maxCompiles;
  #nextVersion = 1;

  constructor({maxCompilesPerTenant = 1} = {}) {
    if (!positive(maxCompilesPerTenant)) fail("INVALID_COMPILE_QUOTA");
    this.#maxCompiles = maxCompilesPerTenant;
  }

  // Register an AOT function. Its AOT version stays authoritative forever.
  register(tenant, fnId, {untrusted = false, deepEligible = true, realtime = false} = {}) {
    if (this.#functions.has(fnId)) fail("DUPLICATE_FUNCTION");
    const aot = {id: this.#nextVersion++, kind: "aot", leases: 0, retired: false};
    this.#functions.set(fnId, {fnId, tenant, untrusted, deepEligible, realtime, aot,
      active: aot, live: new Set([aot]), probes: false});
  }

  #authorize(principal, tenant) {
    if (!principal || principal.kind !== "operator") fail("GUEST_CANNOT_INSTRUMENT");
    if (!Array.isArray(principal.tenants) || !principal.tenants.includes(tenant))
      fail("CROSS_TENANT_INSTRUMENTATION");
  }

  // Change instrumentation for functions of ONE tenant. Returns compile jobs
  // for deep mode; probes and off take effect at once.
  request(principal, tenant, fnIds, mode) {
    this.#authorize(principal, tenant);
    if (!MODES.has(mode)) fail("UNKNOWN_MODE");
    if (!Array.isArray(fnIds) || fnIds.length === 0) fail("EMPTY_SCOPE");
    const records = fnIds.map(id => {
      const r = this.#functions.get(id);
      if (!r) fail("UNKNOWN_FUNCTION");
      if (r.tenant !== tenant) fail("FOREIGN_FUNCTION");
      return r;
    });
    // Validate the whole scope before changing anything.
    if (mode === "deep") {
      for (const r of records) {
        if (!r.deepEligible) fail("DEEP_UNSUPPORTED");
        if (r.realtime) fail("REALTIME_SECTION_FORBIDDEN");
      }
      const busy = this.#compiling.get(tenant) ?? 0;
      if (busy + records.length > this.#maxCompiles) fail("COMPILE_QUOTA");
    }
    if (mode === "off") {
      for (const r of records) { r.probes = false; this.#switch(r, r.aot); }
      return [];
    }
    if (mode === "probes") { for (const r of records) r.probes = true; return []; }
    this.#compiling.set(tenant, (this.#compiling.get(tenant) ?? 0) + records.length);
    return records.map(r => Object.freeze({fnId: r.fnId, tenant, state: {done: false}}));
  }

  // Runs on the compile service, never on an actor thread. `artifact` is what
  // the producer returned, or an Error if compilation failed.
  complete(job, artifact) {
    if (job.state.done) fail("JOB_ALREADY_COMPLETE");
    job.state.done = true;
    this.#compiling.set(job.tenant, this.#compiling.get(job.tenant) - 1);
    const r = this.#functions.get(job.fnId);
    // AOT stays authoritative: any failure leaves the current version running.
    if (artifact instanceof Error) return {installed: false, reason: "COMPILE_FAILED"};
    if (!artifact || artifact.fnId !== job.fnId || artifact.tenant !== job.tenant)
      return {installed: false, reason: "ARTIFACT_MISMATCH"};
    if (r.untrusted && !(artifact.validated === true && TRUSTED_PRODUCERS.has(artifact.producer)))
      return {installed: false, reason: "INSTRUMENTED_CODE_UNVALIDATED"};
    const version = {id: this.#nextVersion++, kind: "deep", leases: 0, retired: false};
    r.live.add(version);
    this.#switch(r, version);
    return {installed: true, version: version.id};
  }

  // Versioned dispatch: new calls use the new version; the old one stays live
  // until its in-flight calls end. The AOT version is never retired.
  #switch(r, next) {
    const prev = r.active;
    r.active = next;
    if (prev !== next && prev.kind !== "aot" && prev.leases === 0) this.#retire(r, prev);
  }

  #retire(r, v) { v.retired = true; r.live.delete(v); }

  enter(fnId) {
    const r = this.#functions.get(fnId) ?? fail("UNKNOWN_FUNCTION");
    r.active.leases++;
    return Object.freeze({fnId, version: r.active, probes: r.probes});
  }

  exit(lease) {
    const r = this.#functions.get(lease.fnId);
    const v = lease.version;
    if (v.leases <= 0) fail("LEASE_UNDERFLOW");
    v.leases--;
    if (v !== r.active && v.kind !== "aot" && v.leases === 0) this.#retire(r, v);
  }

  state(fnId) {
    const r = this.#functions.get(fnId) ?? fail("UNKNOWN_FUNCTION");
    return {active: r.active.kind, activeVersion: r.active.id, probes: r.probes,
      liveVersions: [...r.live].map(v => v.id).sort((a, b) => a - b)};
  }
}

// Bounded per-tenant telemetry buffer: never grows, never blocks, counts drops,
// and refuses attributes that could carry payloads or secrets.
export class TelemetryBuffer {
  #events = [];
  #capacity;
  #allowed;
  #maxValuesPerKey;
  #values = new Map();
  dropped = 0;
  redacted = 0;

  constructor({capacity, allowedAttributes, maxValuesPerKey = 64}) {
    if (!positive(capacity) || !positive(maxValuesPerKey)) fail("INVALID_BUFFER");
    this.#capacity = capacity;
    this.#allowed = new Set(allowedAttributes);
    this.#maxValuesPerKey = maxValuesPerKey;
  }

  record(name, attributes = {}) {
    if (this.#events.length >= this.#capacity) { this.dropped++; return false; }
    const kept = {};
    for (const [k, v] of Object.entries(attributes)) {
      if (FORBIDDEN_ATTRIBUTE.test(k) || !this.#allowed.has(k) ||
          !(typeof v === "string" || Number.isSafeInteger(v) || typeof v === "boolean")) {
        this.redacted++; continue;
      }
      const seen = this.#values.get(k) ?? new Set();
      if (!seen.has(v) && seen.size >= this.#maxValuesPerKey) { this.redacted++; continue; }
      seen.add(v); this.#values.set(k, seen);
      kept[k] = v;
    }
    this.#events.push(Object.freeze({name, attributes: Object.freeze(kept)}));
    return true;
  }

  // The exporter drains asynchronously; recording never waits on it.
  drain(max) {
    if (!positive(max)) fail("INVALID_DRAIN");
    return this.#events.splice(0, max);
  }
}

// Trace context carried immutably in an actor message envelope. Incoming W3C
// traceparent is correlation only: invalid input starts a fresh trace, and it
// never carries tenant identity or authority.
export function envelopeContext(traceparent, newIds) {
  const m = typeof traceparent === "string" ? TRACEPARENT.exec(traceparent) : null;
  const valid = m && !/^0+$/.test(m[1]) && !/^0+$/.test(m[2]);
  const traceId = valid ? m[1] : newIds.traceId();
  const parentSpanId = valid ? m[2] : null;
  const sampled = valid ? (parseInt(m[3], 16) & 1) === 1 : false;
  return Object.freeze({traceId, parentSpanId, sampled, trusted: false});
}
