import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateActorMemorySourceContract,
         verifyCurrentActorMemoryFixtureContract } from "../bin/verify-actor-memory-source-contract.mjs";

const root = new URL("../fixtures/actor-memory/v1/", import.meta.url);
const original = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const load = file => readFileSync(new URL(file, root), "utf8");
const clone = () => structuredClone(original);
const denied = (reason, modify, reader = load) =>
  test(reason, () => {
    const edited = clone();
    modify(edited);
    assert.throws(() => validateActorMemorySourceContract(edited, reader),
      /actor memory contract:/);
  });

test("source-only pinned actor ownership contract never certifies five backends", () => {
  const result = verifyCurrentActorMemoryFixtureContract();
  assert.equal(result.source_fixture_count, 2);
  assert.equal(result.backend_count, 5);
  assert.equal(result.guest_verified, false);
  assert.equal(result.zero_gc_verified, false);
});
denied("reject fake Java runtime evidence", m => {
  m.backends.java.verified = true;
});
denied("reject LLVM pretending to be unflagged production", m => {
  delete m.backends.llvm.requiredFlag;
});
denied("reject fabricated five-backend runtime pass", m => {
  m.verifiedRuntimeBackends.push("llvm");
});
denied("reject missing backends", m => {
  delete m.backends.js;
});
denied("reject changed expected actor result", m => {
  m.cases[0].semanticExpected.lastResult = 1005;
});
denied("reject source git blob drift", m => {
  m.cases[0].sourceGitBlobSha1 = "0".repeat(40);
});
denied("reject case count drift", m => {
  m.cases.pop();
});
denied("reject noncanonical source bytes", m => {}, file =>
  load(file).replace(/\n/g, "\r\n"));
denied("reject case file traversal", m => {
  m.cases[0].file = "../secret.ores";
});
denied("reject a false compiled-binary confirmation", m => {
  m.cases[0].runtimeVerified = true;
});
