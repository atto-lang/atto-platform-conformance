// Source-free four-layout numerical reference oracle; NOT a guest compiler/backend.

// Builtin Float64Array physical geometry and issuance-fenced row IDs only.

function makeGeometry(fields, capacity, layout, options = {}) {
  if (!Array.isArray(fields) || fields.length === 0 || new Set(fields).size !== fields.length ||
      !fields.every(x => typeof x === "string" && /^[A-Za-z_]\w*$/.test(x))) throw new TypeError("invalid distinct fields");
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 1000000) throw new RangeError("invalid capacity");
  if (!["aos", "soa", "aosoa", "soaos"].includes(layout)) throw new RangeError("unknown layout");
  const width = options.tileWidth ?? 1;
  if (layout === "aosoa" && (!Number.isSafeInteger(width) || width < 1 || width > 1024)) throw new RangeError("invalid tile width");
  if (layout !== "aosoa" && options.tileWidth !== undefined) throw new RangeError("tile width only allowed for AoSoA");
  const groups = options.groups;
  if (layout === "soaos") {
    if (!Array.isArray(groups) || groups.length < 1 || groups.some(g => !Array.isArray(g) || !g.length) ||
        groups.flat().length !== fields.length || new Set(groups.flat()).size !== fields.length ||
        groups.flat().some(f => !fields.includes(f))) throw new TypeError("SoAoS groups must partition fields exactly");
  } else if (groups !== undefined) throw new TypeError("groups only allowed for SoAoS");
  const roundCapacity = layout === "aosoa" ? Math.ceil(capacity / width) * width : capacity;
  const elements = roundCapacity * fields.length;
  if (!Number.isSafeInteger(elements) || elements > 4000000) throw new RangeError("reference-oracle element budget exceeded");
  let sizes, indexes;
  if (layout === "aos") {
    sizes = [capacity * fields.length];
    indexes = Object.fromEntries(fields.map((f, i) => [f, {segment: 0, offset: i, stride: fields.length}]));
  } else if (layout === "soa") {
    sizes = fields.map(() => capacity);
    indexes = Object.fromEntries(fields.map((f, i) => [f, {segment: i, offset: 0, stride: 1}]));
  } else if (layout === "aosoa") {
    sizes = [elements];
    indexes = Object.fromEntries(fields.map((f, i) => [f, {segment: 0, offset: i * width, stride: 1}]));
  } else {
    sizes = groups.map(g => capacity * g.length);
    indexes = Object.create(null);
    groups.forEach((g, gi) => g.forEach((f, j) => {
      indexes[f] = {segment: gi, offset: j, stride: g.length};
    }));
  }
  const address = (row, field) => {
    if (!Number.isSafeInteger(row) || row < 0 || row >= capacity || !Object.hasOwn(indexes, field))
      throw new RangeError("invalid row or field");
    const p = indexes[field];
    if (layout === "aosoa") {
      return {segment: p.segment, element: Math.floor(row / width) * fields.length * width + p.offset + (row % width)};
    }
    return {segment: p.segment, element: row * p.stride + p.offset};
  };
  return {layout, fields: [...fields], capacity, sizes, address, segments: sizes.map(n => new Float64Array(n))};
}

