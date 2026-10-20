// Reference model only: not the Java/LLVM production actor tracing implementation.
export const MIN_ACTOR_HOPS = 5;
export const DEFAULT_ACTOR_HOPS = 16;
export const MAX_ACTOR_HOPS = 64;
const BRAND = Symbol('OreslangActorHopTrace');
const LAYOUTS = new Set(['aos', 'soa', 'aosoa']);
const KINDS = new Set(['receive', 'forward', 'spawn', 'rpc-receive', 'supervisor']);
const FIELDS = ['actor', 'handler', 'kind', 'source', 'generation', 'redacted'];
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

function natural(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function safeText(value, label, maxLength = 160) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength || CONTROL.test(value)) {
    throw new TypeError(`${label} must be nonempty, bounded, safe display text`);
  }
  return value;
}

function plainObject(value, label, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      throw new TypeError(`unexpected ${label} field`);
    }
  }
}

function normalizeHop(input) {
  plainObject(input, 'actor hop', FIELDS);
  const redacted = input.redacted === true;
  if (input.redacted !== undefined && typeof input.redacted !== 'boolean') {
    throw new TypeError('redacted must be boolean');
  }
  if (!KINDS.has(input.kind)) throw new TypeError('unknown actor hop kind');
  let source = null;
  if (input.source != null && !redacted) {
    plainObject(input.source, 'source', ['unit', 'line', 'column']);
    source = Object.freeze({
      unit: safeText(input.source.unit, 'source unit'),
      line: natural(input.source.line, 'source line', 1, Number.MAX_SAFE_INTEGER),
      column: natural(input.source.column, 'source column', 1, Number.MAX_SAFE_INTEGER),
    });
  }
  return Object.freeze({
    actor: redacted ? '<redacted>' : safeText(input.actor, 'actor'),
    handler: redacted ? '<redacted>' : safeText(input.handler, 'handler'),
    kind: input.kind,
    source,
    generation: redacted || input.generation == null ? null : safeText(input.generation, 'generation', 64),
    redacted,
  });
}

function emptyStorage(layout, capacity, blockSize) {
  if (layout === 'aos') return Object.freeze(Array(capacity).fill(null));
  if (layout === 'soa') {
    const columns = {};
    for (const field of FIELDS) columns[field] = Object.freeze(Array(capacity).fill(null));
    return Object.freeze(columns);
  }
  const blocks = [];
  for (let pos = 0; pos < capacity; pos += blockSize) {
    blocks.push(Object.freeze(Array(Math.min(blockSize, capacity - pos)).fill(null)));
  }
  return Object.freeze(blocks);
}

function makeContext(layout, capacity, blockSize, totalVisits, count, next, storage) {
  return Object.freeze({[BRAND]: true, layout, capacity, blockSize, totalVisits, count, next, storage});
}

function checkedContext(ctx) {
  if (!ctx || ctx[BRAND] !== true || !Object.isFrozen(ctx)) {
    throw new TypeError('expected trusted actor trace context');
  }
  return ctx;
}

export function createActorHopTrace({capacity = DEFAULT_ACTOR_HOPS, layout = 'aos', blockSize = 4} = {}) {
  natural(capacity, 'capacity', MIN_ACTOR_HOPS, MAX_ACTOR_HOPS);
  if (!LAYOUTS.has(layout)) throw new TypeError('unknown layout');
  natural(blockSize, 'blockSize', 1, MAX_ACTOR_HOPS);
  return makeContext(layout, capacity, blockSize, 0, 0, 0, emptyStorage(layout, capacity, blockSize));
}

