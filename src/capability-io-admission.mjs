/**
 * Host-only, single-threaded REFERENCE MODEL, not a guest API or OS sandbox.
 * In a native runtime every transition must be serialized by the trusted broker.
 */
import { evaluatePermission, validatePolicy } from './permission-manifest.mjs';

const LAYERS = Object.freeze(['host', 'artifact', 'runtime', 'actor', 'delegated']);
const OP_PERMISSIONS = Object.freeze(['net', 'read', 'write']);
const NET_TRANSPORTS = Object.freeze(['tcp', 'udp', 'http', 'https', 'tls', 'ws', 'wss']);

function frozenLayers(layers) {
  if (!layers || typeof layers !== 'object' || Array.isArray(layers) ||
      Object.keys(layers).sort().join(',') !== [...LAYERS].sort().join(',')) {
    throw new TypeError('exactly five trusted authority layers required');
  }
  const copy = {};
  for (const name of LAYERS) {
    const policy = validatePolicy(layers[name]);
    for (const entry of Object.values(policy)) {
      Object.freeze(entry.allow);
      Object.freeze(entry.deny);
      Object.freeze(entry);
    }
    copy[name] = Object.freeze(policy);
  }
  return Object.freeze(copy);
}

function boundedPositive(n, label) {
  if (!Number.isSafeInteger(n) || n < 1 || n > 65536)
    throw new TypeError(label + ' must be a positive bounded integer');
  return n;
}

export class ReferenceCapabilityIoBroker {
  #layers;
  #matches;
  #maxInFlight;
  #used = 0;
  #actors = new WeakMap();
  #targets = new WeakMap();
  #tickets = new WeakMap();
  #activeTickets = new Set(); // bounded by maxInFlight, permits shutdown drain
  #closed = false;

  constructor({ layers, scopeMatches, maxInFlight }) {
    if (typeof scopeMatches !== 'function')
      throw new TypeError('trusted scope matcher required');
    this.#layers = frozenLayers(layers);
    this.#matches = scopeMatches;
    this.#maxInFlight = boundedPositive(maxInFlight, 'maxInFlight');
  }

