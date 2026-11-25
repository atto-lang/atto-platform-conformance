// AttoLang DOP layout topology v1: bounded, independent JS host byte-layout model.
// NOT a guest compiler, native ABI, sanitizer result, benchmark, or ownership proof.
const MAX_CAPACITY = 65536;
const MAX_BYTES = 16 * 1024 * 1024;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const KINDS = new Set(['aos', 'soa', 'aosoa', 'soaos']);

function fail(message) { throw new TypeError(message); }
function ownData(object, key, context) {
  if (object === null || typeof object !== 'object' || Array.isArray(object))
    fail(context + ': expected plain descriptor');
  const desc = Object.getOwnPropertyDescriptor(object, key);
  if (!desc || !Object.hasOwn(desc, 'value')) fail(context + ': ' + key + ' must be own data');
  return desc.value;
}
function checkedI64(value) {
  if (typeof value !== 'bigint' || value < MIN_I64 || value > MAX_I64)
    throw new RangeError('expected signed i64 BigInt');
  return value;
}
function checkedIndex(index, length) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= length)
    throw new RangeError('dense row index out of bounds');
  return index;
}
function validatedSchema(schema) {
  if (!Array.isArray(schema) || schema.length < 1 || schema.length > 16)
    fail('schema must contain 1..16 fields');
  const seen = new Set();
  return Object.freeze(schema.map((field) => {
    const name = ownData(field, 'name', 'field');
    const type = ownData(field, 'type', 'field');
    // Explicit bool rather than host truthiness: the compiler must retain
    // per-field 'let' authority instead of guessing it during lowering.
    const mutable = ownData(field, 'mutable', 'field');
    if (typeof mutable !== 'boolean') fail('field mutable must be explicit boolean');
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name) || FORBIDDEN.has(name))
      fail('invalid field name');
    if (seen.has(name)) fail('duplicate field name');
    seen.add(name);
    if (type !== 'i64') fail('v1 host model supports i64 only');
    return Object.freeze({name, type, mutable, width: 8});
  }));
}
function validatedGroups(groups, fields) {
  if (!Array.isArray(groups) || groups.length === 0) fail('SoAoS requires explicit field groups');
  const fieldNames = new Set(fields.map(x => x.name));
  const seen = new Set();
  const result = groups.map((group) => {
    if (!Array.isArray(group) || group.length === 0) fail('empty SoAoS group');
    const own = new Set();
    const names = group.map(name => {
      if (typeof name !== 'string' || !fieldNames.has(name)) fail('unknown SoAoS field');
      if (seen.has(name) || own.has(name)) fail('duplicate SoAoS field');
      seen.add(name); own.add(name);
      return name;
    });
    return Object.freeze(names);
  });
  if (seen.size !== fields.length) fail('SoAoS grouping must cover all fields');
  return Object.freeze(result);
}

