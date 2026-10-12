import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(resolve(base, path), "utf8"));
// Conditional constraints inherit required fields and type guards from
// the root schema. Ajv's strictRequired/strictTypes are *lint* diagnostics
// local to a subschema; disabling them does not relax JSON Schema validation.
const ajv = new Ajv2020({
  strict: true, strictRequired: false, strictTypes: false, allErrors: true
});

const validators = {
  receipt: ajv.compile(read("schemas/shutdown-receipt.schema.json")),
  trace: ajv.compile(read("schemas/lifecycle-trace.schema.json")),
  envelope: ajv.compile(read("schemas/typed-pipeline-envelope.schema.json")),
};
// A delimiter-joined key is ambiguous when a legitimate runtime/actor id
// itself contains '/': ("a/b","c",1) collides with ("a","b/c",1).
// Use an unambiguous tuple encoding for all physical-incarnation evidence.
const key = ({runtimeId, actorId, incarnation}) =>
  JSON.stringify([runtimeId, actorId, incarnation]);

// JSON Schema cannot express uniqueness by *one nested property*, or
// child identity inequality. Enforce those relational receipt obligations
// before accepting a receipt as evidence of parent completion.
function assertReceiptIdentity(receipt) {
  assert.ok(validators.receipt(receipt),
    JSON.stringify(validators.receipt.errors));
  const owner = key(receipt.actor);
  const children = new Set();
  for (const child of receipt.children) {
    const id = key(child.actor);
    assert.notEqual(id, owner, "parent listed as its own physical child");
    assert.ok(!children.has(id), "duplicate physical child identity");
    children.add(id);
    assert.equal(child.actor.runtimeId, receipt.actor.runtimeId,
      "cross-runtime child cannot certify parent physical completion");
  }
}

// JSON Schema enforces local shape and parent-success prerequisites.
// This validator additionally enforces chronological cross-event protocol.
function assertTraceOrdering(trace) {
  assert.ok(validators.trace(trace), JSON.stringify(validators.trace.errors));
  let lastSequence = -1;
  const observedDone = new Set();
  const stopped = new Set();
  const lastLoans = new Map();
  const lastCleanup = new Map();
  const parentDone = new Set();
  for (const event of trace.events) {
    assert.ok(event.sequence > lastSequence, "non-increasing trace sequence");
    lastSequence = event.sequence;
    const actorKey = key(event.actor);
    assert.ok(!parentDone.has(actorKey) || event.kind === "stale_callback",
      "actor emitted a live lifecycle event after physical DONE");
    if (lastLoans.has(actorKey)) {
      assert.ok(event.nativeLoans <= lastLoans.get(actorKey),
        "native loan count increased during shutdown trace");
    }
    if (lastLoans.has(actorKey) && event.nativeLoans < lastLoans.get(actorKey)) {
      assert.equal(event.kind, "native_loan_released",
        "native loans disappeared without a release event");
    }
    if (event.kind === "native_loan_released") {
      assert.ok(lastLoans.has(actorKey) &&
          lastLoans.get(actorKey) > event.nativeLoans,
        "native release without an outstanding loan");
    }
    if (lastCleanup.get(actorKey) === true && !event.pendingCleanup) {
      assert.equal(event.kind, "source_cleanup_drained",
        "source cleanup disappeared without a drain event");
    }
    if (event.kind === "source_cleanup_drained") {
      assert.equal(lastCleanup.get(actorKey), true,
        "cleanup drain without a pending cleanup");
    }
    lastLoans.set(actorKey, event.nativeLoans);
    lastCleanup.set(actorKey, event.pendingCleanup);
    if (event.physicalDone) {
      assert.equal(event.nativeLoans, 0, "physical DONE with native loans");
      assert.equal(event.pendingCleanup, false, "physical DONE during cleanup");
    }
    if (event.kind === "parent_stop" || event.kind === "child_stop") {
      stopped.add(actorKey);
    }
    if (event.kind === "child_physical_done") {
      assert.ok(stopped.has(actorKey), "child done before recorded stop");
      assert.ok(!observedDone.has(actorKey), "duplicate child physical DONE");
      observedDone.add(actorKey);
      parentDone.add(actorKey);
    }
    if (event.kind === "parent_physical_done") {
      assert.ok(stopped.has(actorKey), "parent done before recorded stop");
      assert.ok(event.children.length > 0, "missing child proofs");
      parentDone.add(actorKey);
      const unique = new Set();
      for (const child of event.children) {
        const id = key(child.actor);
        assert.ok(!unique.has(id), "duplicate child identity");
        unique.add(id);
        assert.ok(observedDone.has(id), "parent done before a child DONE event");
      }
    }
    if (event.kind === "stale_callback") {
      assert.equal(event.accepted, false, "stale callback re-admitted");
    }
  }
}

for (const [name,kind,file] of [
  ["complete receipt", "receipt", "valid-shutdown-receipt.json"],
  ["explicit failed receipt", "receipt", "failed-shutdown-receipt.json"],
  ["forward message", "envelope", "valid-forward-envelope.json"],
  ["backward message", "envelope", "valid-backward-envelope.json"],
  ["chronological actor tree", "trace", "valid-lifecycle-trace.json"],
]) {
  test("valid " + name, () => {
    const value = read("fixtures/" + file);
    assert.ok(validators[kind](value), JSON.stringify(validators[kind].errors));
    if (kind === "trace") assertTraceOrdering(value);
    if (kind === "receipt") assertReceiptIdentity(value);
  });
}

