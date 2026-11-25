import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {
  BoxReference, VectorReference, ArcReference, GuardedCellReference
} from "../src/heap-containers-v1-reference.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/heap-containers-v1.json", import.meta.url), "utf8"));

const checked = {
  "box-move-preserves-unique-owner": () => {
    const original = new BoxReference(41);
    const moved = original.move();
    const loan = moved.borrow();
    assert.equal(loan.read(), 41);
    loan.close();
    moved.drop();
    assert.deepEqual(moved.inspect(), {handleLive: false, dropped: true, drops: 1});
  },
  "box-use-after-move": () => {
    const owner = new BoxReference(1);
    owner.move();
    owner.borrow();
  },
  "box-drop-while-borrowed": () => {
    const owner = new BoxReference(1);
    owner.borrow();
    owner.drop();
  },
  "box-mut-borrow-conflict": () => {
    const owner = new BoxReference(1);
    owner.borrow("read");
    owner.borrow("write");
  },
  "box-two-shared-borrows": () => {
    const owner = new BoxReference(1);
    const a = owner.borrow("read");
    const b = owner.borrow("read");
    assert.equal(a.read(), b.read());
    a.close();
    b.close();
    const writer = owner.borrow("write");
    writer.write(42);
    assert.equal(writer.read(), 42);
    writer.close();
    owner.drop();
  },
  "box-single-drop": () => {
    const owner = new BoxReference(1);
    owner.drop();
    assert.equal(owner.inspect().drops, 1);
    assert.throws(() => owner.drop(), /HEAP_CONTAINERS_DENIED/);
  },
  "vector-grow-and-preserve-elements": () => {
    const v = new VectorReference(7);
    v.push(10);
    v.push(20);
    const epoch = v.epoch;
    v.reserve(7);
    assert.equal(v.capacity, 7);
    assert.ok(v.epoch > epoch);
    v.push(30);
    assert.deepEqual([v.get(0), v.get(1), v.get(2)], [10, 20, 30]);
    assert.deepEqual(v.pop(), {present: true, value: 30});
  },
  "vector-reserve-under-read-loan": () => {
    const v = new VectorReference();
    v.push(1);
    v.borrow(0);
    v.reserve(32);
  },
  "vector-grow-under-write-loan": () => {
    const v = new VectorReference();
    v.push(1);
    v.borrow(0, "write");
    v.push(2);
  },
  "vector-write-during-shared-loan": () => {
    const v = new VectorReference();
    v.push(1);
    v.borrow(0);
    v.set(0, 2);
  },
  "vector-bounds": () => {
    const v = new VectorReference();
    v.push(1);
    v.borrow(1);
  },
  "vector-over-capacity": () => {
    const v = new VectorReference(1);
    v.push(1);
    v.push(2);
  },
  "vector-element-exclusive-borrow": () => {
    const v = new VectorReference();
    v.push(1);
    const writer = v.borrow(0, "write");
    writer.write(7);
    assert.equal(writer.read(), 7);
    assert.throws(() => v.get(0), /HEAP_CONTAINERS_DENIED/);
    writer.close();
    assert.equal(v.get(0), 7);
    assert.throws(() => writer.read(), /HEAP_CONTAINERS_DENIED/);
  },
  "vector-pop-empty": () => {
    const v = new VectorReference(0);
    assert.deepEqual(v.pop(), {present: false});
  },
  "vector-invalid-element-preserves-allocation": () => {
    const v = new VectorReference(8);
    v.push(10);
    const before = {length: v.length, capacity: v.capacity, epoch: v.epoch};
    assert.throws(() => v.push({untrusted: true}), /HEAP_CONTAINERS_DENIED/);
    assert.deepEqual({length: v.length, capacity: v.capacity, epoch: v.epoch}, before);
    assert.equal(v.get(0), 10);
  },
  "vector-invalid-push-does-not-spend-final-quota": () => {
    const v = new VectorReference(2);
    v.push(1);
    assert.throws(() => v.push(Number.NaN), /HEAP_CONTAINERS_DENIED/);
    assert.equal(v.capacity, 1);
    v.push(2);
    assert.deepEqual([v.get(0), v.get(1)], [1, 2]);
  },
  "vector-overbudget-reserve-is-transactional": () => {
    const v = new VectorReference(3);
    v.push(1);
    const epoch = v.epoch;
    const capacity = v.capacity;
    assert.throws(() => v.reserve(4), /HEAP_CONTAINERS_DENIED/);
    assert.equal(v.epoch, epoch);
    assert.equal(v.capacity, capacity);
    assert.equal(v.get(0), 1);
  },
  "arc-clone-count-preserves-payload": () => {
    const original = new ArcReference(42);
    const cloned = original.clone();
    assert.equal(original.strongCount, 2);
    assert.equal(cloned.read(), 42);
    original.drop();
    assert.equal(cloned.read(), 42);
    assert.equal(cloned.strongCount, 1);
    cloned.drop();
  },
  "arc-upgrade-weak-before-drop": () => {
    const arc = new ArcReference(5);
    const weak = arc.downgrade();
    const upgraded = weak.upgrade();
    assert.ok(upgraded !== null);
    arc.drop();
    assert.equal(upgraded.read(), 5);
    upgraded.drop();
    assert.equal(weak.upgrade(), null);
    weak.drop();
  },
  "arc-weak-upgrade-after-final-drop": () => {
    const arc = new ArcReference(5);
    const weak = arc.downgrade();
    arc.drop();
    assert.equal(weak.upgrade(), null);
    weak.drop();
  },
  "arc-use-after-drop": () => {
    const arc = new ArcReference(5);
    arc.drop();
    arc.read();
  },
  "arc-mutability-requires-guard": () => {
    new ArcReference({mutable: 5});
  },
  "arc-guarded-mutation": () => {
    const cell = new GuardedCellReference(3);
    const a = new ArcReference(cell);
    const b = a.clone();
    b.read().with_write(guard => guard.write(9));
    assert.equal(a.read().with_read(value => value), 9);
    a.drop();
    b.drop();
  },
  "mutex-reentrant-write": () => {
    const cell = new GuardedCellReference(1);
    cell.with_write(() => cell.with_write(() => 5));
  },
  "mutex-releases-on-throw": () => {
    const cell = new GuardedCellReference(1);
    assert.throws(() => cell.with_write(() => { throw Error("fail"); }), /fail/);
    cell.with_write(guard => guard.write(2));
    assert.equal(cell.with_read(value => value), 2);
  },
  "mutex-suspending-guard": () => {
    const cell = new GuardedCellReference(1);
    cell.with_write(async () => 3);
  },
  "mutex-escaped-guard-write-reject": () => {
    const cell = new GuardedCellReference(1);
    let stolen;
    cell.with_write(guard => { stolen = guard; });
    stolen.write(99);
  },
  "mutex-return-write-guard-reject": () => {
    const cell = new GuardedCellReference(1);
    cell.with_write(guard => guard);
  },
  "mutex-read-read-reentrancy": () => {
    const cell = new GuardedCellReference(4);
    assert.equal(cell.with_read(first => cell.with_read(second => first + second)), 8);
  },
  "mutex-write-within-read-reject": () => {
    const cell = new GuardedCellReference(1);
    cell.with_read(() => cell.with_write(guard => guard.write(2)));
  },
  "mutex-read-within-write-reject": () => {
    const cell = new GuardedCellReference(1);
    cell.with_write(() => cell.with_read(value => value));
  },
  "mutex-after-throw-guard-revoked": () => {
    const cell = new GuardedCellReference(1);
    let escaped;
    assert.throws(() => cell.with_write(guard => {
      escaped = guard;
      throw new Error("unwind");
    }), /unwind/);
    escaped.write(2);
  },
  "mutex-write-after-read-release": () => {
    const cell = new GuardedCellReference(1);
    assert.equal(cell.with_read(value => value), 1);
    cell.with_write(guard => guard.write(3));
    assert.equal(cell.with_read(value => value), 3);
  },
  "mutex-suspension-always-revokes": () => {
    const cell = new GuardedCellReference(1);
    let escaped;
    assert.throws(() => cell.with_write(guard => {
      escaped = guard;
      return Promise.resolve(9);
    }), /suspending/);
    escaped.write(9);
  },
  "box-move-under-live-heap-loan": () => {
    const box = new BoxReference(2);
    box.borrow("read");
    box.move();
  },
  "box-double-use-after-drop": () => {
    const box = new BoxReference(2);
    box.drop();
    box.borrow();
  },
  "arc-saved-mutable-view-after-drop-reject": () => {
    const a = new ArcReference(new GuardedCellReference(1));
    const saved = a.read();
    a.drop();
    saved.with_write(guard => guard.write(2));
  },
  "arc-drop-during-active-guard-reject": () => {
    const a = new ArcReference(new GuardedCellReference(1));
    a.read().with_write(() => a.drop());
  },
  "arc-cloned-handle-retains-guarded-referent": () => {
    const a = new ArcReference(new GuardedCellReference(1));
    const b = a.clone();
    const stale = a.read();
    a.drop();
    assert.throws(() => stale.with_read(value => value), /HEAP_CONTAINERS_DENIED/);
    b.read().with_write(guard => guard.write(42));
    assert.equal(b.read().with_read(value => value), 42);
    b.drop();
  }
};

