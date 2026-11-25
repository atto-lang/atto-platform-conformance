import test from "node:test";
import assert from "node:assert/strict";
import { readFile, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_CASES, UNIMPLEMENTED_GATES, validateCaseInventory,
  gitBlobHash, verifyFixtureBlob, validateInvocation, compilerArtifactPaths, classifyCompilerResult, promoteCaseOutcome,
  runSourceAdmission } from "../src/actor-ownership-source-gate-v1.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checksum = "a".repeat(40);

test("inventory is unique, bounded, classified, and never promises all AO/OW proofs", () => {
  assert.equal(validateCaseInventory(), true);
  assert.equal(SOURCE_CASES.length, 9);
  assert.deepEqual(SOURCE_CASES.filter(c => c.candidate === true).map(c => c.id),
    ["OW01_MOVE_AFTER_TAKE", "OW02_ALIAS_MUTABLE"]);
  assert.ok(UNIMPLEMENTED_GATES.includes("AO01_PHYSICAL_PARALLELISM"));
  assert.ok(UNIMPLEMENTED_GATES.includes("AO04_DISTINCT_PHYSICAL_HEAPS"));
  assert.ok(UNIMPLEMENTED_GATES.includes("OW05_REGION_GENERATION_FENCE"));
  assert.throws(() => validateCaseInventory([SOURCE_CASES[0], SOURCE_CASES[0]]), /invalid/);
  assert.throws(() => validateCaseInventory([{ ...SOURCE_CASES[0], file: "../bypass.ores" }]), /invalid/);
});

test("every .ores fixture is a real regular source file and canonical upstream blobs remain equal", async () => {
  for (const c of SOURCE_CASES) {
    const file = join(root, "fixtures", "actor-ownership-v1", c.file);
    const st = await lstat(file);
    assert.ok(st.isFile(), c.id);
    assert.equal(st.nlink, 1, c.id);
    const bytes = await readFile(file);
    assert.ok(bytes.length > 50 && bytes.length < 64 * 1024, c.id);
    assert.equal(gitBlobHash(bytes), c.expectedBlob || c.originBlob, c.id);
    assert.match(bytes.toString("utf8"), /\b(?:fnc|actor)\b/, c.id);
  }
});

test("unconfigured Java and LLVM are never reported as compiler or guest passes", async () => {
  for (const backend of ["java", "llvm"]) {
    const r = await runSourceAdmission({ backend });
    assert.equal(r.ok, false);
    assert.equal(r.verificationScope, "NOT_EXECUTED");
    assert.equal(r.guestExecuted, false);
    assert.equal(r.runtimeTraceVerified, false);
    assert.equal(r.physicalIsolationVerified, false);
    assert.ok(r.results.length > 0);
    assert.ok(r.results.every(x => x.status === "UNCONFIGURED"));
    assert.equal(r.results.filter(x => x.status === "SOURCE_ACCEPTED").length, 0);
  }
});

test("compiler invocation requires exact source SHA and absolute executable, no shell interpolation", () => {
  assert.doesNotThrow(() => validateInvocation(["/tmp/compiler", "--check", "{file}"], checksum));
  for (const argv of [
    ["compiler", "{file}"], ["/tmp/compiler", "prefix{file}"],
    ["/tmp/compiler", "{file}", "{file}"], ["/tmp/compiler", "whatever"],
    ["/tmp/compiler", "ok\0bad", "{file}"]
  ]) assert.throws(() => validateInvocation(argv, checksum));
  assert.throws(() => validateInvocation(["/tmp/compiler", "{file}"], "fake"));
});

test("semantic negative requires exit one and matching primary error, never a crash or source echo", () => {
  const c = SOURCE_CASES.find(x => x.id === "OW03_NESTED_RETURN");
  const yes = { status: 1, stdout: "", stderr: "error: cannot return a nested borrowed reference" };
  assert.equal(classifyCompilerResult(c, yes), "SOURCE_REJECTED_AS_EXPECTED");
  assert.equal(classifyCompilerResult(c, { ...yes, status: 0 }), "UNEXPECTED_COMPILER_RESULT");
  assert.equal(classifyCompilerResult(c, { ...yes, status: 2 }), "UNEXPECTED_COMPILER_RESULT");
  assert.equal(classifyCompilerResult(c, { ...yes, stderr: "note: error: cannot return a nested borrowed reference" }), "UNEXPECTED_COMPILER_RESULT");
  assert.equal(classifyCompilerResult(c, { ...yes, stderr: "error: unresolved identifier" }), "DIAGNOSTIC_MISMATCH");
  assert.equal(classifyCompilerResult(c, { ...yes, stderr: "panic: compiler crashed\nerror: cannot return a nested borrowed reference" }), "COMPILER_CRASH");
  assert.equal(classifyCompilerResult(c, { ...yes, signal: "SIGSEGV" }), "EXECUTION_FAILED");
  assert.equal(classifyCompilerResult(c, { status: 1, stdout: "error: cannot return a nested borrowed reference", stderr: "" }),
    "UNEXPECTED_COMPILER_RESULT", "stdout source echoes cannot impersonate compiler diagnostics");
});

