import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(resolve(base, path), "utf8"));
// Conditional required/not schemas legitimately reference fields declared at
// their parent root; strictRequired is a lint-only policy, not validation.
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });

const validators = {
  receipt: ajv.compile(read("schemas/shutdown-receipt.schema.json")),
  trace: ajv.compile(read("schemas/lifecycle-trace.schema.json")),
  envelope: ajv.compile(read("schemas/typed-pipeline-envelope.schema.json")),
};
const key = (identity) =>
  identity.runtimeId + "/" + identity.actorId + "/" + identity.incarnation;

// JSON Schema enforces local shape and parent-success prerequisites.
// This validator additionally enforces chronological cross-event protocol.
function assertTraceOrdering(trace) {
  assert.ok(validators.trace(trace), JSON.stringify(validators.trace.errors));
  let lastSequence = -1;
  const observedDone = new Set();
  const stopped = new Set();
  for (const event of trace.events) {
    assert.ok(event.sequence > lastSequence, "non-increasing trace sequence");
    lastSequence = event.sequence;
    const actorKey = key(event.actor);
    if (event.kind === "parent_stop" || event.kind === "child_stop") {
      stopped.add(actorKey);
    }
    if (event.kind === "child_physical_done") {
      assert.ok(stopped.has(actorKey), "child done before recorded stop");
      observedDone.add(actorKey);
    }
    if (event.kind === "parent_physical_done") {
      assert.ok(stopped.has(actorKey), "parent done before recorded stop");
      assert.ok(event.children.length > 0, "missing child proofs");
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