function validateManifest(doc) {
  assert.deepEqual(Object.keys(doc).sort(), [
    "backends", "candidate_alias", "canonical_resizable_type",
    "cases", "compiler_assertions_executed", "evidence_status",
    "guest_fixtures",
    "existing_resizable_family", "guest_fixtures_executed",
    "runtime_backends_verified", "schema_version", "source_language_support",
    "suite"
  ].sort());
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.suite, "heap-containers-v1");
  assert.equal(doc.evidence_status, "source-free-reference-only");
  assert.equal(doc.source_language_support, "unverified");
  assert.equal(doc.canonical_resizable_type, "Vector[T]");
  assert.deepEqual(doc.existing_resizable_family, ["Array[T]", "List[T]", "Vector[T]"]);
  assert.match(doc.candidate_alias, /not admitted/);
  assert.deepEqual(Object.keys(doc.backends).sort(),
    ["java-graal", "llvm-native", "wasm", "forge", "net-native-aot", "cranelift"].sort());
  for (const status of Object.values(doc.backends)) assert.equal(status, "unverified");
  assert.equal(doc.guest_fixtures_executed, 0);
  assert.equal(doc.compiler_assertions_executed, 0);
  assert.equal(doc.runtime_backends_verified, 0);
  const fixtureIds = [
    "array-growth-positive", "heap-projected-mut-borrow-positive",
    "heap-conflicting-loans-reject", "array-grow-live-loan-reject",
    "box-owner-after-take-reject"
  ];
  assert.equal(doc.guest_fixtures.length, fixtureIds.length);
  for (const [i, fixture] of doc.guest_fixtures.entries()) {
    assert.deepEqual(Object.keys(fixture).sort(),
      ["id", "path", "blob_sha1", "expectation", "execution"].sort());
    assert.equal(fixture.id, fixtureIds[i]);
    assert.equal(fixture.path, "fixtures/heap-containers-v1/" + fixture.id + ".ores");
    assert.match(fixture.blob_sha1, /^[0-9a-f]{40}$/);
    assert.equal(fixture.execution, "not-executed");
    assert.deepEqual(fixture.expectation, i < 2 ?
      {kind: "return", exit_code: 42} :
      {kind: "reject", emitted_executable_ir_bytes: 0});
  }
  assert.equal(doc.cases.length, Object.keys(checked).length);
  const seen = new Set();
  for (const c of doc.cases) {
    assert.deepEqual(Object.keys(c).sort(), ["expected", "id"]);
    assert.equal(typeof c.id, "string");
    assert.ok(Object.hasOwn(checked, c.id), "unknown case: " + c.id);
    assert.ok(!seen.has(c.id), "duplicate case: " + c.id);
    assert.ok(c.expected === "accept" || c.expected === "deny");
    seen.add(c.id);
  }
  assert.deepEqual([...seen].sort(), Object.keys(checked).sort());
}

