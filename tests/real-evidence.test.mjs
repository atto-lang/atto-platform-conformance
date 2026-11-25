import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRealCompilerReport } from "../src/real-evidence.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const good = (argv, exit_code, stdout = "", stderr = "") => ({
  argv, exit_code, stdout, stderr, timeout: false, output_truncated: false, duration_ms: 1,
});
const positive = "pub fnc main(): int {\n  return 20 + 22;\n}\n";
const negative = "pub fnc main(): int {\n  return nonexistent_symbol;\n}\n";

function fixture(backend = "llvm") {
  const compile = good(backend === "java"
    ? ["/opt/compiler", "/opt/java_probe.py", "/tmp/positive.ores"]
    : ["/opt/compiler", "/tmp/positive.ores"], 0,
    backend === "llvm" ? "define i32 @main() {" : "");
  const negativeCompile = good(backend === "java"
    ? ["/opt/compiler", "/opt/java_probe.py", "/tmp/negative.ores"]
    : ["/opt/compiler", "/tmp/negative.ores"], 1, "", "error: unknown identifier nonexistent_symbol");
  return {
    schema_version: 1, evidence_type: "real-compiler-smoke", backend,
    source_commit_declared: "a".repeat(40), source_commit_binary_link_attested: false,
    runner_sha: "a".repeat(40), actual_git_checkout_sha: "a".repeat(40), compiler_path: "/opt/compiler",
    process_invoker_sha256: "a".repeat(64),
    compiler_artifact_sha256: backend === "java" ? "b".repeat(64) : "a".repeat(64),
    compiler_artifact_kind: backend === "java" ? "java-launcher-class-only" : "llvm-native-executable",
    compiler_verification: "real-process-observation-only",
    java_probe_path: "/opt/java_probe.py", clang_path: "/usr/bin/clang",
    launcher_class_sha256: "b".repeat(64), maven_classpath_sha256: "c".repeat(64),
    java_probe_sha256: "d".repeat(64), clang_sha256: "e".repeat(64),
    cases: [
      { id: "positive", source_sha256: digest(positive), compile,
        llvm_ir_sha256: digest(compile.stdout), linked_native_sha256: "f".repeat(64),
        post_execution_native_sha256: "f".repeat(64), link: good(["/usr/bin/clang", "-x", "ir", "/tmp/app.ll", "-o", "/tmp/app"], 0),
        execution: good(backend === "java"
          ? ["/opt/compiler", "/opt/java_probe.py", "/tmp/positive.ores", "--execute"]
          : ["/tmp/app"], 42), passed: true },
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
test("malformed compiler case structures fail closed with controlled errors", () => {
  const badCases = [
    [null, {}],
    [{}, null],
    [[], {}],
    [{}, []],
    ["positive", {}],
    [true, {}],
    [{ id: "positive" }, { id: "negative" }],
  ];
  for (const backend of ["llvm", "java"]) {
    for (const cases of badCases) {
      const r = fixture(backend);
      r.cases = cases;
      assert.throws(() => validateRealCompilerReport(r),
        /untrusted compiler evidence:/);
    }
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
    [1, "disk failure"], [1, "error: disk full\nsource text: nonexistent_symbol"],
    [1, "nonexistent_symbol\nunrelated error: disk full"],
    [1, "Traceback: error nonexistent_symbol"]]) {
    const r = fixture(); r.cases[1].compile.exit_code = exitCode;
    r.cases[1].compile.stderr = text;
    assert.throws(() => validateRealCompilerReport(r));
  }
});
test("reject command-to-source and linker-to-executable mismatches", () => {
  const attacks = [
    r => r.cases[0].compile.argv[0] = "/tmp/other-compiler",
    r => { r.cases[1].compile.argv[r.cases[1].compile.argv.length - 1] = "/tmp/positive.ores"; },
    r => r.cases[0].link.argv[5] = "/tmp/wrong-binary",
    r => { r.cases[1].compile.argv[1] = "/other/negative.ores"; },
    r => { r.cases[0].link.argv[3] = "/other/app.ll"; },
    r => r.cases[0].link.argv[2] = "c",
  ];
  for (const attack of attacks) {
    const r = fixture("llvm");
    attack(r);
    assert.throws(() => validateRealCompilerReport(r));
  }
  const java = fixture("java");
  java.cases[0].execution.argv[3] = "--check";
  assert.throws(() => validateRealCompilerReport(java));
});

test("report may not substitute an unrecorded linker or probe binary", () => {
  const llvm = fixture("llvm");
  llvm.clang_path = "/usr/local/bin/fake-clang";
  assert.throws(() => validateRealCompilerReport(llvm), /Clang identity/);
  const java = fixture("java");
  java.java_probe_path = "/opt/other.py";
  assert.throws(() => validateRealCompilerReport(java), /Java probe identity/);
});

test("reject missing provenance, changed fixture, timeout, false success or invalid IR", () => {
  for (const mutation of [
    r => r.source_commit_binary_link_attested = true,
    r => r.compiler_artifact_sha256 = "f".repeat(64),
    r => r.runner_sha = "f".repeat(40),
    r => r.actual_git_checkout_sha = "f".repeat(40),
    r => { delete r.actual_git_checkout_sha; },
    r => r.cases[0].source_sha256 = "0".repeat(64),
    r => r.cases[0].compile.timeout = true,
    r => r.cases[0].execution.exit_code = 0,
    r => r.ok = false,
    r => r.cases[0].compile.stdout = "not real LLVM",
    r => r.cases[0].llvm_ir_sha256 = "0".repeat(64),
    r => r.cases[0].linked_native_sha256 = "0".repeat(64),
    r => r.cases[0].post_execution_native_sha256 = "0".repeat(64),
    r => { delete r.cases[0].linked_native_sha256; },
  ]) {
    const r = fixture(); mutation(r);
    assert.throws(() => validateRealCompilerReport(r));
  }
});

test("report CLI processes bounded files without granting provenance", () => {
  const dir = mkdtempSync(join(tmpdir(), "ores-real-evidence-test-"));
  const cli = new URL("../bin/inspect-real-evidence.mjs", import.meta.url).pathname;
  try {
    const valid = join(dir, "valid.json");
    writeFileSync(valid, JSON.stringify(fixture()));
    const passed = spawnSync(process.execPath, [cli, valid], {encoding: "utf8"});
    assert.equal(passed.status, 0, passed.stderr);
    const data = JSON.parse(passed.stdout);
    assert.equal(data.authenticity_attested, false);
    assert.equal(data.publicly_promotable, false);

    const oversized = join(dir, "large.json");
    writeFileSync(oversized, " ".repeat(256 * 1024 + 1));
    const blocked = spawnSync(process.execPath, [cli, oversized], {encoding: "utf8"});
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /256 KiB/);

    if (process.platform === "linux") {
      const fifo = join(dir, "blocked-pipe.json");
      const created = spawnSync("mkfifo", [fifo], {encoding: "utf8", timeout: 2000});
      assert.equal(created.status, 0, created.stderr);
      const blockedPipe = spawnSync(process.execPath, [cli, fifo], {
        encoding: "utf8", timeout: 2000,
      });
      assert.equal(blockedPipe.status, 1, "FIFO must fail, not hang waiting for a writer");
      assert.match(blockedPipe.stderr, /regular file/);
    }

    if (process.platform !== "win32") {
      const alias = join(dir, "alias.json");
      symlinkSync(valid, alias);
      const symlinked = spawnSync(process.execPath, [cli, alias], {encoding: "utf8"});
      assert.equal(symlinked.status, 1);
    }
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});


test("positive compile, link and runtime must not report errors with success-like exit codes", () => {
  for (const backend of ["java", "llvm"]) {
    for (const phase of ["compile", "execution", ...(backend === "llvm" ? ["link"] : [])]) {
      const r = fixture(backend);
      r.cases[0][phase].stderr = "src/main.ores:2: error: unknown identifier other_symbol";
      assert.throws(() => validateRealCompilerReport(r),
        /untrusted compiler evidence:/, backend + " " + phase);
    }
  }
});

test("negative evidence rejects echoed source, filenames and secondary-hint spoofing", () => {
  const attacks = [
    "error: unresolved identifier other_symbol; hint: nonexistent_symbol undefined",
    "/work/nonexistent_symbol.ores:2: error: unresolved identifier other_symbol",
    "error: failed reading nonexistent_symbol.ores",
    "error: cannot find name another_symbol; maybe nonexistent_symbol?",
    "warning: unknown identifier nonexistent_symbol",
    "error: inaccessible source; return nonexistent_symbol;",
    "error: unknown symbol other_symbol\\nsource: nonexistent_symbol"
  ];
  for (const backend of ["java", "llvm"]) {
    for (const spoof of attacks) {
      const r = fixture(backend);
      r.cases[1].compile.stderr = spoof;
      assert.throws(() => validateRealCompilerReport(r),
        /negative source not rejected/, backend + ": " + spoof);
    }
  }
});

test("primary compiler rejection still validates on both real-report backends", () => {
  for (const backend of ["java", "llvm"]) {
    for (const diagnostic of [
      "error: unknown identifier nonexistent_symbol",
      "src/main.ores:2:7: error: use of undeclared identifier 'nonexistent_symbol'",
      "error[E0425]: cannot find name nonexistent_symbol"
    ]) {
      const r = fixture(backend);
      r.cases[1].compile.stderr = diagnostic;
      assert.equal(validateRealCompilerReport(r).consistency_valid, true);
    }
  }
});


test("real-report positive phases reject indented or fatal errors on zero exit", () => {
  for (const backend of ["java", "llvm"]) {
    for (const stderr of [
      "  error: unresolved identifier other_symbol",
      "fatal error: failed to initialize compiler",
      "src/main.ores:4:9: fatal error: malformed input"
    ]) {
      const r = fixture(backend);
      r.cases[0].compile.stderr = stderr;
      assert.throws(() => validateRealCompilerReport(r),
        /positive source was not accepted/, backend + ": " + stderr);
    }
  }
});