test("successful source admission does not imply compiled guest operation or a trace", () => {
  const c = SOURCE_CASES.find(x => x.id === "AO01_SOURCE_ORDER");
  assert.equal(classifyCompilerResult(c, { status: 0, stdout: "PASS 43", stderr: "" }), "SOURCE_ACCEPTED");
  assert.equal(classifyCompilerResult(c, { status: 0, stdout: "error: invalid actor", stderr: "" }), "UNEXPECTED_COMPILER_RESULT");
  assert.equal(classifyCompilerResult(c, { status: 1, stdout: "", stderr: "error: failed to compile" }), "UNEXPECTED_COMPILER_RESULT");
});


test("unratified ownership-negative cases are never promoted from their matching diagnostics", () => {
  const a = SOURCE_CASES.find(c => c.id === "OW01_MOVE_AFTER_TAKE");
  const b = SOURCE_CASES.find(c => c.id === "OW02_ALIAS_MUTABLE");
  for (const c of [a, b]) {
    assert.equal(promoteCaseOutcome(c, "SOURCE_REJECTED_AS_EXPECTED"), "CANDIDATE_UNRATIFIED");
    assert.equal(promoteCaseOutcome(c, "DIAGNOSTIC_MISMATCH"), "DIAGNOSTIC_MISMATCH");
  }
  const established = SOURCE_CASES.find(c => c.id === "OW03_NESTED_RETURN");
  assert.equal(promoteCaseOutcome(established, "SOURCE_REJECTED_AS_EXPECTED"), "SOURCE_REJECTED_AS_EXPECTED");
  assert.throws(() => validateCaseInventory([{ ...established, candidate: true, expect: "accept" }]), /invalid/);
});


test("Java -jar compiler payload and Node entrypoint are pinned; unpinned classpaths fail closed", () => {
  assert.deepEqual(compilerArtifactPaths(["/usr/bin/java", "-jar", "/opt/ores/compiler.jar", "{file}"]),
    ["/opt/ores/compiler.jar"]);
  assert.deepEqual(compilerArtifactPaths(["/usr/bin/node", "/opt/ores/oresc.mjs", "{file}"]),
    ["/opt/ores/oresc.mjs"]);
  assert.deepEqual(compilerArtifactPaths(["/opt/ores/oresc", "{file}"], ["/opt/ores/runtime.dat"]),
    ["/opt/ores/runtime.dat"]);
  for (const bad of [
    ["/usr/bin/java", "-jar", "../private.jar", "{file}"],
    ["/usr/bin/java", "-cp", "a:b", "dev.ores.Main", "{file}"],
    ["/usr/bin/java", "--module-path", "mods", "dev.ores.Main", "{file}"],
    ["/usr/bin/node", "relative-script.mjs", "{file}"],
    ["/usr/bin/node", "--no-warnings", "/opt/compiler.mjs", "{file}"]
  ]) assert.throws(() => compilerArtifactPaths(bad), /artifact|classpath|compiler/);
  assert.throws(() => compilerArtifactPaths(["/opt/ores/oresc", "{file}"], ["/tmp/x", "/tmp/x"]), /unique/);
});

test("every source negative is pinned to a canonical Git blob, not just upstream-origin cases", () => {
  assert.equal(SOURCE_CASES.filter(x => x.expectedBlob || x.originBlob).length, 9);
  for (const c of SOURCE_CASES) assert.match(c.expectedBlob || c.originBlob, /^[a-f0-9]{40}$/);
  assert.throws(() => validateCaseInventory([{ ...SOURCE_CASES[3], expectedBlob: undefined, originBlob: undefined }]), /invalid/);
  assert.throws(() => validateCaseInventory([{ ...SOURCE_CASES[3], expectedBlob: "abc" }]), /invalid/);
});

test("compiler receipts explicitly refuse provenance and certification claims", async () => {
  for (const backend of ["java", "llvm"]) {
    const result = await runSourceAdmission({ backend });
    assert.equal(result.certificationEligible, false);
    assert.equal(result.provenanceVerified, false);
    assert.equal(result.guestExecuted, false);
  }
});

test("mutated bytes of each of the nine fixtures reject source identity before compilation", async () => {
  for (const c of SOURCE_CASES) {
    const source = await readFile(join(root, "fixtures", "actor-ownership-v1", c.file));
    assert.equal(verifyFixtureBlob(c, source), gitBlobHash(source));
    const mutated = Buffer.concat([source, Buffer.from("\n// unreviewed injection\n")]);
    assert.throws(() => verifyFixtureBlob(c, mutated), /fixture source identity mismatch/, c.id);
    assert.throws(() => verifyFixtureBlob(c, source.toString("utf8")), /binary bytes/, c.id);
  }
});