test("heap container manifest is pinned and does not certify guest execution", () => {
  validateManifest(contract);
});
test("manifest denies fabricated backend execution", () => {
  const fake = structuredClone(contract);
  fake.backends["llvm-native"] = "passed";
  assert.throws(() => validateManifest(fake));
});
test("manifest denies missing cases and duplicate IDs", () => {
  const missing = structuredClone(contract);
  missing.cases.pop();
  assert.throws(() => validateManifest(missing));
  const duplicate = structuredClone(contract);
  duplicate.cases[1].id = duplicate.cases[0].id;
  assert.throws(() => validateManifest(duplicate));
});
test("manifest denies fabricated guest or compiler counts", () => {
  const fake = structuredClone(contract);
  fake.guest_fixtures_executed = 1;
  assert.throws(() => validateManifest(fake));
  fake.guest_fixtures_executed = 0;
  fake.compiler_assertions_executed = 1;
  assert.throws(() => validateManifest(fake));
});
test("five canonical guest fixtures are exact Git blobs, not fabricated executions", () => {
  validateManifest(contract);
  for (const fixture of contract.guest_fixtures) {
    const bytes = readFileSync(new URL("../" + fixture.path, import.meta.url));
    const actual = createHash("sha1")
      .update("blob " + bytes.length + "\0")
      .update(bytes).digest("hex");
    assert.equal(actual, fixture.blob_sha1, "fixture drift: " + fixture.id);
    const source = bytes.toString("utf8");
    assert.match(source, /pub fnc main\(\): int/);
    assert.doesNotMatch(source, /rt borrow mut|\b(?:let|val|const)\s+&/);
  }
  const negatives = contract.guest_fixtures.filter(x => x.expectation.kind === "reject");
  assert.equal(negatives.length, 3);
  assert.equal(contract.guest_fixtures_executed, 0);
});

for (const {id, expected} of contract.cases) {
  test("heap ownership oracle: " + id, () => {
    if (expected === "deny") {
      assert.throws(checked[id], /HEAP_CONTAINERS_DENIED/);
    } else {
      assert.doesNotThrow(checked[id]);
    }
  });
}
