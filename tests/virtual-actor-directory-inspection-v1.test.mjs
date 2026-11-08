import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contractUrl = new URL("../contracts/virtual-actor-directory-inspection-v1.json", import.meta.url);
const contract = JSON.parse(await readFile(contractUrl, "utf8"));
const expectedBackends = ["java", "llvm", "wasm", "forge", "net"];

test("virtual actor directory contract is versioned and explicitly unattested", () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contract, "atto.virtual-actor-directory-inspection/1");
  assert.equal(contract.status, "candidate-unattested");
  assert.deepEqual(contract.targetBackends, expectedBackends);
  for (const backend of expectedBackends) {
    assert.equal(contract.backendStatus[backend].status, "NOT_EXECUTED");
    assert.equal(contract.backendStatus[backend].evidence, null);
  }
});

test("canonical atto-va1 address vector is stable and namespaced", () => {
  assert.deepEqual(contract.addressEncoding.componentOrder,
    ["domain", "namespaceQualifiedDeclaration", "canonicalKey"]);
  assert.deepEqual(contract.addressEncoding.canonicalVector.identity, {
    domain: "tenant-a",
    namespaceQualifiedDeclaration: "7:defaultCart",
    key: "42"
  });
  assert.equal(contract.addressEncoding.canonicalVector.address,
    "atto-va1.dGVuYW50LWE.NzpkZWZhdWx0Q2FydA.NDI");
  assert.equal(contract.semantics.references.virtualActorRef,
    "stable-logical-identity-resolves-current-activation");
});

test("directory cases are unique, bounded and target all five backends", () => {
  assert.equal(contract.cases.length, 12);
  const ids = contract.cases.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of contract.cases) {
    assert.ok(entry.oracle.length > 0, entry.id);
    assert.ok(entry.fixture.length > 0, entry.id);
    assert.deepEqual(entry.backends, expectedBackends, entry.id);
    assert.equal(entry.evidence, "NOT_EXECUTED", entry.id);
    assert.deepEqual(entry.backendStatus,
      Object.fromEntries(expectedBackends.map(backend => [backend, "NOT_EXECUTED"])),
      entry.id);
    assert.deepEqual(entry.evidenceRefs,
      Object.fromEntries(expectedBackends.map(backend => [backend, null])),
      entry.id);
  }
});

test("proxy identity and logical actor durability remain separate contract concepts", () => {
  assert.match(contract.semantics.proxy, /ordinary-actor-identity-and-supervision/);
  assert.match(contract.semantics.durability, /durable-provider-epoch-is-separate/);
  assert.equal(contract.semantics.distributed,
    "not-specified-by-this-local-host-contract");
});
