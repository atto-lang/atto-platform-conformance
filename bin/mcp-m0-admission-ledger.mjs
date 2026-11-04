// M0 SOURCE-FREE REFERENCE POLICY ONLY. Not a network listener, credential issuer,
// concurrency primitive across processes, runtime admission gate or guest proof.
import { createHmac } from 'node:crypto';

const LIMITS = Object.freeze({
  frameBytes: 32768, jsonDepth: 12, responseBytes: 65536, deadlineMs: 500,
  perSecond: 8, perMinute: 60, inflight: 2, replayNonces: 128,
  replayWindowMs: 60000, clockSkewMs: 30000, auditBytes: 2048,
  principals: 64, globalInflight: 128,
});
const VERSION = 'atto.mcp.dev-control.m0.v1';
const PROTOCOL = '2026-07-28';
const METHODS = new Set(['server/discover','tools/list','resources/list','resources/read']);
const ID = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,128}$/;
const NONCE = /^[0-9a-f]{32,64}$/;
const URI = /^atto-dev:\/\/runtime\/(?!\.{1,2}\/)([A-Za-z0-9_.-]{1,128})\/tenant\/(?!\.{1,2}\/)([A-Za-z0-9_.-]{1,128})\/(process\/summary|actors\/counters|tasks\/counters|scheduler\/counters|upgrade\/status)$/;
const SCOPES = new Set(['inspect:catalog','inspect:summary','inspect:metrics','inspect:upgrade_status']);
const safeInteger = n => Number.isSafeInteger(n) && n >= 0;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const validKeys = (obj, keys) => Object.keys(obj).every(k => keys.includes(k));
const reasonCodes = new Set(['OK','DISABLED','UNAUTHENTICATED','SCOPE','TENANT','RUNTIME','GENERATION','VERSION','REPLAY','QUOTA','MALFORMED','UNSUPPORTED','TIMEOUT','AUDIT_FAILURE','OVERFLOW','DUPLICATE_ID']);

export class M0AdmissionLedger {
  #states = new Map();
  #tickets = new Map();
  #enabled;
  #audit;
  #auditKey;
  #globalInflight = 0;

  constructor({ enabled = false, audit = null, auditKey = null } = {}) {
    // A missing or invalid synchronous audit sink or key fails closed.
    this.#enabled = enabled === true;
    this.#audit = typeof audit === 'function' ? audit : null;
    this.#auditKey = Buffer.isBuffer(auditKey) && auditKey.length >= 32 ? Buffer.from(auditKey) : null;
  }

  #hash(value) {
    return createHmac('sha256', this.#auditKey).update(String(value)).digest('hex');
  }

