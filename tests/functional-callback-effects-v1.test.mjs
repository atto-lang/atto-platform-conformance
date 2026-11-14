import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

// This is a *host-side reference oracle*, NOT execution of an Atto compiler.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(
  resolve(root, "contracts/functional-callback-effects-v1.json"), "utf8"));
const backendNames = ["java", "llvm", "net", "wasm", "forge"];
const forbiddenUnproven = ["PASS", "PASSED", "SUPPORTED", "EXECUTED", "COMPLETE"];

function inferCase(fixture) {
  const byId = new Map();
  for (const node of fixture.nodes) {
    assert.equal(typeof node.id, "string");
    assert.ok(node.id.length > 0 && node.id.length <= 256);
    assert.ok(!byId.has(node.id), "duplicate callable: " + node.id);
    byId.set(node.id, node);
    assert.ok(Array.isArray(node.direct));
    assert.ok(Array.isArray(node.calls));
    for (const edge of node.calls) {
      assert.equal(Number(Object.hasOwn(edge, "callback")) +
        Number(Object.hasOwn(edge, "direct")), 1,
        "exactly one effect-call edge kind required");
      if (Object.hasOwn(edge, "callback")) {
        assert.match(edge.callback, /^[A-Za-z_][A-Za-z0-9_]*$/);
      }
    }
  }
  assert.ok(byId.has(fixture.root), "unknown root callable");
  const rootNode = byId.get(fixture.root);
  const slots = new Set(rootNode.calls.flatMap(edge =>
    Object.hasOwn(edge, "callback") ? [edge.callback] : []));
  const bindings = Object.freeze({...fixture.bindings});
  for (const [name, target] of Object.entries(bindings)) {
    assert.ok(slots.has(name), "unrecognized callback slot: " + name);
    assert.equal(typeof target, "string");
    assert.ok(target.length > 0 && target.length <= 256);
  }
  const results = new Map(fixture.nodes.map(node =>
    [node.id, new Set(node.direct)]));
  // Finite monotonic fixed point handles mutually recursive callables.
  let changed = true;
  let rounds = 0;
  while (changed) {
    assert.ok(++rounds <= 256, "effect fixed point failed to converge");
    changed = false;
    for (const node of fixture.nodes) {
      const acc = new Set(node.direct);
      for (const edge of node.calls) {
        const isCallback = Object.hasOwn(edge, "callback");
        const target = isCallback
          ? (node.id === fixture.root ? bindings[edge.callback] : undefined)
          : edge.direct;
        if (!target || !results.has(target)) {
          acc.add("UNKNOWN_CALL"); // unbound or unresolved: never pure
          continue;
        }
        for (const effect of results.get(target)) {
          if (effect === "THROW" && byId.get(target).traps_throw === true) {
            continue; // does not swallow RAISE, PANIC, IO or CANCELLATION
          }
          acc.add(effect);
        }
      }
      const old = results.get(node.id);
      if (old.size !== acc.size || [...acc].some(value => !old.has(value))) {
        results.set(node.id, acc);
        changed = true;
      }
    }
  }
  const inferred = [...results.get(fixture.root)].sort();
  const admitted = rootNode.allowed === undefined ||
    inferred.every(effect => rootNode.allowed.includes(effect));
  return {inferred, admitted};
}

test("manifest is an unexecuted five-backend contract, not fabricated parity", () => {
  assert.equal(contract.schema, "attolang.functional-callback-effects.v1");
  assert.equal(contract.status, "SOURCE_AND_HOST_ORACLE_ONLY_NOT_EXECUTED");
  assert.equal(contract.source_extension, ".atto");
  assert.deepEqual(contract.backends.map(b => b.id), backendNames);
  assert.deepEqual(contract.backends.map(b => b.repository),
    backendNames.map(name =>
      "ores-truffle-oreslang/oreslang-source." + name));
  for (const backend of contract.backends) {
    assert.equal(backend.status, "NOT_EXECUTED");
    assert.ok(!forbiddenUnproven.includes(backend.status));
  }
  assert.deepEqual(contract.receipts, []);
  assert.ok(contract.required_guest_evidence.includes("ACTUAL_GUEST_EXECUTION"));
});

test("seven independent canonical callback-effect reference cases", () => {
  assert.equal(contract.cases.length, 7);
  const ids = new Set();
  for (const fixture of contract.cases) {
    assert.ok(!ids.has(fixture.id), "duplicate test case");
    ids.add(fixture.id);
    assert.deepEqual(inferCase(fixture), {
      inferred: [...fixture.expected].sort(),
      admitted: fixture.admitted,
    }, "effect disagreement: " + fixture.id);
  }
});

test("a same-named function does not discharge an unbound callback slot", () => {
  const fixture = structuredClone(contract.cases.find(c =>
    c.id === "same-named-function-no-binding"));
  assert.deepEqual(inferCase(fixture), {inferred:["UNKNOWN_CALL"], admitted:false});
  fixture.bindings.mapper = "mapper";
  assert.deepEqual(inferCase(fixture), {inferred:[], admitted:true});
});

test("bound pure callbacks never globally authorize unrelated callback sites", () => {
  const pure = structuredClone(contract.cases.find(c => c.id === "pure-map"));
  assert.deepEqual(inferCase(pure), {inferred:["ALLOC"], admitted:true});
  pure.bindings = {};
  assert.deepEqual(inferCase(pure), {
    inferred:["ALLOC","UNKNOWN_CALL"], admitted:false
  });
});

test("the oracle rejects forged undeclared callback bindings", () => {
  const fixture = structuredClone(contract.cases[0]);
  fixture.bindings = {other: "app::increment"};
  assert.throws(() => inferCase(fixture), /unrecognized callback slot/);
});

test("the oracle rejects ambiguous edges and duplicate callable identities", () => {
  const fixture = structuredClone(contract.cases[0]);
  fixture.nodes[0].calls[0].direct = "app::increment";
  assert.throws(() => inferCase(fixture), /exactly one effect-call edge/);
  delete fixture.nodes[0].calls[0].direct;
  fixture.nodes.push(structuredClone(fixture.nodes[0]));
  assert.throws(() => inferCase(fixture), /duplicate callable/);
});
