import test from "node:test";
import assert from "node:assert/strict";
import {compile_inverted_layout, InvertedReferenceStore} from "../src/inverted-layout-reference.mjs";

const types = Object.freeze({
  Vec3: {kind: "struct", fields: {x: "f64", y: "f64", z: "f64"}},
  Point: {kind: "struct", fields: {x: "f64", y: "f64"}},
  Particle: {kind: "inverted-class", fields: {
    position: {type: "Vec3", mutable: true}, velocity: "Vec3",
    mass: {type: "f64", mutable: true}, alive: {type: "bool", mutable: true}, id: "i64"
  }},
  Position: {kind: "inverted-struct", fields: {x: "f64", y: "f64"}},
  Ordinary: {kind: "class", fields: {id: "i64", position: "Vec3"}}
});
const vec = (x) => ({x, y: x + 1, z: x + 2});
const particle = (id) => ({
  position: vec(id), velocity: vec(id + 10), mass: id + 0.5, alive: true, id: BigInt(id)
});
const make = (type = "Particle", count = 20) =>
  new InvertedReferenceStore(compile_inverted_layout(types, type), count);

test("inverted structs and inverted classes are independently named", () => {
  const s = compile_inverted_layout(types, "Position");
  assert.equal(s.typeKind, "inverted-struct");
  assert.deepEqual(s.columns.map(c => c.name), ["x", "y"]);
  const c = compile_inverted_layout(types, "Particle");
  assert.equal(c.typeKind, "inverted-class");
  assert.equal(c.columns.length, 5);
  assert.equal(c.columns[0].descriptor.kind, "packed-struct");
  assert.deepEqual(c.columns[0].descriptor.fields.map(f => f.name), ["x", "y", "z"]);
  assert.equal(c.layout, "soa");
  assert.equal(c.nesting, "one-level");
});

test("ordinary struct/class may be explicitly inverted at collection boundary", () => {
  for (const type of ["Point", "Ordinary"]) {
    const layout = compile_inverted_layout(types, type);
    assert.equal(layout.typeKind, types[type].kind);
    assert.equal(layout.columns.length, 2);
  }
});

test("nested ordinary Vec3 is exactly one packed value column, never x/y/z columns", () => {
  const store = make();
  const input = particle(1);
  const h = store.push(input);
  assert.deepEqual(store.column_names, ["position", "velocity", "mass", "alive", "id"]);
  input.position.x = -999;
  assert.equal(store.get_field(h, "position").x, 1);
  const detached = store.get_field(h, "position");
  detached.y = -999;
  assert.equal(store.snapshot(h).position.y, 2);
  assert.deepEqual(store.snapshot(h), particle(1));
});

test("nested inverted struct/class always rejects absent an explicit supported layout boundary", () => {
  const bad = {
    Inner: {kind: "inverted-struct", fields: {x: "f64"}},
    Outer: {kind: "inverted-class", fields: {inner: "Inner"}}
  };
  assert.throws(() => compile_inverted_layout(bad, "Outer"), /nested type requires ordinary fixed struct/);
  bad.Inner.kind = "inverted-class";
  assert.throws(() => compile_inverted_layout(bad, "Outer"), /nested type requires ordinary fixed struct/);
});

test("reject pointers, variable-length fields, absent schemas, recursive layouts, bad capacity", () => {
  for (const type of ["String", "Pointer", "Array<f64>", "Missing"])
    assert.throws(() => compile_inverted_layout({
      Bad: {kind: "struct", fields: {field: type}}}, "Bad"), /unknown field type/);
  assert.throws(() => compile_inverted_layout({
    Recursive: {kind: "struct", fields: {value: "Recursive"}}}, "Recursive"), /recursive/);
  assert.throws(() => new InvertedReferenceStore(compile_inverted_layout(types, "Point"), -1));
});

