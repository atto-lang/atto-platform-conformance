// Backend-neutral, executable REFERENCE MODEL for one-level inverted layout.
// This is not an Oreslang compiler, native ABI, allocator or zero-copy implementation.
// All five backends must separately compile and execute equivalent guest .ores tests.
const SCALARS = new Set(["i64", "f64", "bool"]);
const KINDS = new Set(["struct", "class", "inverted-struct", "inverted-class"]);
const MAX_FIELDS = 64;
const MAX_PACKED_BYTES = 64 * 1024;
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const FORBIDDEN_NAMES = new Set(["__proto__", "prototype", "constructor"]);
// Private module-issued layout witness; not proof of an Oreslang compiler.
const COMPILED_LAYOUTS = new WeakSet();

function fail(message) { throw new TypeError("inverted layout: " + message); }
function own(value, key) { return Object.hasOwn(value, key); }
function data(value, key) {
  const d = Object.getOwnPropertyDescriptor(value, key);
  if (!d || !Object.hasOwn(d, "value")) fail("accessor field not admitted");
  return d.value;
}
function validName(n) {
  return typeof n === "string" && n.length > 0 &&
    !FORBIDDEN_NAMES.has(n) && !n.includes(String.fromCharCode(0));
}
function fieldsOf(value) {
  if (!exactObject(value)) fail("invalid field map");
  return Reflect.ownKeys(value).map(name => {
    if (!validName(name)) fail("invalid field name");
    return [name, data(value, name)];
  });
}
function declaration(value) {
  if (!exactObject(value)) fail("invalid declaration");
  for (const k of Reflect.ownKeys(value)) {
    if (k !== "kind" && k !== "fields") fail("unsupported declaration metadata");
    data(value, k);
  }
  return {kind: data(value, "kind"), fields: data(value, "fields")};
}
function exactObject(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
                             Object.getPrototypeOf(value) === null);
}

export function compile_inverted_layout(types, typeName) {
  if (!exactObject(types) || !validName(typeName) || !own(types, typeName))
    fail("unknown nominal type");
  const root = declaration(data(types, typeName));
  if (!KINDS.has(root.kind)) fail("invalid root type declaration");
  const fields = fieldsOf(root.fields);
  if (!fields.length || fields.length > MAX_FIELDS) fail("invalid field count");
  // Direct field syntax defaults to Oreslang's implicit immutable val.
  // {type, mutable:true} explicitly models a `let` member.  Immutable
  // members are initialized at push only and cannot acquire write loans.
  function directField(spec) {
    if (typeof spec === "string") return {type: spec, mutable: false};
    if (!exactObject(spec)) fail("invalid direct field binding");
    const keys = Reflect.ownKeys(spec);
    if (keys.length !== 2 || !keys.includes("type") || !keys.includes("mutable"))
      fail("invalid direct field binding");
    const type = data(spec, "type"), mutable = data(spec, "mutable");
    if (typeof type !== "string" || typeof mutable !== "boolean")
      fail("invalid direct field binding");
    return {type, mutable};
  }
  const cache = new Map();
  function descriptor(type, path = []) {
    if (SCALARS.has(type)) return Object.freeze({
      type, kind: "scalar", width: type === "bool" ? 1 : 8
    });
    if (typeof type !== "string" || !validName(type) || !own(types, type)) fail("unknown field type");
    if (path.includes(type) || path.length >= 16) fail("recursive or overdeep value");
    if (cache.has(type)) return cache.get(type);
    const decl = declaration(data(types, type));
    if (decl.kind !== "struct") fail("nested type requires ordinary fixed struct");
    const nested = fieldsOf(decl.fields);
    if (!nested.length || nested.length > MAX_FIELDS) fail("invalid nested struct size");
    let width = 0;
    const members = nested.map(([name, child]) => {
      const d = descriptor(child, [...path, type]);
      width += d.width;
      if (!Number.isSafeInteger(width) || width > MAX_PACKED_BYTES)
        fail("packed value exceeds byte budget");
      return Object.freeze({name, descriptor: d});
    });
    const spec = Object.freeze({
      type, kind: "packed-struct", width, fields: Object.freeze(members)
    });
    cache.set(type, spec);
    return spec;
  }
  let rowWidth = 0;
  const columns = fields.map(([name, field]) => {
    const {type, mutable} = directField(field);
    const d = descriptor(type, [typeName]);
    rowWidth += d.width;
    if (!Number.isSafeInteger(rowWidth) || rowWidth > MAX_PACKED_BYTES)
      fail("row exceeds byte budget");
    return Object.freeze({name, descriptor: d, mutable});
  });
  const layout = Object.freeze({
    typeName, typeKind: root.kind, layout: "soa", rowWidth,
    columns: Object.freeze(columns), nesting: "one-level"
  });
  COMPILED_LAYOUTS.add(layout);
  return layout;
}
function copyValue(spec, value) {
  if (spec.kind === "scalar") {
    if (spec.type === "bool" && typeof value === "boolean") return value;
    if (spec.type === "f64" && typeof value === "number") return value;
    if (spec.type === "i64" && typeof value === "bigint" &&
        value >= -(1n << 63n) && value < (1n << 63n)) return value;
    fail("invalid scalar value for " + spec.type);
  }
  if (!exactObject(value) || Reflect.ownKeys(value).length !== spec.fields.length)
    fail("invalid packed value shape");
  const result = {};
  for (const f of spec.fields) {
    if (!own(value, f.name)) fail("missing packed member");
    result[f.name] = copyValue(f.descriptor, data(value, f.name));
  }
  return result; // deep detached copy; never a mutable alias to caller input
}