// The plan describes real byte offsets in a JS ArrayBuffer, not a cross-backend ABI.
// Only layout topology is compared; the plan must NEVER silently convert Array<T>
// or substitute for the v1 inverted-type invariant of one immediate-field column.
export function createDopLayoutPlan({kind, schema, capacity, tileWidth, groups} = {}) {
  if (!KINDS.has(kind)) fail('unknown layout kind');
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_CAPACITY)
    fail('capacity out of bounds');
  const fields = validatedSchema(schema);
  const fieldNames = fields.map(x => x.name);
  if (kind === 'aosoa') {
    if (!Number.isSafeInteger(tileWidth) || tileWidth < 2 || tileWidth > 64 ||
        (tileWidth & (tileWidth - 1)) !== 0) fail('AoSoA requires power-of-two tileWidth 2..64');
  } else if (tileWidth !== undefined) fail('tileWidth only applies to AoSoA');
  if (kind === 'soaos') groups = validatedGroups(groups, fields);
  else if (groups !== undefined) fail('groups only apply to SoAoS');

  const fieldIndex = new Map(fieldNames.map((name, i) => [name, i]));
  const rowBytes = fields.length * 8;
  const tiles = kind === 'aosoa' ? Math.ceil(capacity / tileWidth) : 0;
  const bytes = kind === 'aosoa' ? tiles * tileWidth * rowBytes : capacity * rowBytes;
  if (!Number.isSafeInteger(bytes) || bytes > MAX_BYTES) fail('allocation byte budget exceeded');
  const groupAddress = new Map();
  if (kind === 'soaos') {
    let base = 0;
    for (const group of groups) {
      for (let i = 0; i < group.length; i++)
        groupAddress.set(group[i], Object.freeze({base, stride: group.length * 8, index: i}));
      base += group.length * capacity * 8;
    }
    if (base !== bytes) fail('internal SoAoS byte accounting mismatch');
  }
  function offset(row, field) {
    checkedIndex(row, capacity);
    if (!fieldIndex.has(field)) fail('unknown field');
    const col = fieldIndex.get(field);
    if (kind === 'aos') return row * rowBytes + col * 8;
    if (kind === 'soa') return col * capacity * 8 + row * 8;
    if (kind === 'aosoa') return Math.floor(row / tileWidth) * tileWidth * rowBytes +
      col * tileWidth * 8 + (row % tileWidth) * 8;
    const loc = groupAddress.get(field);
    return loc.base + row * loc.stride + loc.index * 8;
  }
  // An AoSoA tile uses full physical tileWidth, even for the last partial tile.
  return Object.freeze({kind, schema: fields, capacity, byteLength: bytes,
    tileWidth: kind === 'aosoa' ? tileWidth : null,
    groups: kind === 'soaos' ? groups : null, offset});
}

export function createDopLayoutStore(options) {
  const plan = createDopLayoutPlan(options);
  const view = new DataView(new ArrayBuffer(plan.byteLength));
  let length = 0;
  const names = plan.schema.map(f => f.name);
  const mutableNames = new Set(plan.schema.filter(f => f.mutable).map(f => f.name));
  function checkedRow(index) { return checkedIndex(index, length); }
  function validatedRow(value) {
    const result = Object.create(null);
    for (const name of names) result[name] = checkedI64(ownData(value, name, 'row'));
    if (Reflect.ownKeys(value).length !== names.length) fail('row has unexpected fields');
    return result;
  }
  function get(field, row) { return view.getBigInt64(plan.offset(checkedRow(row), field), true); }
  function set(field, row, value) {
    const at = plan.offset(checkedRow(row), field);
    if (!mutableNames.has(field))
      throw new TypeError('immutable field cannot be written after insertion');
    view.setBigInt64(at, checkedI64(value), true);
  }
  function snapshot(row) {
    checkedRow(row);
    const copy = Object.create(null);
    for (const name of names) copy[name] = get(name, row);
    return Object.freeze(copy);
  }
  function push(value) {
    if (length >= plan.capacity) throw new RangeError('collection at capacity');
    const input = validatedRow(value); // Validate all columns before any write.
    for (const name of names) view.setBigInt64(plan.offset(length, name), input[name], true);
    return length++;
  }
  function eraseSwap(row) {
    checkedRow(row);
    const last = length - 1;
    if (row !== last) {
      const from = snapshot(last);
      for (const name of names) view.setBigInt64(plan.offset(row, name), from[name], true);
    }
    for (const name of names) view.setBigInt64(plan.offset(last, name), 0n, true);
    length--;
  }
  function addI64(field, row, delta) {
    checkedI64(delta);
    const next = get(field, row) + delta;
    set(field, row, checkedI64(next)); // Fail atomically on signed overflow.
    return next;
  }
  function bytesSnapshot() { return new Uint8Array(view.buffer).slice(); }
  return Object.freeze({plan, get length() { return length; }, get, set, snapshot,
    push, eraseSwap, addI64, bytesSnapshot});
}