test("validate all fields before insertion; overflow and failed insertion do not change length", () => {
  const store = make("Particle", 1);
  assert.throws(() => store.push({...particle(1), id: 1}), /invalid scalar/);
  assert.equal(store.length, 0);
  const h = store.push(particle(1));
  assert.equal(store.length, 1);
  assert.throws(() => store.push(particle(2)), /full/);
  assert.equal(store.length, 1);
  assert.equal(store.get_field(h, "id"), 1n);
  const signed = new InvertedReferenceStore(compile_inverted_layout({
    S: {kind: "inverted-struct", fields: {x: {type: "i64", mutable: true}}}
  }, "S"), 1);
  const sh = signed.push({x: 1n});
  assert.throws(() => signed.set_field(sh, "x", 1n << 63n), /invalid scalar/);
  assert.equal(signed.get_field(sh, "x"), 1n);
  assert.equal(store.get_field(h, "id"), 1n);
});

test("generation-checked handles survive swap deletion; stale, fabricated and foreign fail", () => {
  const a = make("Particle", 5), b = make("Particle", 5);
  const first = a.push(particle(1)), second = a.push(particle(2)), third = a.push(particle(3));
  b.push(particle(4));
  assert.throws(() => a.get_field({slot: 0, generation: 1}, "mass"), /unissued/);
  assert.throws(() => b.get_field(first, "mass"), /foreign/);
  a.erase_swap(second);
  assert.equal(a.get_field(third, "mass"), 3.5);
  assert.equal(a.get_field(a.handle_at(1), "id"), 3n);
  assert.throws(() => a.get_field(second, "mass"), /stale/);
  const reused = a.push(particle(5));
  assert.equal(reused.slot, second.slot);
  assert.notEqual(reused.generation, second.generation);
  assert.equal(a.get_field(first, "id"), 1n);
  assert.throws(() => a.get_field(second, "id"), /stale/);
  assert.throws(() => a.handle_at(20), /out of bounds/);
  assert.throws(() => a.handle_at(1.5), /out of bounds/);
});

test("field-disjoint write loans coexist while overlapping loans reject", () => {
  const store = make();
  const h = store.push(particle(7));
  const x = store.borrow_column("mass", true);
  const y = store.borrow_column("alive", true);
  assert.throws(() => store.borrow_column("mass", false), /conflict/);
  assert.throws(() => store.push(particle(8)), /active column loan/);
  assert.throws(() => store.erase_swap(h), /active column loan/);
  assert.throws(() => store.snapshot(h), /conflicts/);
  assert.throws(() => store.close(), /active column loan/);
  x.set(0, 42);
  y.set(0, false);
  assert.equal(x.get(0), 42);
  x.close(); y.close();
  assert.equal(store.get_field(h, "mass"), 42);
  assert.equal(store.get_field(h, "alive"), false);
  assert.throws(() => x.get(0), /closed field loan/);
});

test("read loans may coexist, do not expose mutable alias, and block writes", () => {
  const store = make();
  const h = store.push(particle(1));
  const a = store.borrow_column("position");
  const b = store.borrow_column("position");
  const detached = a.get(0);
  detached.x = 500;
  assert.equal(b.get(0).x, 1);
  assert.throws(() => a.set(0, vec(5)), /readonly/);
  assert.throws(() => store.set_field(h, "position", vec(6)), /loan conflict/);
  assert.throws(() => store.borrow_column("position", true), /conflict/);
  a.close(); b.close();
  store.set_field(h, "position", vec(6));
  assert.equal(store.snapshot(h).position.x, 6);
});

test("randomized differential oracle for insert/snapshot/swap-delete and id retention", () => {
  const store = make("Particle", 500);
  const oracle = new Map();
  const live = [];
  let seed = 0x12345678;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  let id = 1;
  for (let turn = 0; turn < 2000; turn++) {
    if (live.length === 0 || (live.length < 400 && random() % 3 !== 0)) {
      const row = particle(id++);
      const handle = store.push(row);
      live.push(handle);
      oracle.set(handle, row);
    } else {
      const ix = random() % live.length;
      const [handle] = live.splice(ix, 1);
      store.erase_swap(handle);
      oracle.delete(handle);
      assert.throws(() => store.snapshot(handle), /stale/);
    }
    assert.equal(store.length, live.length);
    if (live.length) {
      const h = live[random() % live.length];
      assert.deepEqual(store.snapshot(h), oracle.get(h));
    }
  }
  store.close();
  assert.throws(() => store.get_field(live[0], "id"), /closed/);
  assert.throws(() => store.push(particle(id)), /closed/);
});

