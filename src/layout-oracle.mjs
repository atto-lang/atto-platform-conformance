// Host-side reference oracle for layout semantics; not an Oreslang compiler backend.
// Deliberately scalar: no performance or zero-GC claim.
export class LayoutOracle {
  constructor(fields, layout, tileWidth = 4) {
    if (!Array.isArray(fields) || !fields.length || fields.some(x => typeof x !== "string" || !x) || new Set(fields).size !== fields.length) throw Error("invalid fields");
    if (!["aos", "soa", "aosoa", "soaos"].includes(layout)) throw Error("invalid layout");
    if (!Number.isSafeInteger(tileWidth) || tileWidth < 1 || tileWidth > 1024) throw Error("invalid tile width");
    this.fields = [...fields];
    this.layout = layout;
    this.tileWidth = tileWidth;
    this.rows = [];
    this.generations = [];
    this.free = [];
  }
  insert(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== this.fields.length ||
        this.fields.some(k => !Object.hasOwn(value, k))) throw Error("invalid row shape");
    const slot = this.free.length ? this.free.pop() : this.rows.length;
    if (slot === this.rows.length) { this.rows.push(null); this.generations.push(1); }
    this.rows[slot] = this.fields.map(k => value[k]);
    return Object.freeze({slot, generation: this.generations[slot]});
  }
  #check(handle) {
    if (!handle || !Number.isSafeInteger(handle.slot) || handle.slot < 0 ||
        handle.slot >= this.rows.length || this.rows[handle.slot] === null ||
        this.generations[handle.slot] !== handle.generation) throw Error("stale row handle");
    return handle.slot;
  }
  read(handle) {
    const row = this.rows[this.#check(handle)];
    return Object.fromEntries(this.fields.map((key, i) => [key, row[i]]));
  }
  write(handle, field, value) {
    const slot = this.#check(handle), index = this.fields.indexOf(field);
    if (index < 0) throw Error("unknown field");
    this.rows[slot][index] = value;
  }
  remove(handle) {
    const slot = this.#check(handle);
    this.rows[slot] = null;
    this.generations[slot] += 1;
    if (!Number.isSafeInteger(this.generations[slot])) throw Error("generation exhausted");
    this.free.push(slot);
  }
  snapshot() {
    const live = this.rows.map((r, i) => r === null ? null : {slot:i, values:[...r]}).filter(Boolean);
    if (this.layout === "aos") return live.map(r => Object.fromEntries(this.fields.map((k,i)=>[k,r.values[i]])));
    if (this.layout === "soa") return Object.fromEntries(this.fields.map((k,i)=>[k,live.map(r=>r.values[i])]));
    const tiles = [];
    for (let start=0; start<live.length; start+=this.tileWidth) {
      const group=live.slice(start,start+this.tileWidth);
      tiles.push(this.layout === "aosoa"
        ? Object.fromEntries(this.fields.map((k,i)=>[k,group.map(r=>r.values[i])]))
        : group.map(r=>Object.fromEntries(this.fields.map((k,i)=>[k,r.values[i]]))));
    }
    return tiles;
  }
  convert(layout) {
    if (!["aos","soa","aosoa","soaos"].includes(layout)) throw Error("invalid layout");
    this.layout = layout;
  }
}
