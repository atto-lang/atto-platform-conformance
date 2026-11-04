import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(readFileSync(new URL(
  "../contracts/state_injection/owned-instance-java-v1.json", import.meta.url
), "utf8"));

test("first owned-instance source is pinned to an immutable Git blob and exact guest oracle", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.status, "candidate-unexecuted");
  assert.equal(fixture.source.repository, "ores-truffle-oreslang/oreslang-source.java");
  assert.match(fixture.source.commit, /^[a-f0-9]{40}$/);
  assert.match(fixture.source.gitBlob, /^[a-f0-9]{40}$/);
  assert.equal(fixture.source.path, "examples/state-backed-instance-v1.ores");
  assert.equal(fixture.expected.kind, "compile-and-run");
  assert.equal(fixture.expected.exitCode, 0);
  assert.equal(fixture.expected.stdout, "7|3|10|true|false|false|false");
});

test("source-only Java milestone cannot become a false native backend pass", () => {
  assert.deepEqual(Object.keys(fixture.backendEvidence).sort(),
    ["java", "llvm", "wasm", "cranelift", "net", "forge"].sort());
  for (const state of Object.values(fixture.backendEvidence)) {
    assert.equal(state, "not-executed");
  }
  assert.match(fixture.scope, /no @Inject provider/);
  assert.ok(fixture.requirements.some(s => s.includes("Zero-step CI")));
});