test("root inverted struct can be used with same checked owner lifecycle", () => {
  const store = make("Position", 2);
  const h = store.push({x: -0, y: NaN});
  assert.equal(Object.is(store.get_field(h, "x"), -0), true);
  assert.equal(Number.isNaN(store.snapshot(h).y), true);
  store.erase_swap(h);
  assert.throws(() => store.snapshot(h), /stale/);
});


test("reject forged/unbranded layout descriptors even if their visible shape matches", () => {
  const compiled = compile_inverted_layout(types, "Position");
  const counterfeit = {...compiled, columns: compiled.columns};
  assert.throws(() => new InvertedReferenceStore(counterfeit), /untrusted/);
  assert.throws(() => new InvertedReferenceStore({...compiled}), /untrusted/);
  assert.throws(() => new InvertedReferenceStore(null), /untrusted/);
  const actual = new InvertedReferenceStore(compiled, 1);
  const h = actual.push({x: 1, y: 2});
  assert.equal(actual.snapshot(h).x, 1);
});

test("deep freeze prevents mutation of compiled scalar and nested field type", () => {
  const layout = compile_inverted_layout(types, "Particle");
  assert.equal(Object.isFrozen(layout), true);
  assert.equal(Object.isFrozen(layout.columns), true);
  assert.equal(Object.isFrozen(layout.columns[0]), true);
  assert.equal(Object.isFrozen(layout.columns[0].descriptor), true);
  assert.equal(Object.isFrozen(layout.columns[0].descriptor.fields), true);
  assert.equal(Object.isFrozen(layout.columns[0].descriptor.fields[0].descriptor), true);
  assert.throws(() => { layout.columns[0].descriptor.fields[0].descriptor.type = "bool"; }, TypeError);
  assert.throws(() => { layout.columns.push({name: "injected"}); }, TypeError);
  const s = new InvertedReferenceStore(layout, 1);
  assert.equal(s.push(particle(1)).slot, 0);
});

test("schema snapshot is independent of mutation of caller declarations", () => {
  const declared = {P: {kind: "struct", fields: {x: "f64", y: "bool"}}};
  const layout = compile_inverted_layout(declared, "P");
  declared.P.fields.x = "i64";
  declared.P.fields.extra = "i64";
  declared.P.kind = "inverted-class";
  const store = new InvertedReferenceStore(layout, 2);
  const h = store.push({x: 1.5, y: true});
  assert.deepEqual(store.snapshot(h), {x: 1.5, y: true});
  assert.throws(() => store.push({x: 2n, y: true}), /invalid scalar/);
});

test("schema and row accessors are rejected before side effects or publication", () => {
  const badType = {T: {kind: "struct", fields: {x: "f64"}}};
  Object.defineProperty(badType.T.fields, "danger", {
    enumerable: true, get() { throw Error("effectful schema getter executed"); }
  });
  assert.throws(() => compile_inverted_layout(badType, "T"), /accessor/);
  const store = make("Particle", 2);
  const row = particle(1);
  Object.defineProperty(row, "mass", {
    enumerable: true, get() { throw Error("effectful payload getter executed"); }
  });
  assert.throws(() => store.push(row), /accessor/);
  assert.equal(store.length, 0);
  const clean = particle(2);
  const h = store.push(clean);
  assert.equal(store.get_field(h, "mass"), 2.5);
  const badPacked = particle(3);
  Object.defineProperty(badPacked.position, "x", {
    enumerable: true, get() { throw Error("effectful packed getter executed"); }
  });
  assert.throws(() => store.push(badPacked), /accessor/);
  assert.equal(store.length, 1);
});

test("reject prototype pollution keys, symbol schema keys, rogue modifiers and extras", () => {
  const members = Object.create(null);
  members.__proto__ = "f64";
  assert.throws(() => compile_inverted_layout({
    Bad: {kind: "inverted-struct", fields: members}
  }, "Bad"), /invalid field name/);
  assert.throws(() => compile_inverted_layout({
    Bad: {kind: "inverted-class", fields: {x: "f64"}, extends: "Parent"}
  }, "Bad"), /unsupported declaration metadata/);
  assert.throws(() => compile_inverted_layout({
    Bad: {kind: "struct", fields: {[Symbol("extra")]: "f64", x: "f64"}}
  }, "Bad"), /invalid field name/);
  const store = make("Position", 2);
  assert.throws(() => store.push({x: 1, y: 2, unexpected: 3}), /inexact row shape/);
  assert.equal(store.length, 0);
});

