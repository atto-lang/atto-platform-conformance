import test from "node:test";
import assert from "node:assert/strict";
import { loadOrgIntegrationRegistry, validateOrgIntegrationRegistry } from "../src/integration-registry.mjs";

const source = loadOrgIntegrationRegistry();
const mutate = callback => {
  const document = structuredClone(source);
  callback(document);
  return document;
};
test("entire 56-repository inventory admits without code transfer", () => {
  const result = validateOrgIntegrationRegistry(source);
  assert.equal(result.count, 56);
  assert.equal(result.edgeCount, 120);
  assert.equal(result.topologicalOrder.length, 56);
  assert.equal(Object.values(result.areaCounts).reduce((sum, n) => sum + n, 0), 56);
  assert.deepEqual(new Set(source.repositories.map(r => r.visibility)), new Set(["private", "public"]));
});
test("unknown integration upstream rejected", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories[0].upstreams = ["not-an-oreslang-repository"];
  })), /missing or self upstream/);
});
test("direct self reference rejected", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories[0].upstreams = [d.repositories[0].name];
  })), /self upstream/);
});
test("cross-repository dependency cycle rejected", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories.find(r => r.name === "oreslang-common-source").upstreams = ["oreslang-source.java"];
  })), /circular integration dependency/);
});
test("duplicate repository denied", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories[1].name = d.repositories[0].name;
  })), /duplicate name/);
});
test("unexpected metadata fields denied rather than treated as proof", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories[0].tested = true;
  })), /wrong object fields/);
});
test("incorrect count rejected", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.expectedRepositoryCount = 51;
  })), /repository count mismatch/);
});
test("unsorted/duplicate upstreams denied", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories[0].upstreams = ["oreslang-platform-conformance", "oreslang-platform-conformance"];
  })), /sorted and unique/);
});
test("missing next acceptance step denied", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories[0].nextGate = "";
  })), /missing or malformed acceptance gate/);
});
test("untrusted owner names and visibility rejected", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories[0].name = "../different-org/private";
  })), /invalid same-organization repository name/);
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories[0].visibility = "unknown";
  })), /invalid visibility/);
});
test("missing library contract nodes and malformed input denied", () => {
  assert.throws(() => validateOrgIntegrationRegistry(mutate(d => {
    d.repositories = null;
  })), /repository count mismatch/);
  assert.throws(() => validateOrgIntegrationRegistry({ ...source, description: "passed" }), /claim boundary/);
});
