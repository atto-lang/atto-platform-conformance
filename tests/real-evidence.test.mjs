import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateRealCompilerReport } from "../src/real-evidence.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const good = (argv, exit_code, stdout = "", stderr = "") => ({
  argv, exit_code, stdout, stderr, timeout: false, output_truncated: false, duration_ms: 1,
});
const positive = "pub fnc main(): int {\n  return 20 + 22;\n}\n";
const negative = "pub fnc main(): int {\n  return nonexistent_symbol;\n}\n";

function fixture(backend = "llvm") {
  const compile = good(["/opt/compiler", "/tmp/positive.ores"], 0, backend === "llvm" ? "define i32 @main() {" : "");
  const negativeCompile = good(["/opt/compiler", "/tmp/negative.ores"], 1, "", "error: unknown identifier nonexistent_symbol");
  return {
    schema_version: 1, evidence_type: "real-compiler-smoke", backend,
    source_commit_declared: "a".repeat(40), source_commit_binary_link_attested: false,
    runner_sha: "a".repeat(40), compiler_path: "/opt/compiler",
    process_invoker_sha256: "a".repeat(64),
    compiler_artifact_sha256: backend === "java" ? "b".repeat(64) : "a".repeat(64),
    compiler_artifact_kind: backend === "java" ? "java-launcher-class-only" : "llvm-native-executable",
    compiler_verification: "real-process-observation-only",
    launcher_class_sha256: "b".repeat(64), maven_classpath_sha256: "c".repeat(64),
    java_probe_sha256: "d".repeat(64), clang_sha256: "e".repeat(64),
    cases: [
      { id: "positive", source_sha256: digest(positive), compile, link: good(["/usr/bin/clang", "a.ll"], 0),
        execution: good(["/tmp/app"], 42), passed: true },
      { id: "negative", source_sha256: digest(negative), compile: negativeCompile, passed: true },
    ],
    ok: true,
  };
}

test("real-process report is internally consistent but never promotes itself", () => {
  for (const backend of ["llvm", "java"]) {
    const result = validateRealCompilerReport(fixture(backend));
    assert.equal(result.consistency_valid, true);
    assert.equal(result.authenticity_attested, false);
    assert.equal(result.publicly_promotable, false);
  }
});
test("native runtime processes legitimately have one argv element", () => {
  const r = fixture("llvm");
  assert.deepEqual(r.cases[0].execution.argv, ["/tmp/app"]);
  assert.equal(validateRealCompilerReport(r).consistency_valid, true);
  const invalid = fixture("llvm");
  invalid.cases[0].execution.argv = [];
  assert.throws(() => validateRealCompilerReport(invalid), /argv invalid/);
});

test("rejection requires observed error diagnostics, not a crash or pretend success", () => {
  for (const [exitCode, text] of [[0, "error: nonexistent_symbol"],
    [1, "disk failure"], [1, "Traceback: error nonexistent_symbol"]]) {
    const r = fixture(); r.cases[1].compile.exit_code = exitCode;
    r.cases[1].compile.stderr = text;
    assert.throws(() => validateRealCompilerReport(r));
  }
});
test("reject missing provenance, changed fixture, timeout, false success or invalid IR", () => {
  for (const mutation of [
    r => r.source_commit_binary_link_attested = true,
    r => r.compiler_artifact_sha256 = "f".repeat(64),
    r => r.runner_sha = "f".repeat(40),
    r => r.cases[0].source_sha256 = "0".repeat(64),
    r => r.cases[0].compile.timeout = true,
    r => r.cases[0].execution.exit_code = 0,
    r => r.ok = false,
    r => r.cases[0].compile.stdout = "not real LLVM",
  ]) {
    const r = fixture(); mutation(r);
    assert.throws(() => validateRealCompilerReport(r));
  }
});