test("bounded packed widths and collection byte quotas fail before owner allocation", () => {
  const declared = {Leaf: {kind: "struct", fields: {x: "f64", y: "f64"}}};
  let child = "Leaf";
  for (let i = 0; i < 14; i++) {
    declared["Node" + i] = {kind: "struct", fields: {left: child, right: child}};
    child = "Node" + i;
  }
  declared.Root = {kind: "inverted-struct", fields: {value: child}};
  assert.throws(() => compile_inverted_layout(declared, "Root"), /byte budget/);
  const layout = compile_inverted_layout(types, "Position");
  assert.throws(() => new InvertedReferenceStore(layout, 2000000), /invalid or untrusted/);
  const store = new InvertedReferenceStore(layout, 0);
  assert.equal(store.length, 0);
  assert.throws(() => store.push({x: 1, y: 2}), /full/);
});

test("nested struct loan writes detach input and cannot mutate authoritative row by alias", () => {
  const store = make();
  const h = store.push(particle(2));
  const writer = store.borrow_column("position", true);
  const replacement = vec(30);
  writer.set(0, replacement);
  replacement.x = 9999;
  const got = writer.get(0);
  got.x = -333;
  assert.equal(writer.get(0).x, 30);
  assert.throws(() => store.set_field(h, "position", vec(4)), /loan conflict/);
  writer.close();
  assert.equal(store.snapshot(h).position.x, 30);
});

test("loan privilege must be an explicit boolean, not an accidental truthy value", () => {
  const store = make("Position", 1);
  store.push({x: 1, y: 2});
  for (const value of [1, "write", [], {}, null])
    assert.throws(() => store.borrow_column("x", value), /must be boolean/);
  const reader = store.borrow_column("x", false);
  assert.equal(reader.get(0), 1);
  reader.close();
});

test("untrusted nested symbol-bearing names cannot bypass fixed schema eligibility", () => {
  const typesWithUnsafe = Object.create(null);
  typesWithUnsafe.Root = {kind: "inverted-struct", fields: {child: "__proto__"}};
  typesWithUnsafe.__proto__ = {kind: "struct", fields: {x: "f64"}};
  assert.throws(() => compile_inverted_layout(typesWithUnsafe, "Root"), /unknown field type/);
});


test("implicit val fields are immutable after row initialization", () => {
  const store = make("Particle", 2);
  const h = store.push(particle(1));
  assert.equal(store.get_field(h, "id"), 1n);
  assert.throws(() => store.set_field(h, "id", 2n), /immutable field/);
  assert.throws(() => store.borrow_column("id", true), /immutable field/);
  assert.throws(() => store.set_field(h, "velocity", vec(4)), /immutable field/);
  const reader = store.borrow_column("id", false);
  assert.equal(reader.get(0), 1n);
  reader.close();
  assert.deepEqual(store.snapshot(h), particle(1));
  // Struct roots also default to implicit val.
  const positions = make("Position", 1);
  const position = positions.push({x: 1, y: 2});
  assert.throws(() => positions.set_field(position, "x", 9), /immutable field/);
});

test("explicit let fields permit checked writes but do not weaken other fields", () => {
  const store = make("Particle", 2);
  const h = store.push(particle(3));
  assert.equal(store.get_field(h, "id"), 3n);
  store.set_field(h, "mass", 42.5);
  const writer = store.borrow_column("alive", true);
  writer.set(0, false);
  writer.close();
  assert.equal(store.get_field(h, "mass"), 42.5);
  assert.equal(store.get_field(h, "alive"), false);
  assert.throws(() => store.borrow_column("velocity", true), /immutable field/);
});

test("malformed direct field binding cannot mint write capability", () => {
  const invalid = [
    {type: "i64", mutable: 1},
    {type: "i64", mutable: "true"},
    {type: "i64", mutable: true, extra: false},
    {type: "i64"},
    Object.defineProperty({type: "i64"}, "mutable", {get() {throw Error("getter executed");}}),
  ];
  for (const field of invalid) {
    assert.throws(() => compile_inverted_layout({
      Root: {kind: "inverted-struct", fields: {x: field}}
    }, "Root"), /invalid direct field binding|accessor/);
  }
});