export class InvertedReferenceStore {
  #layout;
  #columns = new Map();
  #slots = [];
  #rows = [];
  #free = [];
  #issued = new WeakSet();
  #loans = new Map();
  #closed = false;
  #capacity;
  constructor(layout, capacity = 1024) {
    if (!layout || typeof layout !== "object" || !COMPILED_LAYOUTS.has(layout) ||
        !Number.isSafeInteger(capacity) || capacity < 0 ||
        layout.rowWidth * capacity > MAX_STORE_BYTES)
      fail("invalid or untrusted owner initialization");
    this.#layout = layout;
    this.#capacity = capacity;
    for (const c of layout.columns) {
      if (this.#columns.has(c.name)) fail("duplicate field");
      this.#columns.set(c.name, []);
      this.#loans.set(c.name, {readers: 0, writer: false});
    }
  }
  #open() { if (this.#closed) throw new Error("inverted owner closed"); }
  get length() { this.#open(); return this.#rows.length; }
  get column_names() { this.#open(); return [...this.#columns.keys()]; }
  #column(name) {
    this.#open();
    const c = this.#columns.get(name);
    if (!c) fail("unknown field");
    return c;
  }
  #spec(name) {
    const spec = this.#layout.columns.find(c => c.name === name);
    if (!spec) fail("unknown field");
    return spec.descriptor;
  }
  #noLoans() {
    for (const state of this.#loans.values())
      if (state.readers || state.writer) throw new Error("active column loan");
  }
  #handle(slot) {
    const s = this.#slots[slot];
    const h = Object.freeze({slot, generation: s.generation});
    this.#issued.add(h);
    return h;
  }
  #resolve(handle) {
    this.#open();
    if (!handle || typeof handle !== "object" || !this.#issued.has(handle))
      throw new Error("unissued or foreign row handle");
    const s = this.#slots[handle.slot];
    if (!s || !s.live || s.generation !== handle.generation)
      throw new Error("stale row handle");
    return s.row;
  }
  handle_at(index) {
    this.#open();
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.#rows.length)
      throw new RangeError("row index out of bounds");
    return this.#handle(this.#rows[index]);
  }
  push(row) {
    this.#open();
    this.#noLoans();
    if (!exactObject(row) || Reflect.ownKeys(row).length !== this.#columns.size)
      fail("inexact row shape");
    if (this.#rows.length === this.#capacity) throw new RangeError("inverted store full");
    // Validate and detach ALL members before touching the store.
    const values = this.#layout.columns.map(f => {
      if (!own(row, f.name)) fail("missing row member");
      return copyValue(f.descriptor, data(row, f.name));
    });
    const slot = this.#free.length ? this.#free[this.#free.length - 1] : this.#slots.length;
    const s = this.#slots[slot] || {row: 0, generation: 1, live: false};
    if (!Number.isSafeInteger(s.generation) || s.generation === Number.MAX_SAFE_INTEGER)
      throw new RangeError("handle generation exhausted");
    const index = this.#rows.length;
    let appended = 0;
    try {
      for (let i = 0; i < values.length; i++) {
        this.#columns.get(this.#layout.columns[i].name).push(values[i]);
        appended++;
      }
      this.#rows.push(slot);
      if (slot === this.#slots.length) this.#slots.push(s);
    } catch (error) {
      for (let i = 0; i < appended; i++)
        this.#columns.get(this.#layout.columns[i].name).pop();
      if (this.#rows.length > index) this.#rows.pop();
      throw error;
    }
    if (this.#free.length) this.#free.pop();
    s.row = index;
    s.live = true;
    return this.#handle(slot);
  }
  get_field(handle, name) {
    const row = this.#resolve(handle);
    const loan = this.#loans.get(name);
    if (!loan) fail("unknown field");
    if (loan.writer) throw new Error("field held for writing");
    return copyValue(this.#spec(name), this.#column(name)[row]);
  }
  set_field(handle, name, value) {
    const row = this.#resolve(handle);
    const loan = this.#loans.get(name);
    if (!loan) fail("unknown field");
    if (!this.#layout.columns.find(c => c.name === name).mutable)
      throw new Error("immutable field cannot be written");
    if (loan.writer || loan.readers) throw new Error("field loan conflict");
    const detached = copyValue(this.#spec(name), value);
    this.#column(name)[row] = detached;
  }
  snapshot(handle) {
    const row = this.#resolve(handle);
    for (const l of this.#loans.values())
      if (l.writer) throw new Error("row snapshot conflicts with column writer");
    const result = {};
    for (const c of this.#layout.columns)
      result[c.name] = copyValue(c.descriptor, this.#columns.get(c.name)[row]);
    return result;
  }
  erase_swap(handle) {
    const row = this.#resolve(handle);
    this.#noLoans();
    const last = this.#rows.length - 1;
    const dead = this.#rows[row];
    const survivor = this.#rows[last];
    if (this.#slots[dead].generation === Number.MAX_SAFE_INTEGER)
      throw new RangeError("handle generation exhausted");
    for (const col of this.#columns.values()) {
      col[row] = col[last];
      col.pop();
    }
    this.#rows[row] = survivor;
    this.#rows.pop();
    if (row !== last) this.#slots[survivor].row = row;
    this.#slots[dead].live = false;
    this.#slots[dead].generation++;
    this.#free.push(dead);
  }
  borrow_column(name, write = false) {
    if (typeof write !== "boolean") fail("column loan mode must be boolean");
    const col = this.#column(name);
    if (write && !this.#layout.columns.find(c => c.name === name).mutable)
      throw new Error("immutable field cannot be borrowed for writing");
    const loan = this.#loans.get(name);
    if (loan.writer || (write && loan.readers)) throw new Error("field loan conflict");
    if (write) loan.writer = true; else loan.readers++;
    let live = true;
    const spec = this.#spec(name);
    const requireLive = () => {
      this.#open();
      if (!live) throw new Error("closed field loan");
    };
    return Object.freeze({
      get length() { requireLive(); return col.length; },
      get(index) {
        requireLive();
        if (!Number.isSafeInteger(index) || index < 0 || index >= col.length)
          throw new RangeError("column index out of bounds");
        return copyValue(spec, col[index]);
      },
      set(index, value) {
        requireLive();
        if (!write) throw new Error("readonly field loan");
        if (!Number.isSafeInteger(index) || index < 0 || index >= col.length)
          throw new RangeError("column index out of bounds");
        col[index] = copyValue(spec, value);
      },
      close() {
        if (!live) return;
        live = false;
        if (write) loan.writer = false; else loan.readers--;
      }
    });
  }
  close() {
    if (this.#closed) return;
    this.#noLoans();
    this.#closed = true;
    for (const col of this.#columns.values()) col.length = 0;
    this.#rows.length = 0;
    this.#slots.length = 0;
    this.#free.length = 0;
  }
}
