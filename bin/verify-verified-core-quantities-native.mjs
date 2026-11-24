import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [backend, location, ...options] = process.argv.slice(2);
if (!location || !["java", "llvm"].includes(backend)) {
  throw new Error("Usage: node bin/verify-verified-core-quantities-native.mjs java <checkout> [java] [mvn] | llvm <compiler> [clang]");
}

const fixtures = fileURLToPath(new URL("../fixtures/verified-core-quantities-v1/", import.meta.url));
const { schemaVersion, profile, cases } = JSON.parse(readFileSync(join(fixtures, "cases.json"), "utf8"));
assert.equal(schemaVersion, 1);
assert.equal(profile, "verified-core-quantities-v1");
const work = mkdtempSync(join(tmpdir(), "atto-quantities-native-"));

function run(command, args, cwd = work) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, reason) {
  assert.equal(result.signal, null, reason);
  assert.equal(result.status, 0, reason + ": " + result.stdout + result.stderr);
}

function checkJava() {
  const [java = "java", mvn = "mvn"] = options;
  const checkout = resolve(location);
  const dependencyFile = join(work, "classpath");
  const build = run(mvn, ["-q", "-DskipTests", "compile", "dependency:build-classpath",
    `-Dmdep.outputFile=${dependencyFile}`], checkout);
  requireSuccess(build, "Java compiler build");
  const classpath = join(checkout, "target/classes") + delimiter + readFileSync(dependencyFile, "utf8").trim();
  const launcher = ["--enable-native-access=ALL-UNNAMED", "-Dpolyglot.engine.WarnInterpreterOnly=false",
    "-cp", classpath, "dev.oreslang.launcher.OresMain"];
  for (const { source, expected } of cases) {
    assert.match(source, /^[a-z0-9-]+\.atto$/);
    const fixture = join(fixtures, source);
    const check = run(java, [...launcher, "--check", fixture], checkout);
    if (expected.kind === "diagnostic") {
      assert.equal(check.signal, null, source);
      assert.notEqual(check.status, 0, source);
      assert.ok(check.stderr.includes(expected.category + ":"), source + ": " + check.stderr);
    } else {
      requireSuccess(check, source + " check");
      const guest = run(java, [...launcher, fixture], checkout);
      assert.equal(guest.signal, null, source);
      if (expected.kind === "arithmeticFailure") {
        const error = expected.category === "divisionByZero" ? "E_I64_DIV_ZERO" : "E_I64_OVERFLOW";
        assert.notEqual(guest.status, 0, source);
        assert.ok(guest.stderr.includes(error + ":"), source + ": " + guest.stderr);
      } else {
        assert.equal(expected.kind, "value", source);
        assert.equal(guest.status, Number(expected.decimal), source + ": " + guest.stderr);
      }
    }
    console.log(`PASS java ${source} ${expected.kind}`);
  }
}

function checkLlvm() {
  const [clang = "clang"] = options;
  const compiler = resolve(location);
  for (const { source, expected } of cases) {
    assert.match(source, /^[a-z0-9-]+\.atto$/);
    const result = run(compiler, ["--target=host", join(fixtures, source)]);
    if (expected.kind === "diagnostic") {
      assert.equal(result.signal, null, source);
      assert.notEqual(result.status, 0, source);
      assert.ok(result.stderr.includes(expected.category + ":"), source + ": " + result.stderr);
      assert.equal(result.stdout, "", source + " emitted IR for rejected source");
    } else {
      requireSuccess(result, source + " compilation");
      assert.match(result.stdout, /define .*@main\(/, source);
      const ir = join(work, source + ".ll");
      const executable = join(work, source + ".guest");
      writeFileSync(ir, result.stdout);
      requireSuccess(run(clang, [ir, "-o", executable]), source + " native link");
      const guest = run(executable, []);
      if (expected.kind === "arithmeticFailure") {
        // The native scalar ABI reports both arithmetic failures as a trap.
        // Distinguish the division guards and check real trap execution.
        const guard = expected.category === "divisionByZero" ? "quantity.div.zero:" : "quantity.div.overflow:";
        assert.ok(result.stdout.includes(guard), source + " lacks its signed division guard");
        assert.ok(["SIGILL", "SIGTRAP"].includes(guest.signal), source + ": unexpected guest result " + guest.status);
      } else {
        assert.equal(expected.kind, "value", source);
        assert.equal(guest.signal, null, source);
        assert.equal(guest.status, Number(expected.decimal), source + ": " + guest.stderr);
      }
    }
    console.log(`PASS llvm ${source} ${expected.kind}`);
  }
}

try {
  if (backend === "java") checkJava();
  else checkLlvm();
  console.log(`verified ${cases.length} cases through ${backend === "java" ? "the Java compiler and Truffle guest" : "the LLVM compiler and linked native guest"}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