class FourLayoutOracle {
  #g; #owner; #denseSlots = []; #slots = []; #free = []; #issued = new WeakMap(); #loans = new Set(); #dead = false;
  constructor({owner, fields, capacity, layout, tileWidth, groups}) {
    if (typeof owner !== "string" || owner.length === 0) throw new TypeError("owner required");
    this.#owner = owner;
    this.#g = makeGeometry(fields, capacity, layout, {tileWidth, groups});
  }
  get count() { return this.#denseSlots.length; }
  get layout() { return this.#g.layout; }
  address(row, field) { return this.#g.address(row, field); }
  #ensureLive() { if (this.#dead) throw new Error("retired store"); }
  #row(handle) {
    this.#ensureLive();
    if (!handle || typeof handle !== "object" || this.#issued.get(handle) !== true)
      throw new Error("unissued or foreign row handle");
    const s = this.#slots[handle.slot];
    if (!s || !s.live || s.generation !== handle.generation || handle.owner !== this.#owner)
      throw new Error("stale row handle");
    return s.row;
  }
  #cell(row, field) {
    const p = this.#g.address(row, field);
    return [this.#g.segments[p.segment], p.element];
  }
  #read(row, field) {
    const [segment, element] = this.#cell(row, field);
    return segment[element];
  }
  #write(row, field, value) {
    if (typeof value !== "number") throw new TypeError("numerical reference oracle accepts only f64");
    const [segment, element] = this.#cell(row, field);
    segment[element] = value;
  }
  #noMutationLeases() { if (this.#loans.size) throw new Error("live field loan blocks structural mutation"); }
  #authorize(field, caller, write) {
    if (!this.#g.fields.includes(field)) throw new Error("unknown field");
    if (caller !== undefined && !this.#loans.has(caller)) throw new Error("expired field loan");
    if (caller && (!caller.fields.has(field) || (write && caller.mode !== "write")))
      throw new Error("field access outside loan grant");
    for (const l of this.#loans) {
      if (l !== caller && l.fields.has(field) && (write || l.mode === "write"))
        throw new Error("conflicting field loan");
    }
  }
  push(record) {
    this.#ensureLive(); this.#noMutationLeases();
    if (this.count >= this.#g.capacity) throw new RangeError("store capacity exhausted");
    if (!record || Object.keys(record).length !== this.#g.fields.length ||
        this.#g.fields.some(f => !Object.hasOwn(record, f)))
      throw new TypeError("record schema mismatch");
    // Snapshot potentially effectful getters before reserving an ID or mutating bytes.
    // Failed field evaluation must not consume a slot or partially publish a row.
    const values = this.#g.fields.map(f => record[f]);
    if (values.some(v => typeof v !== "number")) throw new TypeError("record schema mismatch");
    const slot = this.#free.length ? this.#free.pop() : this.#slots.length;
    const s = this.#slots[slot] ?? {generation: 1, live: false, row: -1};
    if (s.generation === 0) throw new Error("generation exhausted");
    const row = this.count;
    this.#g.fields.forEach((f,i) => this.#write(row, f, values[i]));
    s.row = row; s.live = true; this.#slots[slot] = s; this.#denseSlots.push(slot);
    const h = Object.freeze({owner: this.#owner, slot, generation: s.generation});
    this.#issued.set(h, true);
    return h;
  }
  read(handle, field, loan) {
    const row = this.#row(handle); this.#authorize(field, loan, false); return this.#read(row, field);
  }
  write(handle, field, value, loan) {
    const row = this.#row(handle); this.#authorize(field, loan, true); this.#write(row, field, value);
  }
  borrow(fields, mode = "read") {
    this.#ensureLive();
    if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length ||
        fields.some(f => !this.#g.fields.includes(f)) || !["read", "write"].includes(mode))
      throw new TypeError("invalid field loan");
    const info = {fields: new Set(fields), mode};
    for (const current of this.#loans) {
      if (fields.some(f => current.fields.has(f)) && (mode === "write" || current.mode === "write"))
        throw new Error("loan collision");
    }
    this.#loans.add(info);
    return Object.freeze({
      read: (handle, field) => this.read(handle, field, info),
      write: (handle, field, value) => this.write(handle, field, value, info),
      release: () => {this.#loans.delete(info);}
    });
  }
  eraseSwap(handle) {
    const row = this.#row(handle); this.#noMutationLeases();
    const last = this.count - 1;
    if (row !== last) {
      for (const field of this.#g.fields) this.#write(row, field, this.#read(last, field));
      const movedSlot = this.#denseSlots[last];
      this.#denseSlots[row] = movedSlot;
      this.#slots[movedSlot].row = row;
    }
    for (const field of this.#g.fields) this.#write(last, field, 0);
    this.#denseSlots.pop();
    const s = this.#slots[handle.slot]; s.live = false; s.row = -1;
    s.generation = s.generation === 0xffffffff ? 0 : s.generation + 1;
    if (s.generation !== 0) this.#free.push(handle.slot);
  }
  convert(layout, options = {}) {
    this.#ensureLive(); this.#noMutationLeases();
    const next = makeGeometry(this.#g.fields, this.#g.capacity, layout, options);
    for (let r = 0; r < this.count; ++r) for (const field of this.#g.fields) {
      const p = next.address(r, field);
      next.segments[p.segment][p.element] = this.#read(r, field);
    }
    for (const segment of this.#g.segments) segment.fill(0);
    this.#g = next;
  }
  retire() {
    this.#ensureLive(); this.#noMutationLeases();
    for (const segment of this.#g.segments) segment.fill(0);
    this.#dead = true;
  }
}

export { makeGeometry, FourLayoutOracle };

