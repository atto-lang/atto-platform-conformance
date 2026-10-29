/**
 * Host-only, single-threaded REFERENCE MODEL, not a guest API or OS sandbox.
 * In a native runtime every transition must be serialized by the trusted broker.
 */
import { evaluatePermission, validatePolicy } from './permission-manifest.mjs';

const LAYERS = Object.freeze(['host', 'artifact', 'runtime', 'actor', 'delegated']);
const OP_PERMISSIONS = Object.freeze(['net', 'read', 'write']);

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

  constructor({ layers, scopeMatches, maxInFlight }) {
    if (typeof scopeMatches !== 'function')
      throw new TypeError('trusted scope matcher required');
    this.#layers = frozenLayers(layers);
    this.#matches = scopeMatches;
    this.#maxInFlight = boundedPositive(maxInFlight, 'maxInFlight');
  }

  // Only the trusted runtime may call these host-side methods. Neither object
  // references nor actor labels are proof of identity without isolate mediation.
  registerActor(parent = null) {
    if (parent !== null && !this.#liveActor(parent))
      throw new Error('parent actor authority unavailable');
    const handle = Object.freeze(Object.create(null));
    const state = { live: true, children: new Set(), tickets: new Set() };
    this.#actors.set(handle, state);
    if (parent !== null) this.#actors.get(parent).children.add(handle);
    return handle;
  }

  bindTarget({ permission, resource, transport, destination }) {
    if (!OP_PERMISSIONS.includes(permission) || typeof resource !== 'string' ||
        !resource || typeof transport !== 'string' || !transport ||
        typeof destination !== 'string' || !destination) {
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
    if (!this.#liveActor(actor)) return { status: 'DENIED_ACTOR' };
    const binding = this.#targets.get(target);
    if (!binding) return { status: 'DENIED_TARGET' };
    if (!evaluatePermission(this.#layers, binding.permission,
                            binding.resource, this.#matches)) {
      return { status: 'DENIED_PERMISSION' };
    }
    // The trusted matcher can reenter host-side code. If it revoked this
    // actor, no admission may be published after the authority disappeared.
    if (!this.#liveActor(actor)) return { status: 'DENIED_ACTOR' };
    if (this.#used >= this.#maxInFlight) return { status: 'BACKPRESSURE' };
    const ticket = Object.freeze(Object.create(null));
    this.#tickets.set(ticket, {
      actor, target, state: 'ACTIVE', result: null, retired: false,
    });
    this.#actors.get(actor).tickets.add(ticket);
    this.#used++;
    return { status: 'ADMITTED', ticket };
  }

  // Host dispatch validates its *actual* target against the pinned binding.
  // A redirect, DNS re-resolution or descriptor substitution requires new
  // authorization; matching a hostname alone is never sufficient.
  dispatch(actor, ticket, actualTarget) {
    const record = this.#tickets.get(ticket);
    if (!record || record.actor !== actor || record.retired ||
        record.state !== 'ACTIVE' || !this.#liveActor(actor)) return false;
    const pinned = this.#targets.get(record.target);
    const actual = this.#targets.get(actualTarget);
    return pinned !== undefined && pinned === actual && record.target === actualTarget;
  }

  cancel(actor, ticket) {
    const record = this.#tickets.get(ticket);
    if (!record || record.actor !== actor || record.retired || record.state !== 'ACTIVE')
      return false;
    record.state = 'CANCEL_REQUESTED';
    return true;
  }

  complete(actor, ticket, result = 'OK') {
    const record = this.#tickets.get(ticket);
    if (!record || record.actor !== actor || record.retired ||
        (record.state !== 'ACTIVE' && record.state !== 'CANCEL_REQUESTED')) return false;
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

  snapshot() {
    return Object.freeze({ inFlight: this.#used, maxInFlight: this.#maxInFlight });
  }
}
