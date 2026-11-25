import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  gitBlobSha, verifyInvocation, verifyPinnedGuestSource, verifyGuestResult
} from "./run-mutable-state-container-guest-v1.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/state_regions/mutable-state-container-guest-v1.json", import.meta.url),
  "utf8",
));
const negatives = JSON.parse(readFileSync(
  new URL("../contracts/state_regions/critical-state-guest-fixtures-v1.json", import.meta.url),
  "utf8",
));

test("mutable-state Oreslang guest is pinned by immutable commit and blob", () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.source.repository, "ores-truffle-oreslang/oreslang-source.java");
  assert.match(contract.source.commit, /^[a-f0-9]{40}$/);
  assert.match(contract.source.gitBlob, /^[a-f0-9]{40}$/);
  assert.equal(contract.source.path,
    "src/test/resources/parity/actor-critical-modes/mutable_state_write_then_read.ores");
  assert.equal(contract.expected.kind, "compile-and-run");
  assert.equal(contract.expected.exitCode, 0);
  assert.equal(contract.expected.stdout, "mutable-state-container-ok");
  assert.ok(contract.expected.semantics.includes("write-loan-in-place-twice"));
  assert.deepEqual(Object.keys(contract.backendEvidence).sort(),
    ["java", "llvm", "wasm", "cranelift", "forge", "net"].sort());
  for (const state of Object.values(contract.backendEvidence)) {
    assert.equal(state, "not-executed",
      "a source registry is never evidence that a compiler actually ran");
  }
  assert.equal(contract.negativeFixtureRegistry,
    "critical-state-guest-fixtures-v1.json");
  const fixtureIds = new Set(negatives.fixtures
    .filter(f => f.expected === "compile-reject").map(f => f.id));
  assert.equal(contract.requiredNegativeIds.length, 8);
  for (const id of contract.requiredNegativeIds) {
    assert.ok(fixtureIds.has(id), "missing compiler negative: " + id);
  }
});

test("Git blob hashing and stale-source rejection happen before process execution", () => {
  // Git's documented "blob <len>\0<bytes>" digest for hello followed by LF.
  assert.equal(gitBlobSha(Buffer.from("hello\n")),
    "ce013625030ba8dba906f756967f9e9ca394464a");
  const dir = mkdtempSync(join(tmpdir(), "ores-state-guest-"));
  try {
    const path = join(dir, "stale.ores");
    writeFileSync(path, "not the private pinned Oreslang fixture\n");
    assert.throws(() => verifyPinnedGuestSource(path), /Git blob mismatch/);
    const output = spawnSync(process.execPath, [
      new URL("./run-mutable-state-container-guest-v1.mjs", import.meta.url).pathname,
      "java", path, process.execPath, "@SOURCE@"
    ], { encoding: "utf8" });
    assert.notEqual(output.status, 0);
    assert.match(output.stderr, /Git blob mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backend invocation must contain one concrete source position", () => {
  for (const backend of Object.keys(contract.backendEvidence)) {
    assert.doesNotThrow(() => verifyInvocation(
      backend, "/trusted/compiler-guest-driver", ["@SOURCE@"]));
    assert.throws(() => verifyInvocation(backend, "/driver", []),
      /exactly one/);
    assert.throws(() => verifyInvocation(backend, "/driver",
      ["@SOURCE@", "@SOURCE@"]), /exactly one/);
  }
  assert.throws(() => verifyInvocation("cranelift-not-registered",
    "/driver", ["@SOURCE@"]), /unknown Oreslang backend/);
  assert.throws(() => verifyInvocation("llvm", "",
    ["@SOURCE@"]), /executable or wrapper/);
});

test("compile failures, skipped execution and output impostors fail closed", () => {
  assert.doesNotThrow(() => verifyGuestResult({
    status: 0, signal: null, stdout: "mutable-state-container-ok\n",
    stderr: "", error: null
  }));
  for (const value of [
    { status: 1, stdout: "mutable-state-container-ok" },
    { status: 0, stdout: "SKIPPED: mutable-state-container-ok" },
    { status: 0, stdout: "mutable-state-container-failed" },
    { status: 0, signal: "SIGTERM", stdout: "mutable-state-container-ok" },
    { status: null, stdout: "mutable-state-container-ok" }
  ]) {
    assert.throws(() => verifyGuestResult({
      signal: null, stderr: "", error: null, ...value
    }), /compile-and-run mismatch/);
  }
});
