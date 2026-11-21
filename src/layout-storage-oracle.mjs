// Portable host reference for Issue #144, NOT an Oreslang compiler or guest runtime.
// One physical ArrayBuffer is authoritative; no per-row JS object backing.
const TYPES = Object.freeze({
  i32: { size: 4, alignment: 4, get: 'getInt32', set: 'setInt32' },
  u32: { size: 4, alignment: 4, get: 'getUint32', set: 'setUint32' },
  f32: { size: 4, alignment: 4, get: 'getFloat32', set: 'setFloat32' },
  f64: { size: 8, alignment: 8, get: 'getFloat64', set: 'setFloat64' }
});
function alignTo(value, alignment) {
  const result = Math.ceil(value / alignment) * alignment;
  if (!Number.isSafeInteger(result)) throw new RangeError('layout offset overflow');
  return result;
}
function checkedProduct(a, b) {
  const result = a * b;
  if (!Number.isSafeInteger(result)) throw new RangeError('layout byte-size overflow');
  return result;
}
function makeGeometry(schema, layout, capacity, width, groups) {
  const fields = new Map(schema.map(f => [f.name, f]));
  const entries = new Map();
  let bytes = 0;
  if (layout === 'aos') {
    let stride = 0, alignment = 1;
    for (const field of schema) {
      const type = TYPES[field.type];
      stride = alignTo(stride, type.alignment);
      entries.set(field.name, { offset: stride });
      stride += type.size;
      alignment = Math.max(alignment, type.alignment);
    }
    stride = alignTo(stride, alignment);
    bytes = checkedProduct(stride, capacity);
    return { bytes, position: (row, field) => row * stride + entries.get(field).offset };
  }
  if (layout === 'soa') {
    for (const field of schema) {
      const type = TYPES[field.type];
      bytes = alignTo(bytes, type.alignment);
      entries.set(field.name, { offset: bytes, stride: type.size });
      bytes += checkedProduct(type.size, capacity);
    }
    return { bytes, position: (row, field) => {
      const e = entries.get(field);
      return e.offset + row * e.stride;
    }};
  }
  if (layout === 'aosoa') {
    if (!Number.isSafeInteger(width) || width < 1 || width > 1024 || (width & (width - 1)) !== 0)
      throw new RangeError('AoSoA width must be a power of two in [1,1024]');
    let stride = 0, alignment = 1;
    for (const field of schema) {
      const type = TYPES[field.type];
      stride = alignTo(stride, type.alignment);
      entries.set(field.name, { offset: stride, size: type.size });
      stride += checkedProduct(type.size, width);
      alignment = Math.max(alignment, type.alignment);
    }
    stride = alignTo(stride, alignment);
    bytes = checkedProduct(stride, Math.ceil(capacity / width));
    return { bytes, position: (row, field) => {
      const e = entries.get(field);
      return Math.floor(row / width) * stride + e.offset + (row % width) * e.size;
    }};
  }
  if (layout === 'soaos') {
    if (!Array.isArray(groups) || groups.length === 0) throw new TypeError('SoAoS requires field groups');
    const assigned = new Set();
    for (const group of groups) {
      if (!Array.isArray(group) || group.length === 0) throw new TypeError('empty SoAoS group');
      let stride = 0, alignment = 1;
      const members = [];
      for (const name of group) {
        if (!fields.has(name) || assigned.has(name)) throw new TypeError('SoAoS groups must partition fields');
        assigned.add(name);
        const type = TYPES[fields.get(name).type];
        stride = alignTo(stride, type.alignment);
        members.push({ name, offset: stride });
        stride += type.size;
        alignment = Math.max(alignment, type.alignment);
      }
      stride = alignTo(stride, alignment);
      bytes = alignTo(bytes, alignment);
      for (const member of members) entries.set(member.name, {
        base: bytes, stride, offset: member.offset
      });
      bytes += checkedProduct(stride, capacity);
    }
    if (assigned.size !== schema.length) throw new TypeError('SoAoS groups omitted fields');
    return { bytes, position: (row, field) => {
      const e = entries.get(field);
      return e.base + row * e.stride + e.offset;
    }};
  }
  throw new TypeError('unsupported physical layout');
}
function checkValue(value, type) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('finite numeric field required');
  if (type === 'f32' && !Number.isFinite(Math.fround(value))) throw new RangeError('f32 overflow');
  if (type === 'i32' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647))
    throw new RangeError('i32 out of bounds');
  if (type === 'u32' && (!Number.isInteger(value) || value < 0 || value > 4294967295))
    throw new RangeError('u32 out of bounds');
}
export class LayoutStore {
  #schema; #types; #geometry; #data; #view; #domain = Symbol('layout-domain');
  #issued = new WeakSet(); #slots = []; #rowSlots = []; #free = [];
  #loans = new Map(); #closed = false; #maxBytes; #width; #groups; #layout; #capacity;
  #evaluatingInput = false;
  constructor(schema, { layout = 'soa', capacity = 0, width = 8, groups = undefined,
                        maxBytes = 64 * 1024 * 1024 } = {}) {
    if (!Array.isArray(schema) || schema.length === 0) throw new TypeError('nonempty schema required');
    // Snapshot caller-owned accessors once; validate exactly the schema we store.
    const preparedSchema = Array.from(schema, f => {
      if (!f || typeof f !== 'object') throw new TypeError('invalid field schema');
      const name = f.name, type = f.type;
      return Object.freeze({ name, type });
    });
    if (preparedSchema.length === 0) throw new TypeError('nonempty schema required');
    const names = new Set();
    for (const f of preparedSchema) {
      if (!f || typeof f.name !== 'string' || !/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(f.name) ||
          names.has(f.name) || !Object.hasOwn(TYPES, f.type)) throw new TypeError('invalid field schema');
      names.add(f.name);
    }
    if (!Number.isSafeInteger(capacity) || capacity < 0 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('invalid capacity or quota');
    this.#schema = preparedSchema;
    this.#types = new Map(this.#schema.map(f => [f.name, TYPES[f.type]]));
    this.#maxBytes = maxBytes; this.#width = width;
    this.#groups = groups?.map(group => [...group]);
    this.#layout = layout;
    this.#geometry = makeGeometry(this.#schema, layout, capacity, width, this.#groups);
    this.#checkQuota(this.#geometry.bytes);
    this.#data = new ArrayBuffer(this.#geometry.bytes);
    this.#view = new DataView(this.#data);
    this.#capacity = capacity;
    Object.preventExtensions(this); // forbid own-property shadowing of layout/capacity getters
  }
  get layout() { return this.#layout; }
  get capacity() { return this.#capacity; }
  get length() { return this.#rowSlots.length; }
  get byteLength() { return this.#data.byteLength; }
  #requireOpen() {
    if (this.#evaluatingInput) throw new Error('reentrant store access during input validation');
    if (this.#closed) throw new Error('retired layout store');
  }
  // User getters, proxies and iterators are untrusted. They may not re-enter any
  // public store operation while we prepare an append, conversion, or borrow.
  #evaluateInput(fn) {
    if (this.#evaluatingInput) throw new Error('reentrant store input');
    this.#evaluatingInput = true;
    try { return fn(); }
    finally { this.#evaluatingInput = false; }
  }
  #checkQuota(bytes) {
    if (bytes > this.#maxBytes || bytes > 0x7fffffff) throw new RangeError('layout memory quota exceeded');
  }
  #requireNoLoans() { if (this.#loans.size !== 0) throw new Error('outstanding field loans'); }
  #field(name) {
    const type = this.#types.get(name);
    if (!type) throw new TypeError('unknown field');
    return type;
  }
  #checkConflict(name, write) {
    const loan = this.#loans.get(name);
    if (loan && (write || loan.writers)) throw new Error('conflicting field loan');
  }
  #validHandle(handle) {
    this.#requireOpen();
    if (!handle || typeof handle !== 'object' || !this.#issued.has(handle) ||
        handle.domain !== this.#domain) throw new Error('foreign or forged row handle');
    const entry = this.#slots[handle.slot];
    if (!entry || !entry.live || entry.generation !== handle.generation)
      throw new Error('stale row handle');
    return entry.index;
  }
  #readIndex(index, name) {
    const type = this.#field(name);
    return this.#view[type.get](this.#geometry.position(index, name), true);
  }
  #writeIndex(index, name, value) {
    const type = this.#field(name);
    const declared = this.#schema.find(f => f.name === name).type;
    checkValue(value, declared);
    this.#view[type.set](this.#geometry.position(index, name), value, true);
  }
  #checkRow(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('row must be a record');
    // Include non-enumerable and Symbol keys: Object.keys silently discards
    // hidden payload fields and wrongly admits a non-exact row schema.
    const keys = Reflect.ownKeys(row);
    if (keys.length !== this.#schema.length ||
        keys.some(key => typeof key !== 'string' || !this.#types.has(key)))
      throw new TypeError('row field set differs from schema');
    const snapshot = Object.create(null);
    for (const f of this.#schema) {
      if (!Object.hasOwn(row, f.name)) throw new TypeError('missing row field');
      const value = row[f.name]; // read an accessor/proxy only once, before changing store
      checkValue(value, f.type);
      snapshot[f.name] = value;
    }
    return snapshot;
  }
  #handle(slot) {
    const handle = Object.freeze({ domain: this.#domain, slot, generation: this.#slots[slot].generation });
    this.#issued.add(handle);
    return handle;
  }
  reserve(capacity) {
    this.#requireOpen(); this.#requireNoLoans();
    if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError('invalid capacity');
    if (capacity <= this.capacity) return;
    const next = makeGeometry(this.#schema, this.layout, capacity, this.#width, this.#groups);
    // A conversion/growth briefly owns both allocations: include both in peak quota.
    this.#checkQuota(next.bytes + this.#data.byteLength);
    const memory = new ArrayBuffer(next.bytes), view = new DataView(memory);
    for (let row = 0; row < this.length; row++) {
      for (const f of this.#schema) {
        const type = TYPES[f.type];
        view[type.set](next.position(row, f.name), this.#readIndex(row, f.name), true);
      }
    }
    new Uint8Array(this.#data).fill(0); // revoke and scrub old backing before publishing new
    this.#data = memory; this.#view = view; this.#geometry = next; this.#capacity = capacity;
  }
  push(row) {
    this.#requireOpen(); this.#requireNoLoans();
    const prepared = this.#evaluateInput(() => this.#checkRow(row));
    if (this.length === this.capacity) this.reserve(Math.max(1, this.capacity * 2));
    const index = this.length, slot = this.#free.pop() ?? this.#slots.length;
    if (slot === this.#slots.length) this.#slots.push({ index, generation: 1, live: true });
    else { this.#slots[slot].index = index; this.#slots[slot].live = true; }
    for (const f of this.#schema) this.#writeIndex(index, f.name, prepared[f.name]);
    this.#rowSlots.push(slot);
    return this.#handle(slot);
  }
  get(handle) {
    const index = this.#validHandle(handle), result = {};
    for (const f of this.#schema) {
      this.#checkConflict(f.name, false);
      Object.defineProperty(result, f.name, {
        value: this.#readIndex(index, f.name), enumerable: true,
        configurable: true, writable: true
      });
    }
    return result;
  }
  read(handle, field) {
    const index = this.#validHandle(handle); this.#checkConflict(field, false);
    return this.#readIndex(index, field);
  }
  write(handle, field, value) {
    const index = this.#validHandle(handle); this.#checkConflict(field, true);
    this.#writeIndex(index, field, value);
  }
  physicalOffset(handle, field) {
    const index = this.#validHandle(handle); this.#field(field);
    return this.#geometry.position(index, field);
  }
  borrow(field, options = {}) {
    this.#requireOpen(); this.#field(field);
    const mutable = this.#evaluateInput(() => {
      if (!options || typeof options !== 'object') throw new TypeError('borrow options must be an object');
      return options.mutable ?? false;
    });
    if (typeof mutable !== 'boolean') throw new TypeError('mutable loan flag must be boolean');
    const prev = this.#loans.get(field) ?? { readers: 0, writers: 0 };
    if (prev.writers || (mutable && prev.readers)) throw new Error('conflicting field loan');
    mutable ? prev.writers++ : prev.readers++;
    this.#loans.set(field, prev);
    let active = true;
    const verify = handle => {
      if (!active) throw new Error('released field loan');
      return this.#validHandle(handle);
    };
    return Object.freeze({
      read: handle => this.#readIndex(verify(handle), field),
      write: (handle, value) => {
        if (!mutable) throw new Error('immutable field loan');
        this.#writeIndex(verify(handle), field, value);
      },
      release: () => {
        if (!active) throw new Error('field loan already released');
        active = false;
        mutable ? prev.writers-- : prev.readers--;
        if (!prev.writers && !prev.readers) this.#loans.delete(field);
      }
    });
  }
  eraseSwap(handle) {
    const index = this.#validHandle(handle); this.#requireNoLoans();
    const last = this.length - 1, removedSlot = handle.slot;
    if (index !== last) {
      for (const f of this.#schema) this.#writeIndex(index, f.name, this.#readIndex(last, f.name));
      const moved = this.#rowSlots[last];
      this.#rowSlots[index] = moved; this.#slots[moved].index = index;
    }
    for (const f of this.#schema) this.#writeIndex(last, f.name, 0);
    this.#rowSlots.pop();
    const entry = this.#slots[removedSlot];
    entry.live = false;
    if (entry.generation === Number.MAX_SAFE_INTEGER) entry.generation = 0;
    else { entry.generation++; this.#free.push(removedSlot); }
  }
  convert(layout, options = {}) {
    this.#requireOpen(); this.#requireNoLoans();
    const prepared = this.#evaluateInput(() => {
      if (!options || typeof options !== 'object') throw new TypeError('layout options must be an object');
      const width = options.width ?? this.#width;
      const inputGroups = options.groups ?? this.#groups;
      const groups = inputGroups?.map(group => [...group]);
      const next = makeGeometry(this.#schema, layout, this.capacity, width, groups);
      return { width, groups, next };
    });
    const { width, groups, next } = prepared;
    this.#checkQuota(next.bytes + this.#data.byteLength);
    const memory = new ArrayBuffer(next.bytes), view = new DataView(memory);
    for (let row = 0; row < this.length; row++) {
      for (const f of this.#schema) {
        const type = TYPES[f.type];
        view[type.set](next.position(row, f.name), this.#readIndex(row, f.name), true);
      }
    }
    new Uint8Array(this.#data).fill(0);
    this.#data = memory; this.#view = view; this.#geometry = next;
    this.#layout = layout; this.#width = width;
    this.#groups = groups;
  }
  dispose() {
    if (this.#evaluatingInput) throw new Error('reentrant store disposal during input validation');
    if (this.#closed) return;
    this.#requireNoLoans();
    new Uint8Array(this.#data).fill(0);
    this.#closed = true;
  }
}