  // Only the trusted runtime may call these host-side methods. Neither object
  // references nor actor labels are proof of identity without isolate mediation.
  registerActor(parent = null, policy = null, limits = null) {
    if (this.#closed) throw new Error('host I/O broker is shut down');
    if (parent !== null && !this.#liveActor(parent))
      throw new Error('parent actor authority unavailable');
    // A child cannot widen the budget of its parent. This is an aggregate
    // subtree ceiling (including descendants), not a per-child allowance.
    if (limits !== null && (typeof limits !== 'object' || Array.isArray(limits) ||
        Object.keys(limits).sort().join(',') !== 'maxSubtreeInFlight'))
      throw new TypeError('exact maxSubtreeInFlight limit required');
    const parentCeiling = parent === null
      ? this.#maxInFlight : this.#actors.get(parent).maxSubtreeInFlight;
    const maxSubtreeInFlight = limits === null ? parentCeiling
      : boundedPositive(limits.maxSubtreeInFlight, 'maxSubtreeInFlight');
    if (maxSubtreeInFlight > parentCeiling)
      throw new TypeError('child actor cannot widen ancestor subtree I/O quota');
    const handle = Object.freeze(Object.create(null));
    const state = { live: true, parent, children: new Set(), tickets: new Set(),
      maxSubtreeInFlight, subtreeInFlight: 0, policy: this.#layers.actor };
    if (policy !== null) {
      const validated = validatePolicy(policy);
      for (const rule of Object.values(validated)) {
        Object.freeze(rule.allow);
        Object.freeze(rule.deny);
        Object.freeze(rule);
      }
      state.policy = Object.freeze(validated);
    }
    this.#actors.set(handle, state);
    if (parent !== null) this.#actors.get(parent).children.add(handle);
    return handle;
  }

  bindTarget({ permission, resource, transport, destination }) {
    if (this.#closed) throw new Error('host I/O broker is shut down');
    if (!OP_PERMISSIONS.includes(permission) || typeof resource !== 'string' ||
        !resource || typeof transport !== 'string' || !transport ||
        typeof destination !== 'string' || !destination ||
        (permission === 'net' ? !NET_TRANSPORTS.includes(transport) : transport !== 'file')) {
      throw new TypeError('trusted bound target requires a complete normalized identity');
    }
    // The caller is the trusted transport adapter. The host must validate and
    // pin this identity to the actual descriptor/connection before dispatch.
    const handle = Object.freeze(Object.create(null));
    this.#targets.set(handle, Object.freeze({ permission, resource, transport, destination }));
    return handle;
  }

  #liveActor(actor) {
    return this.#actors.get(actor)?.live === true;
  }

  admit(actor, target) {
    if (this.#closed) return { status: 'DENIED_SHUTDOWN' };
    if (!this.#liveActor(actor)) return { status: 'DENIED_ACTOR' };
    const binding = this.#targets.get(target);
    if (!binding) return { status: 'DENIED_TARGET' };
    if (!evaluatePermission(this.#layers, binding.permission,
                            binding.resource, this.#matches)) {
      return { status: 'DENIED_PERMISSION' };
    }
    // The trusted matcher can reenter host-side code. If it revoked this
    // actor, no admission may be published after the authority disappeared.
    // A hostname grant must not launder a different actual network endpoint.
    // The target is supplied only by the trusted transport adapter, which
    // must still pin its resource and destination to the OS connection.
    if (binding.destination !== binding.resource &&
        !evaluatePermission(this.#layers, binding.permission, binding.destination, this.#matches)) {
      return { status: 'DENIED_PERMISSION' };
    }
    // Every ancestor further restricts a child's effective authority. Merely
    // registering a more permissive child policy cannot mint capabilities.
    const ancestors = [];
    for (let current = actor; current !== null; ) {
      const currentState = this.#actors.get(current);
      if (!currentState?.live) return { status: 'DENIED_ACTOR' };
      ancestors.push(currentState);
      const constrained = {...this.#layers, actor: currentState.policy};
      if (!evaluatePermission(constrained, binding.permission,
                              binding.resource, this.#matches) ||
          (binding.destination !== binding.resource &&
           !evaluatePermission(constrained, binding.permission, binding.destination, this.#matches))) {
        return { status: 'DENIED_PERMISSION' };
      }
      current = currentState.parent;
    }
    // A reentrant matcher can revoke the actor during any of the checks.
    if (this.#closed) return { status: 'DENIED_SHUTDOWN' };
    if (!this.#liveActor(actor)) return { status: 'DENIED_ACTOR' };
    if (this.#used >= this.#maxInFlight) return { status: 'BACKPRESSURE' };
    // Check every ancestor immediately before publication. Admission and
    // retirement are serialized by the trusted broker; no quota is refunded
    // on cancellation, logical completion, or revocation.
    if (ancestors.some(state => state.subtreeInFlight >= state.maxSubtreeInFlight))
      return { status: 'BACKPRESSURE_SUBTREE' };
    const ticket = Object.freeze(Object.create(null));
    this.#tickets.set(ticket, {
      actor, target, ancestors, state: 'ACTIVE', result: null, retired: false,
    });
    this.#actors.get(actor).tickets.add(ticket);
    this.#activeTickets.add(ticket);
    for (const state of ancestors) state.subtreeInFlight++;
    this.#used++;
    return { status: 'ADMITTED', ticket };
  }

  // Host dispatch validates its *actual* target against the pinned binding.
  // A redirect, DNS re-resolution or descriptor substitution requires new
  // authorization; matching a hostname alone is never sufficient.
  dispatch(actor, ticket, actualTarget) {
    const record = this.#tickets.get(ticket);
    if (!record || record.actor !== actor || record.retired ||
        record.state !== 'ACTIVE' || !this.#liveActor(actor) || this.#closed) return false;
    const pinned = this.#targets.get(record.target);
    const actual = this.#targets.get(actualTarget);
    if (pinned === undefined || pinned !== actual || record.target !== actualTarget)
      return false;
    // One admission ticket authorizes at most one host operation start.
    record.state = 'DISPATCHED';
    return true;
  }

  cancel(actor, ticket) {
    const record = this.#tickets.get(ticket);
    if (!record || record.actor !== actor || record.retired || !['ACTIVE', 'DISPATCHED'].includes(record.state))
      return false;
    record.state = 'CANCEL_REQUESTED';
    return true;
  }

  complete(actor, ticket, result = 'OK') {
    const record = this.#tickets.get(ticket);
    if (!record || record.actor !== actor || record.retired ||
        !['ACTIVE', 'DISPATCHED', 'CANCEL_REQUESTED'].includes(record.state)) return false;
    // Cancellation/revocation wins over a racing completion. No guest callback
    // is executed here: this only records trusted host state.
    record.result = record.state === 'CANCEL_REQUESTED' || !this.#liveActor(actor)
      ? 'CANCELLED' : result;
    record.state = 'SETTLED';
    return true;
  }

  // Caller must have observed host transport/descriptor quiescence. Future
  // settlement or a cancellation request alone is NOT physical retirement.
  retire(actor, ticket, hostQuiesced) {
    const record = this.#tickets.get(ticket);
    if (!record || record.actor !== actor || record.retired || hostQuiesced !== true)
      return false;
    if (record.state !== 'SETTLED' && record.state !== 'CANCEL_REQUESTED')
      return false;
    if (record.state === 'CANCEL_REQUESTED') {
      record.state = 'SETTLED';
      record.result = 'CANCELLED';
    }
    record.retired = true;
    this.#actors.get(actor).tickets.delete(ticket);
    this.#activeTickets.delete(ticket);
    // Charge the same ancestor identities that admitted this operation.
    // Actor revocation never makes the pending physical loan disappear.
    for (const ancestor of record.ancestors) {
      ancestor.subtreeInFlight--;
      if (ancestor.subtreeInFlight < 0) throw new Error('subtree budget underflow');
    }
    this.#used--;
    return true;
  }

  revoke(actor) {
    const state = this.#actors.get(actor);
    if (!state || !state.live) return false;
    state.live = false;
    for (const ticket of state.tickets) this.cancel(actor, ticket);
    for (const child of state.children) this.revoke(child);
    return true;
  }

  shutdown() {
    if (this.#closed) return false;
    this.#closed = true;
    for (const ticket of this.#activeTickets) {
      const record = this.#tickets.get(ticket);
      if (record) this.cancel(record.actor, ticket);
    }
    return true;
  }

  snapshot() {
    return Object.freeze({ inFlight: this.#used, maxInFlight: this.#maxInFlight, closed: this.#closed });
  }
}