for (const [name,kind,file] of [
  ["parent success while cleanup child pending", "receipt", "reject-premature-success.json"],
  ["parent physical done with outstanding cleanup", "trace", "reject-premature-parent.json"],
  ["stale completion reopens admission", "trace", "reject-stale-admission.json"],
  ["mismatched typed message schema hash", "envelope", "reject-schema-hash.json"],
]) {
  test("reject " + name, () => {
    assert.equal(validators[kind](read("fixtures/" + file)), false);
  });
}

test("reject missing child physical DONE evidence even if receipt claims success", () => {
  const value = read("fixtures/valid-lifecycle-trace.json");
  value.events = value.events.filter(event =>
    !(event.kind === "child_physical_done" &&
      event.actor.actorId === "native-child"));
  assert.throws(() => assertTraceOrdering(value), /before a child DONE event/);
});

test("reject replay and non-monotonic event sequences", () => {
  const value = read("fixtures/valid-lifecycle-trace.json");
  value.events[3].sequence = value.events[2].sequence;
  assert.throws(() => assertTraceOrdering(value), /non-increasing trace sequence/);
});

test("reject ABA: different incarnation is not the completed child", () => {
  const value = read("fixtures/valid-lifecycle-trace.json");
  const terminal = value.events.find(event => event.kind === "parent_physical_done");
  terminal.children[0].actor.incarnation++;
  assert.throws(() => assertTraceOrdering(value), /before a child DONE event/);
});

test("reject ABA identity collision hidden by slash-separated actor keys", () => {
  const trace = read("fixtures/valid-lifecycle-trace.json");
  const parent = trace.events.find(e => e.kind === "parent_physical_done");
  // This is ONE consistently tracked child across STOP, release, and DONE.
  // A different alleged child in the parent's receipt must not alias it
  // merely because '/' was allowed inside the runtime/actor identifiers.
  for (const event of trace.events) {
    if (event.actor.actorId === "native-child" &&
        event.kind !== "stale_callback") {
      event.actor.runtimeId = "runtime-1/native";
      event.actor.actorId = "child";
    }
  }
  parent.children[0].actor.runtimeId = "runtime-1";
  parent.children[0].actor.actorId = "native/child";
  assert.throws(() => assertTraceOrdering(trace), /before a child DONE event/);
});

test("reject duplicate child identities in terminal shutdown receipt", () => {
  const value = read("fixtures/valid-shutdown-receipt.json");
  value.children.push(structuredClone(value.children[0]));
  assert.throws(() => assertReceiptIdentity(value),
    /duplicate physical child identity/);
});

test("reject parent self-reference in terminal shutdown receipt", () => {
  const value = read("fixtures/valid-shutdown-receipt.json");
  value.children[0].actor = structuredClone(value.actor);
  assert.throws(() => assertReceiptIdentity(value),
    /parent listed as its own physical child/);
});

test("reject cross-runtime child as parent shutdown proof", () => {
  const value = read("fixtures/valid-shutdown-receipt.json");
  value.children[0].actor.runtimeId = "foreign-runtime";
  assert.throws(() => assertReceiptIdentity(value),
    /cross-runtime child/);
});

test("TypeSpec compiler emitted every structural contract model", () => {
  const output = resolve(dirname(fileURLToPath(import.meta.url)), "tsp-output");
  assert.ok(existsSync(output), "run the TypeSpec compiler first");
  const names = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, {withFileTypes:true})) {
      if (entry.isDirectory()) walk(join(directory, entry.name));
      else if (entry.name.endsWith(".json")) names.push(entry.name);
    }
  };
  walk(output);
  for (const model of ["ShutdownReceipt", "LifecycleTrace", "TypedPipelineEnvelope"]) {
    assert.ok(names.some(name => name.includes(model)),
      "TypeSpec JSON Schema emitter did not emit model " + model + ": " + names.join(", "));
  }
});

test("reject duplicate child physical completion on same incarnation", () => {
  const trace = read("fixtures/valid-lifecycle-trace.json");
  const done = trace.events.find(e => e.kind === "child_physical_done");
  assert.ok(done);
  const copy = structuredClone(done);
  copy.sequence = trace.events.at(-1).sequence + 1;
  trace.events.push(copy);
  assert.throws(() => assertTraceOrdering(trace),
    /after physical DONE|duplicate child physical DONE/);
});

test("reject resource accounting increase during STOP", () => {
  const trace = read("fixtures/valid-lifecycle-trace.json");
  const stop = trace.events.find(e => e.kind === "child_stop");
  assert.ok(stop);
  const copy = structuredClone(stop);
  copy.kind = "native_loan_released";
  copy.nativeLoans += 1;
  trace.events.splice(2, 0, copy);
  trace.events.forEach((event, sequence) => { event.sequence = sequence; });
  assert.throws(() => assertTraceOrdering(trace),
    /native loan count increased/);
});

test("reject native child DONE without observed final native-loan release", () => {
  const trace = read("fixtures/valid-lifecycle-trace.json");
  trace.events = trace.events.filter(e => e.kind !== "native_loan_released");
  trace.events.forEach((e, i) => { e.sequence = i; });
  assert.throws(() => assertTraceOrdering(trace),
    /native loans disappeared without a release event/);
});

test("reject child DONE without observed source cleanup drain", () => {
  const trace = read("fixtures/valid-lifecycle-trace.json");
  trace.events = trace.events.filter(e => e.kind !== "source_cleanup_drained");
  trace.events.forEach((e, i) => { e.sequence = i; });
  assert.throws(() => assertTraceOrdering(trace),
    /source cleanup disappeared without a drain event/);
});