  #emit(decision, reason, { credential, request, frameBytes = 0, responseBytes = 0, elapsedMs = 0, wallNowMs = null } = {}) {
    if (!this.#audit || !this.#auditKey || !reasonCodes.has(reason)) return false;
    try {
      const identity = credential || {};
      const method = request && METHODS.has(request.method) ? request.method : '<unsupported>';
      const record = {
        schema: 'atto.mcp.audit.v1',
        timestamp: new Date(safeInteger(wallNowMs) && wallNowMs <= 8640000000000000 ? wallNowMs : 0).toISOString(),
        principal_hash: this.#hash(identity.principal_id ?? 'unknown'),
        tenant_hash: this.#hash(identity.tenant_id ?? 'unknown'),
        runtime_hash: this.#hash(identity.runtime_id ?? 'unknown'),
        request_id_hash: this.#hash(request?.id ?? 'unknown'),
        method, decision, reason,
        request_bytes: safeInteger(frameBytes) ? Math.min(frameBytes, LIMITS.frameBytes) : 0,
        response_bytes: safeInteger(responseBytes) ? Math.min(responseBytes, LIMITS.responseBytes) : 0,
        elapsed_ms: safeInteger(elapsedMs) ? elapsedMs : 0,
        generation: safeInteger(identity.generation) ? identity.generation : 0,
      };
      if (Buffer.byteLength(JSON.stringify(record)) > LIMITS.auditBytes) return false;
      // An asynchronous Promise would mean authorization before durable audit; deny.
      if (this.#audit(record) !== true) return false;
      return true;
    } catch { return false; }
  }

  #deny(reason, context) {
    return { ok: false, reason: this.#emit('deny', reason, context) ? reason : 'AUDIT_FAILURE' };
  }

  // All lookup, check, audit and reservation work is synchronous: there is no
  // await between observing a nonce / request ID and reserving it.
  begin({ peerAuthenticated = false, credential = null, request = null,
          hostBootId = null, hostRuntimeGeneration = NaN, wallNowMs = NaN, monotonicNowMs = NaN,
          frameBytes = NaN, jsonDepth = NaN } = {}) {
    const context = { credential, request, frameBytes, wallNowMs };
    const deny = reason => this.#deny(reason, context);
    if (!this.#enabled) return deny('DISABLED');
    if (!peerAuthenticated || !object(credential) || !(typeof credential.principal_id === 'string' && ID.test(credential.principal_id)) ||
        !(typeof credential.boot_id === 'string' && ID.test(credential.boot_id)) || !(typeof credential.runtime_id === 'string' && ID.test(credential.runtime_id)) ||
        !(typeof credential.tenant_id === 'string' && ID.test(credential.tenant_id)) || !safeInteger(credential.generation) ||
        credential.generation < 1 || !safeInteger(credential.expires_at_ms) ||
        !Array.isArray(credential.scopes) || credential.scopes.length > 4 ||
        credential.scopes.some(s => !SCOPES.has(s)) ||
        new Set(credential.scopes).size !== credential.scopes.length) return deny('UNAUTHENTICATED');
    if (!safeInteger(wallNowMs) || !safeInteger(monotonicNowMs) ||
        !safeInteger(frameBytes) || !safeInteger(jsonDepth) || frameBytes === 0) return deny('MALFORMED');
    if (frameBytes > LIMITS.frameBytes || jsonDepth > LIMITS.jsonDepth) return deny('OVERFLOW');
    if (credential.expires_at_ms <= wallNowMs) return deny('UNAUTHENTICATED');
    if (hostBootId !== credential.boot_id || !safeInteger(hostRuntimeGeneration) ||
        hostRuntimeGeneration !== credential.generation) return deny('GENERATION');
    const key = [credential.boot_id,credential.principal_id,credential.runtime_id,credential.tenant_id].join('\0');
    let state = this.#states.get(key);
    if (!state && this.#states.size >= LIMITS.principals) {
      // Reclaim only fully idle, expired states. Never evict active tickets,
      // live nonces or rate-window evidence to make room for a new principal.
      for (const [staleKey, old] of this.#states) {
        if (old.ids.size === 0 &&
            old.minute.every(t => monotonicNowMs - t >= 60000) &&
            [...old.nonces.values()].every(exp => exp <= monotonicNowMs)) {
          this.#states.delete(staleKey);
        }
      }
      if (this.#states.size >= LIMITS.principals) return deny('QUOTA');
    }
    if (state && monotonicNowMs < state.lastMonotonicMs) return deny('MALFORMED');
    const second = state ? state.second.filter(t => monotonicNowMs-t < 1000) : [];
    const minute = state ? state.minute.filter(t => monotonicNowMs-t < 60000) : [];
    // The rate budget charges *every* authenticated request attempt, including
    // malformed, unsupported and denied requests; otherwise a client could
    // bypass quotas by sending bad methods that still consume audit resources.
    if (second.length >= LIMITS.perSecond || minute.length >= LIMITS.perMinute)
      return deny('QUOTA');
    if (!state) state = { ids:new Map(),nonces:new Map(),second:[],minute:[],lastMonotonicMs:monotonicNowMs };
    state.second = second;
    state.minute = minute;
    state.lastMonotonicMs = monotonicNowMs;
    state.second.push(monotonicNowMs);
    state.minute.push(monotonicNowMs);
    this.#states.set(key,state);
    if (!object(request) || !validKeys(request, ['jsonrpc','id','method','params']) ||
        request.jsonrpc !== '2.0' ||
        !(typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 64) &&
        !(safeInteger(request.id)) || !object(request.params) ||
        !validKeys(request.params, ['uri','_meta']) || !object(request.params._meta)) return deny('MALFORMED');
    if (!METHODS.has(request.method)) return deny('UNSUPPORTED');
    const meta = request.params._meta;
    if (!validKeys(meta, ['io.modelcontextprotocol/protocolVersion', 'io.modelcontextprotocol/clientCapabilities',
                          'io.modelcontextprotocol/clientInfo', 'io.modelcontextprotocol/logLevel', 'io.atto.dev/security'])) return deny('MALFORMED');
    if (meta['io.modelcontextprotocol/protocolVersion'] !== PROTOCOL) return deny('VERSION');
    const caps = meta['io.modelcontextprotocol/clientCapabilities'];
    if (!object(caps) || Object.keys(caps).length > 16 || Object.values(caps).some(v => !object(v) || Object.keys(v).length > 16)) return deny('MALFORMED');
    const client = meta['io.modelcontextprotocol/clientInfo'];
    if (client !== undefined && (!object(client) || !validKeys(client,['name','version','title','websiteUrl']) ||
       (client.title !== undefined && (typeof client.title !== 'string' || client.title.length > 128)) ||
       (client.websiteUrl !== undefined && (typeof client.websiteUrl !== 'string' || !/^https?:\/\//.test(client.websiteUrl) || client.websiteUrl.length > 512)) ||
       typeof client.name !== 'string' || !client.name.length || client.name.length > 128 ||
       typeof client.version !== 'string' || !client.version.length || client.version.length > 64)) return deny('MALFORMED');
    if (meta['io.modelcontextprotocol/logLevel'] !== undefined &&
        !['debug','info','notice','warning','error','critical','alert','emergency'].includes(meta['io.modelcontextprotocol/logLevel'])) return deny('MALFORMED');
    const security = meta['io.atto.dev/security'];
    if (!object(security) || !validKeys(security,['schema_version','nonce','issued_at_ms','runtime_id','tenant_id','expected_generation']) ||
        security.schema_version !== VERSION) return deny('VERSION');
    if (!NONCE.test(security.nonce ?? '') || !safeInteger(security.issued_at_ms) ||
        Math.abs(wallNowMs - security.issued_at_ms) > LIMITS.clockSkewMs ||
        !safeInteger(security.expected_generation)) return deny('MALFORMED');
    if (security.runtime_id !== credential.runtime_id) return deny('RUNTIME');
    if (security.tenant_id !== credential.tenant_id) return deny('TENANT');
    if (security.expected_generation !== credential.generation) return deny('GENERATION');
    let scope = 'inspect:catalog';
    if (request.method === 'resources/read') {
      const uri = typeof request.params.uri === 'string' ? URI.exec(request.params.uri) : null;
      if (!uri) return deny('MALFORMED');
      if (uri[1] !== credential.runtime_id) return deny('RUNTIME');
      if (uri[2] !== credential.tenant_id) return deny('TENANT');
      scope = uri[3] === 'upgrade/status' ? 'inspect:upgrade_status' :
              uri[3] === 'process/summary' ? 'inspect:summary' : 'inspect:metrics';
    } else if (request.params.uri !== undefined) return deny('MALFORMED');
    if (!credential.scopes.includes(scope)) return deny('SCOPE');

    const nonces = new Map([...state.nonces].filter(([,expiry]) => expiry > monotonicNowMs));
    if (nonces.has(security.nonce)) return deny('REPLAY');
    if (state?.ids.has(request.id)) return deny('DUPLICATE_ID');
    if ((state?.ids.size || 0) >= LIMITS.inflight || this.#globalInflight >= LIMITS.globalInflight ||
        nonces.size >= LIMITS.replayNonces) return deny('QUOTA');

    if (!this.#emit('allow','OK',context)) return { ok:false, reason:'AUDIT_FAILURE' };
    state.ids = new Map(state.ids);
    state.nonces = nonces;
    state.nonces.set(security.nonce, monotonicNowMs + LIMITS.replayWindowMs);
    const ticket = Object.freeze(Object.create(null));
    state.ids.set(request.id, ticket);
    this.#states.set(key,state);
    this.#tickets.set(ticket,{key,id:request.id,deadline:monotonicNowMs+LIMITS.deadlineMs,generation:credential.generation,boot:credential.boot_id,expiresAtWall:credential.expires_at_ms});
    this.#globalInflight++;
    return { ok:true,reason:'OK',ticket };
  }

  // Idempotent across completion, cancellation and disconnect; stale tickets
  // never release a newer request that reused the same JSON-RPC ID.
  finish(ticket) {
    const ref = this.#tickets.get(ticket);
    if (!ref) return false;
    const state = this.#states.get(ref.key);
    if (!state || state.ids.get(ref.id) !== ticket) return false;
    state.ids.delete(ref.id);
    this.#tickets.delete(ticket);
    this.#globalInflight--;
    return true;
  }

  live(ticket, monotonicNowMs, hostRuntimeGeneration, wallNowMs, hostBootId, peerAuthenticated) {
    const ref=this.#tickets.get(ticket);
    return !!ref && peerAuthenticated === true && hostBootId === ref.boot &&
           safeInteger(monotonicNowMs) && monotonicNowMs<=ref.deadline &&
           safeInteger(hostRuntimeGeneration) && hostRuntimeGeneration===ref.generation &&
           safeInteger(wallNowMs) && wallNowMs < ref.expiresAtWall;
  }

  // Test-only counters, never a management resource.
  stats() { return { principals:this.#states.size, active:this.#globalInflight }; }
}