function storeAt(ctx, at, hop) {
  if (ctx.layout === 'aos') {
    const slots = ctx.storage.slice();
    slots[at] = hop;
    return Object.freeze(slots);
  }
  if (ctx.layout === 'soa') {
    const columns = {};
    for (const field of FIELDS) {
      const values = ctx.storage[field].slice();
      values[at] = hop[field];
      columns[field] = Object.freeze(values);
    }
    return Object.freeze(columns);
  }
  const blockIndex = Math.floor(at / ctx.blockSize);
  const blocks = ctx.storage.slice();
  const block = blocks[blockIndex].slice();
  block[at % ctx.blockSize] = hop;
  blocks[blockIndex] = Object.freeze(block);
  return Object.freeze(blocks);
}

function readAt(ctx, at) {
  if (ctx.layout === 'aos') return ctx.storage[at];
  if (ctx.layout === 'soa') {
    const obj = {};
    for (const field of FIELDS) obj[field] = ctx.storage[field][at];
    return Object.freeze(obj);
  }
  return ctx.storage[Math.floor(at / ctx.blockSize)][at % ctx.blockSize];
}

// Trusted runtime ingress only. Never populate hops directly from guest payloads.
export function appendActorHop(context, runtimeHop) {
  const ctx = checkedContext(context);
  if (ctx.totalVisits === Number.MAX_SAFE_INTEGER) throw new RangeError('actor visit counter overflow');
  const hop = normalizeHop(runtimeHop);
  return makeContext(ctx.layout, ctx.capacity, ctx.blockSize, ctx.totalVisits + 1,
    Math.min(ctx.capacity, ctx.count + 1), (ctx.next + 1) % ctx.capacity,
    storeAt(ctx, ctx.next, hop));
}

export function snapshotActorHops(context) {
  const ctx = checkedContext(context);
  const entries = [];
  for (let i = 0; i < ctx.count; i++) {
    entries.push(readAt(ctx, (ctx.next - ctx.count + i + ctx.capacity) % ctx.capacity));
  }
  return Object.freeze({
    schema: 'oreslang.actor-hops.v1', ordering: 'oldest_to_newest',
    total_visits: ctx.totalVisits, retained: ctx.count,
    omitted_prior: ctx.totalVisits - ctx.count,
    truncated: ctx.totalVisits > ctx.count,
    entries: Object.freeze(entries),
  });
}

// An explicit storage conversion, not a synchronized shadow representation.
export function convertActorHopLayout(context, layout, blockSize = 4) {
  const original = checkedContext(context);
  let converted = createActorHopTrace({capacity: original.capacity, layout, blockSize});
  for (const entry of snapshotActorHops(original).entries) converted = appendActorHop(converted, entry);
  return makeContext(converted.layout, converted.capacity, converted.blockSize,
    original.totalVisits, converted.count, converted.next, converted.storage);
}

// Optional ECS-style indexing for observability. This never owns or changes a message's trace.
export class ActorTraceComponentIndex {
  #slots = [];
  #generations = [];
  #free = [];
  #limit;

  constructor(maxSlots = 1024) {
    this.#limit = natural(maxSlots, 'maxSlots', 1, 1_000_000);
  }

  attach(context) {
    const trace = checkedContext(context);
    let slot;
    if (this.#free.length) {
      slot = this.#free.pop();
    } else {
      if (this.#slots.length >= this.#limit) throw new RangeError('trace index is full');
      slot = this.#slots.length;
      this.#slots.push(null);
      this.#generations.push(0);
    }
    this.#slots[slot] = trace;
    return Object.freeze({slot, generation: this.#generations[slot]});
  }

  resolve(handle) {
    if (!handle || !Number.isSafeInteger(handle.slot) || !Number.isSafeInteger(handle.generation)) return null;
    if (handle.slot < 0 || handle.slot >= this.#slots.length ||
        this.#generations[handle.slot] !== handle.generation) return null;
    return this.#slots[handle.slot];
  }

  release(handle) {
    if (!this.resolve(handle)) return false;
    const at = handle.slot;
    if (this.#generations[at] === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('generation exhausted; cannot safely recycle slot');
    }
    this.#slots[at] = null;
    this.#generations[at]++;
    this.#free.push(at);
    return true;
  }
}
