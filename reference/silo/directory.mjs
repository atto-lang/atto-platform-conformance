// Trusted-host, single-process deterministic reference. NOT an OresVM actor runtime,
// network service, distributed lease authority, or sandbox implementation.
import { encode_actor_id, decode_actor_id, actor_storage_key_from_bytes, parse_actor_ref_token } from '../persistence-sidecar/identity.mjs';

export class SiloReferenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const deny = code => { throw new SiloReferenceError(code); };
const MAX_EPOCH = Number.MAX_SAFE_INTEGER;
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  value === value.normalize('NFC') && !/[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(value);
const machine_name = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value >= 1 && value <= 1000000;
const BACKENDS = new Set(['java', 'llvm', 'net', 'wasm', 'forge']);
const MODES = new Set(['actor-local', 'tenant-protected']);
const copy_route = rec => Object.freeze({
  actor_ref: rec.actor_ref, node_id: rec.node_id, isolate_id: rec.isolate_id,
  tenant_id: rec.tenant_id, backend: rec.backend, epoch: rec.epoch
});

export class InMemorySiloDirectory {
  #nodes = new Map();
  #active = new Map();
  #epochs = new Map();
  #bindings = new Map();
  #contexts = new WeakMap();
  #max_nodes;
  #max_actors;
  constructor({ max_nodes = 64, max_actors = 10000 } = {}) {
    if (!positive(max_nodes) || !positive(max_actors)) deny('INVALID_LIMIT');
    this.#max_nodes = max_nodes;
    this.#max_actors = max_actors;
  }

  // TRUSTED HOST ONLY: not a login endpoint or a capability to give to guest code.
  // A real broker MUST authenticate principals before granting this context.
  make_trusted_tenant_context(tenant_id) {
    if (!name(tenant_id) || Buffer.byteLength(tenant_id, 'utf8') > 128) deny('INVALID_TENANT');
    const context = Object.freeze(Object.create(null));
    this.#contexts.set(context, tenant_id);
    return context;
  }

  // TRUSTED CONTROL PLANE ONLY: descriptors attest nothing about actual OS isolation.
  register_node({ node_id, backend, region, isolates }) {
    if (!machine_name(node_id) || !machine_name(region) || !BACKENDS.has(backend)) deny('INVALID_NODE');
    if (this.#nodes.has(node_id)) deny('NODE_ID_REUSE'); // reboot requires new incarnation ID
    if (this.#nodes.size >= this.#max_nodes) deny('NODE_QUOTA');
    if (!Array.isArray(isolates) || isolates.length < 1 || isolates.length > 1024) deny('INVALID_ISOLATES');
    const by_tenant = new Map(), seen_isolates = new Set();
    for (const iso of isolates) {
      if (!iso || typeof iso !== 'object' || Array.isArray(iso)) deny('INVALID_ISOLATE');
      // Read each caller-controlled descriptor field exactly once. A getter
      // must not validate one tenant/capability and publish another.
      const { tenant_id, isolate_id, max_actors, isolation_mode, capabilities } = iso;
      if (!name(tenant_id) || Buffer.byteLength(tenant_id, 'utf8') > 128 ||
          !machine_name(isolate_id) || !positive(max_actors) || !MODES.has(isolation_mode)) {
        deny('INVALID_ISOLATE');
      }
      if (by_tenant.has(tenant_id)) deny('DUPLICATE_TENANT_ISOLATE');
      if (seen_isolates.has(isolate_id)) deny('ISOLATE_REUSED_ACROSS_TENANTS');
      if (!Array.isArray(capabilities)) deny('INVALID_CAPABILITIES');
      const advertised_caps = [...capabilities];
      if (advertised_caps.length > 32 || advertised_caps.some(c => !machine_name(c)) ||
          new Set(advertised_caps).size !== advertised_caps.length) deny('INVALID_CAPABILITIES');
      seen_isolates.add(isolate_id);
      by_tenant.set(tenant_id, {
        tenant_id, isolate_id, max_actors, isolation_mode,
        capabilities: new Set(advertised_caps), active: 0
      });
    }
    // Descriptor getters can reenter trusted control-plane code. Re-check
    // admission immediately before the atomic directory publication.
    if (this.#nodes.has(node_id)) deny('NODE_ID_REUSE');
    if (this.#nodes.size >= this.#max_nodes) deny('NODE_QUOTA');
    this.#nodes.set(node_id, { node_id, backend, region, status: 'READY', by_tenant });
  }

  #trusted_identity(context, id) {
    const tenant_id = this.#contexts.get(context);
    if (tenant_id === undefined) deny('UNAUTHENTICATED');
    let bytes, decoded, key;
    try {
      bytes = encode_actor_id(id); // exactly one snapshot of caller-controlled fields
      decoded = decode_actor_id(bytes);
      key = actor_storage_key_from_bytes(bytes);
    } catch { deny('INVALID_ACTOR_ID'); }
    if (decoded.tenant !== tenant_id) deny('WRONG_TENANT');
    const binding = this.#bindings.get(key);
    if (binding && !binding.equals(bytes)) deny('ACTOR_ID_HASH_COLLISION');
    return { tenant_id, bytes, key, actor_ref: 'oa1_' + bytes.toString('base64url') };
  }

  #choose(tenant_id, { backend, region, isolation_mode, capabilities }) {
    const candidates = [];
    for (const node of this.#nodes.values()) {
      if (node.status !== 'READY' || (backend && node.backend !== backend) ||
          (region && node.region !== region)) continue;
      const iso = node.by_tenant.get(tenant_id);
      if (!iso || iso.isolation_mode !== isolation_mode || iso.active >= iso.max_actors ||
          !capabilities.every(c => iso.capabilities.has(c))) continue;
      candidates.push({ node, iso });
    }
    // Locale-independent binary-order tie-break, stable across host locales.
    candidates.sort((a, b) => a.iso.active - b.iso.active ||
      (a.node.node_id < b.node.node_id ? -1 : a.node.node_id > b.node.node_id ? 1 : 0));
    return candidates[0];
  }

  // Never interpret a descriptor as proof of native/OS tenant isolation.
  // This reference only models the trusted actor-local profile.
  #placement(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) deny('INVALID_PLACEMENT');
    // Unknown mandatory constraints (e.g. schema/ABI/version) are not silently
    // ignored; the real broker must implement them before admission.
    const known = new Set(['backend', 'region', 'isolation_mode', 'capabilities', 'hard_realtime']);
    // Reject inherited, symbol and non-enumerable fields instead of silently
    // admitting a layout that may conceal a mandatory hard placement rule.
    // A null-prototype record is accepted; an inherited object is not.
    const proto = Object.getPrototypeOf(options);
    if (proto !== Object.prototype && proto !== null) deny('UNSUPPORTED_PLACEMENT_CONSTRAINT');
    if (Reflect.ownKeys(options).some(k => typeof k !== 'string' || !known.has(k)))
      deny('UNSUPPORTED_PLACEMENT_CONSTRAINT');
    // Destructuring defaults read inherited Object.prototype fields. Only
    // explicit own constraints may affect placement, even under pollution.
    const own = (key, fallback) => Object.hasOwn(options, key) ? options[key] : fallback;
    const backend = own('backend', null), region = own('region', null),
      isolation_mode = own('isolation_mode', 'actor-local'),
      capabilities = own('capabilities', []), hard_realtime = own('hard_realtime', false);
    if (!Array.isArray(capabilities)) deny('INVALID_PLACEMENT');
    const required_caps = [...capabilities];
    if ((backend !== null && !BACKENDS.has(backend)) || (region !== null && !machine_name(region)) ||
        required_caps.length > 32 || required_caps.some(c => !machine_name(c)) ||
        new Set(required_caps).size !== required_caps.length ||
        typeof hard_realtime !== 'boolean') deny('INVALID_PLACEMENT');
    if (hard_realtime) deny('DYNAMIC_ACTIVATION_FORBIDDEN_IN_HARD_RT');
    if (isolation_mode !== 'actor-local') deny('ISOLATION_NOT_VERIFIED');
    return { backend, region, isolation_mode, capabilities: required_caps };
  }

  #activate_identity(identity, placement) {
    if (this.#active.has(identity.key)) deny('ALREADY_ACTIVE');
    if (this.#active.size >= this.#max_actors) deny('ACTOR_QUOTA');
    const candidate = this.#choose(identity.tenant_id, placement);
    if (!candidate) deny('NO_COMPATIBLE_TENANT_ISOLATE');
    const old_epoch = this.#epochs.get(identity.key) || 0;
    if (old_epoch >= MAX_EPOCH) deny('EPOCH_EXHAUSTED');
    const epoch = old_epoch + 1;
    const { node, iso } = candidate;
    const rec = { key: identity.key, actor_ref: identity.actor_ref, tenant_id: identity.tenant_id,
      node_id: node.node_id, isolate_id: iso.isolate_id, backend: node.backend, epoch };
    this.#bindings.set(identity.key, Buffer.from(identity.bytes));
    this.#epochs.set(identity.key, epoch);
    this.#active.set(identity.key, rec);
    iso.active++;
    return copy_route(rec);
  }

  // TRUSTED HOST ONLY. The in-memory epoch cannot fence remote state writes;
  // no callback, guest method, persistence or network RPC is executed here.
  activate_actor(context, id, options = {}) {
    const identity = this.#trusted_identity(context, id);
    return this.#activate_identity(identity, this.#placement(options));
  }

  // Orleans-style lazy *directory* resolution. Identity is snapshotted once
  // (including hostile getters) and all hard placement constraints are checked
  // on an already-active route. Never create a second activation to satisfy an
  // incompatible call, or use a logical ref as a bearer credential.
  resolve_or_activate_actor(context, id, options = {}) {
    const identity = this.#trusted_identity(context, id);
    const placement = this.#placement(options);
    const current = this.#active.get(identity.key);
    if (!current) return this.#activate_identity(identity, placement);
    const node = this.#nodes.get(current.node_id);
    const iso = node?.by_tenant.get(identity.tenant_id);
    if (!node || (node.status !== 'READY' && node.status !== 'DRAINING') ||
        !iso || iso.isolate_id !== current.isolate_id ||
        iso.isolation_mode !== placement.isolation_mode ||
        (placement.backend !== null && node.backend !== placement.backend) ||
        (placement.region !== null && node.region !== placement.region) ||
        !placement.capabilities.every(c => iso.capabilities.has(c))) {
      deny('INCOMPATIBLE_ACTIVE_PLACEMENT');
    }
    return copy_route(current);
  }

  // Serialized ActorRef tokens carry IDENTITY, never authentication. The
  // opaque trusted context still binds the caller to the decoded tenant.
  resolve_or_activate_ref(context, actor_ref, options = {}) {
    let id;
    try { id = parse_actor_ref_token(actor_ref); }
    catch { deny('INVALID_ACTOR_REF'); }
    return this.resolve_or_activate_actor(context, id, options);
  }

  route_actor(context, id) {
    const { key } = this.#trusted_identity(context, id);
    const rec = this.#active.get(key);
    if (!rec) deny('ACTOR_NOT_ACTIVE');
    const node = this.#nodes.get(rec.node_id);
    if (!node || node.status === 'DOWN') deny('NODE_DOWN');
    return copy_route(rec);
  }

  #matches_route(rec, actor_ref, route) {
    return !!rec && !!route && typeof route === 'object' &&
      route.actor_ref === actor_ref && route.tenant_id === rec.tenant_id &&
      route.node_id === rec.node_id && route.isolate_id === rec.isolate_id &&
      route.backend === rec.backend && route.epoch === rec.epoch &&
      this.#nodes.get(rec.node_id)?.status !== 'DOWN';
  }

  // DIRECTORY-ONLY CHECK. Does not authenticate a network packet, reserve mailbox
  // credits, or validate the authoritative storage epoch at an effect sink.
  validate_delivery(context, id, route) {
    const { key, actor_ref } = this.#trusted_identity(context, id);
    if (!this.#matches_route(this.#active.get(key), actor_ref, route))
      deny('STALE_OR_FORGED_ROUTE');
    return true;
  }

  // TRUSTED HOST ONLY: directory invalidation is NOT proof of remote revocation or
  // fence at the side-effect provider. A real failover must obtain provider fencing.
  fail_node(node_id) {
    const node = this.#nodes.get(node_id);
    if (!node) deny('UNKNOWN_NODE');
    if (node.status === 'DOWN') return;
    node.status = 'DOWN';
    for (const [key, rec] of this.#active) {
      if (rec.node_id === node_id) {
        this.#active.delete(key);
        node.by_tenant.get(rec.tenant_id).active--;
      }
    }
  }

  drain_node(node_id) {
    const node = this.#nodes.get(node_id);
    if (!node) deny('UNKNOWN_NODE');
    if (node.status === 'DOWN') deny('NODE_DOWN');
    node.status = 'DRAINING';
  }

  // A delayed/duplicated shutdown callback from an older activation must
  // never retire a newer incarnation of the same stable ActorRef.
  // expected_route is an activation identity check, NOT an authority token.
  // The real runtime must additionally drain in-flight turns/loans and obtain
  // provider-side state/effect fencing before releasing the activation.
  passivate_actor(context, id, expected_route) {
    const { key, actor_ref } = this.#trusted_identity(context, id);
    const rec = this.#active.get(key);
    if (!rec) deny('ACTOR_NOT_ACTIVE');
    if (!this.#matches_route(rec, actor_ref, expected_route))
      deny('STALE_OR_FORGED_PASSIVATION');
    this.#active.delete(key);
    this.#nodes.get(rec.node_id).by_tenant.get(rec.tenant_id).active--;
  }

  snapshot() {
    return Object.freeze({ nodes: this.#nodes.size, active_actors: this.#active.size,
      tenants_by_node: Object.freeze(Array.from(this.#nodes.values(), node => Object.freeze({
        node_id: node.node_id, status: node.status,
        isolates: Object.freeze(Array.from(node.by_tenant.values(), iso => Object.freeze({
          tenant_id: iso.tenant_id, isolate_id: iso.isolate_id, active: iso.active
        })))
      }))) });
  }
}
