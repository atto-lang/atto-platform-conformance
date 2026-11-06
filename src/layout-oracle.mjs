// Source-free logical reference for AoS, SoA, AoSoA and SoAoS.
// NOT a compiler, native arena, measured memory layout or guest-execution proof.
// SoAoS means independently stored field groups containing row-wise records;
// it is not an alternate spelling for an AoS row-tile or AoSoA column-tile.
const LAYOUTS = new Set(['aos', 'soa', 'aosoa', 'soaos']);

function fail(message) { throw new TypeError(`layout oracle: ${message}`); }
function checkedFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0 ||
      fields.some(f => typeof f !== 'string' || f.length === 0 || f.includes('\0')) ||
      new Set(fields).size !== fields.length) fail('invalid distinct fields');
  return Object.freeze([...fields]);
}
function checkedGroups(fields, groups) {
  if (!Array.isArray(groups) || groups.length === 0) fail('SoAoS requires field groups');
  const seen = new Set(), accepted = [];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) fail('empty SoAoS group');
    const names = [];
    for (const name of group) {
      if (typeof name !== 'string' || !fields.includes(name) || seen.has(name))
        fail('SoAoS groups must partition fields exactly');
      seen.add(name); names.push(name);
    }
    accepted.push(Object.freeze(names));
  }
  if (seen.size !== fields.length) fail('SoAoS groups must partition fields exactly');
  return Object.freeze(accepted);
}
function validLayout(layout, fields, groups) {
  if (!LAYOUTS.has(layout)) fail('invalid layout');
  if (layout === 'soaos') return checkedGroups(fields, groups);
  if (groups !== undefined) fail('groups only permitted for SoAoS');
  return undefined;
}
function snapshotRow(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid row shape');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(k => typeof k !== 'string' || !fields.includes(k)))
    fail('invalid row shape');
  const result = [];
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('row accessors are unsupported');
    const scalar = descriptor.value;
    if (scalar !== null && !['number','bigint','boolean','string'].includes(typeof scalar))
      fail('scalar-only reference requires detached primitive fields');
    result.push(scalar);
  }
  return result;
}

export class LayoutOracle {
  #fields; #layout; #tileWidth; #groups;
  #rows = []; #generations = []; #free = []; #issued = new WeakSet();
  #evaluatingInput = false;
  constructor(fields, layout, tileWidth = 4, groups = undefined) {
    this.#fields = checkedFields(fields);
    if (!Number.isSafeInteger(tileWidth) || tileWidth < 1 || tileWidth > 1024)
      fail('invalid tile width');
    this.#groups = validLayout(layout, this.#fields, groups);
    this.#layout = layout;
    this.#tileWidth = tileWidth;
  }
  get fields() { return [...this.#fields]; }
  get layout() { return this.#layout; }
  get tileWidth() { return this.#tileWidth; }
  get groups() { return this.#groups?.map(group => [...group]); }
  #noReentry() { if (this.#evaluatingInput) throw Error('reentrant layout oracle input'); }
  insert(value) {
    this.#noReentry();
    // Snapshot completely before consuming a free-list entry or publishing a row.
    this.#evaluatingInput = true;
    let row;
    try { row = snapshotRow(value, this.#fields); }
    finally { this.#evaluatingInput = false; }
    const slot = this.#free.length ? this.#free.pop() : this.#rows.length;
    if (slot === this.#rows.length) {
      this.#rows.push(null);
      this.#generations.push(1);
    }
    this.#rows[slot] = row;
    const handle = Object.freeze({slot, generation:this.#generations[slot]});
    this.#issued.add(handle);
    return handle;
  }
  #check(handle) {
    this.#noReentry();
    if (!handle || typeof handle !== 'object' || !this.#issued.has(handle) ||
        !Number.isSafeInteger(handle.slot) || handle.slot < 0 ||
        handle.slot >= this.#rows.length || this.#rows[handle.slot] === null ||
        this.#generations[handle.slot] !== handle.generation) throw Error('stale, forged or foreign row handle');
    return handle.slot;
  }
  read(handle) {
    const row = this.#rows[this.#check(handle)];
    return Object.fromEntries(this.#fields.map((key, i) => [key, row[i]]));
  }
  write(handle, field, value) {
    const slot = this.#check(handle), index = this.#fields.indexOf(field);
    if (index < 0) fail('unknown field');
    if (value !== null && !['number','bigint','boolean','string'].includes(typeof value))
      fail('scalar-only reference requires detached primitive fields');
    this.#rows[slot][index] = value;
  }
  remove(handle) {
    const slot = this.#check(handle);
    this.#rows[slot] = null;
    // Exhausted generations permanently retire the slot rather than wrap an ABA ID.
    if (this.#generations[slot] < Number.MAX_SAFE_INTEGER) {
      this.#generations[slot] += 1;
      this.#free.push(slot);
    }
  }
  snapshot() {
    this.#noReentry();
    const live = this.#rows.filter(row => row !== null);
    const record = (row, fields) => Object.fromEntries(fields.map(k => [k,row[this.#fields.indexOf(k)]]));
    if (this.#layout === 'aos') return live.map(row => record(row,this.#fields));
    if (this.#layout === 'soa') return Object.fromEntries(this.#fields.map((k,i) => [k,live.map(row => row[i])]));
    if (this.#layout === 'soaos')
      return this.#groups.map(group => live.map(row => record(row,group)));
    const tiles = [];
    for (let start = 0; start < live.length; start += this.#tileWidth) {
      const tile = live.slice(start, start + this.#tileWidth);
      tiles.push(Object.fromEntries(this.#fields.map((key,i) => [key,tile.map(row => row[i])])));
    }
    return tiles;
  }
  convert(layout, groups = undefined) {
    this.#noReentry();
    // Invalid conversions leave both the layout and its group partition unchanged.
    const accepted = validLayout(layout, this.#fields, groups);
    this.#groups = accepted;
    this.#layout = layout;
  }
}
