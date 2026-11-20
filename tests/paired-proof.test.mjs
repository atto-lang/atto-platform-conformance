import test from "node:test";
import assert from "node:assert/strict";
import {verifyPairedSourceChecks} from "../src/paired-proof.mjs";

const sha40 = "a".repeat(40);
const fixture = "c".repeat(64);
function run(backend) {
  return {
    backend,
    configured: true,
    ok: true,
    failed: 0,
    skipped: 0,
    verified: 2,
    declaredSourceSha: sha40,
    executableSha256: "b".repeat(64),
    results: [
      {id: "int-arithmetic", status: "VERIFIED", fixtureSha256: fixture},
      {id: "unresolved-identifier", status: "VERIFIED", fixtureSha256: "d".repeat(64)},
    ],
  };
}

function verifyOfficial(javaRun, llvmRun) {
  const official = [
    {id: "int-arithmetic", fixtureSha256: fixture},
    {id: "unresolved-identifier", fixtureSha256: "d".repeat(64)},
  ];
  return verifyPairedSourceChecks(javaRun, llvmRun, official);
}

test("paired gate records only exact-source compiler admission, not runtime parity", () => {
  const value = verifyOfficial(run("java"), run("llvm"));
  assert.equal(value.status, "PAIRED_SOURCE_CHECKS_PASS");
  assert.equal(value.cases, 2);
  assert.equal(value.certifiesRuntimeParity, false);
  assert.equal(value.certifiesCompilerBuildProvenance, false);
});

test("reject missing compiler and false positive zero-test suites", () => {
  const llvm = run("llvm");
  llvm.configured = false;
  assert.throws(() => verifyOfficial(run("java"), llvm));
  llvm.configured = true;
  llvm.results = [];
  llvm.verified = 0;
  assert.throws(() => verifyOfficial(run("java"), llvm));
});

test("reject stale or partial fixture provenance", () => {
  const llvm = run("llvm");
  llvm.results[0].fixtureSha256 = "e".repeat(64);
  assert.throws(() => verifyOfficial(run("java"), llvm), /mismatch/);
  llvm.results[0].fixtureSha256 = fixture;
  llvm.results[0].status = "UNCONFIGURED";
  assert.throws(() => verifyOfficial(run("java"), llvm));
  llvm.results[0].status = "VERIFIED";
  llvm.declaredSourceSha = "uncommitted";
  assert.throws(() => verifyOfficial(run("java"), llvm));
});

test("reject duplicate IDs, fixture count drift and executable digest omission", () => {
  const llvm = run("llvm");
  llvm.results[1].id = llvm.results[0].id;
  assert.throws(() => verifyOfficial(run("java"), llvm));
  llvm.results[1].id = "unresolved-identifier";
  llvm.results.pop();
  llvm.verified = 1;
  assert.throws(() => verifyOfficial(run("java"), llvm), /exact-head|different fixture sets/);
  llvm.results = run("llvm").results;
  llvm.verified = 2;
  llvm.executableSha256 = null;
  assert.throws(() => verifyOfficial(run("java"), llvm));
});

test("reject mutually incomplete but otherwise matching compiler reports", () => {
  const java = run("java");
  const llvm = run("llvm");
  java.results.pop();
  llvm.results.pop();
  java.verified = 1;
  llvm.verified = 1;
  assert.throws(() => verifyOfficial(java, llvm), /exact-head/);
});

test("reject skipped fixtures and unpinned expected fixture sets", () => {
  const java = run("java");
  const llvm = run("llvm");
  java.skipped = 1;
  assert.throws(() => verifyOfficial(java, llvm), /exact-head/);
  java.skipped = 0;
  assert.throws(() => verifyPairedSourceChecks(java, llvm, []), /manifest/);
  assert.throws(() => verifyPairedSourceChecks(java, llvm, [
    {id: "int-arithmetic", fixtureSha256: fixture},
    {id: "int-arithmetic", fixtureSha256: fixture},
  ]), /duplicate/);
});
