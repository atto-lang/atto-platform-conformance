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

const fixtureProfile = process.env.ATTO_VERIFIED_CORE_PROFILE ?? "verified-core-quantities-v1";
assert.ok([
  "verified-core-quantities-v1",
  "verified-core-refinements-v1",
  "verified-core-protocol-declarations-v1",
].includes(fixtureProfile));
const fixtures = fileURLToPath(new URL(`../fixtures/${fixtureProfile}/`, import.meta.url));
const { schemaVersion, profile, cases } = JSON.parse(readFileSync(join(fixtures, "cases.json"), "utf8"));
assert.equal(schemaVersion, 1);
assert.equal(profile, fixtureProfile);
const work = mkdtempSync(join(tmpdir(), "atto-quantities-native-"));

const javaRuntimeErrors = {
  divisionByZero: "E_I64_DIV_ZERO",
  integerOverflow: "E_I64_OVERFLOW",
  i32Overflow: "E_I32_OVERFLOW",
  refinementViolation: "E_REFINEMENT_CHECK_FAILED",
};

const llvmFailureGuards = {
  divisionByZero: "quantity.div.zero:",
  integerOverflow: "quantity.div.overflow:",
  i32Overflow: "i32.range.invalid:",
  refinementViolation: "refinement.bounds.invalid:",
};

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
  for (const { source, expected, privateHelpers = [] } of cases) {
    assert.match(source, /^[a-z0-9-]+\.atto$/);
    const fixture = join(fixtures, source);
    const check = run(java, [...launcher, "--check", fixture], checkout);
    if (expected.kind === "diagnostic") {
      assert.equal(check.signal, null, source);
      assert.notEqual(check.status, 0, source);
      assert.ok(check.stderr.includes(expected.category + ":"), source + ": " + check.stderr);
    } else {
      requireSuccess(check, source + " check");
      if (privateHelpers.length !== 0) {
        writeFileSync(join(work, source), readFileSync(fixture));
        for (const name of privateHelpers) {
          assert.match(name, /^[a-z_][a-z0-9_]*$/);
          const importer = join(work, "private-import.atto");
          writeFileSync(importer, `import fnc ${name} from "${source}";\npub fnc main() -> int { return ${name}(0); }\n`);
          const rejected = run(java, [...launcher, "--check", importer], checkout);
          assert.equal(rejected.signal, null, source);
          assert.notEqual(rejected.status, 0, source + " exposes " + name);
          assert.match(rejected.stderr, /does not match an exported declaration/, source + " " + name);
        }
      }
      const guest = run(java, [...launcher, fixture], checkout);
      assert.equal(guest.signal, null, source);
      if (expected.kind === "arithmeticFailure" || expected.kind === "refinementFailure") {
        const error = javaRuntimeErrors[expected.category];
        assert.ok(error, source + " has an unknown runtime failure category");
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
  for (const { source, expected, privateHelpers = [] } of cases) {
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
      for (const name of privateHelpers) {
        assert.match(name, /^[a-z_][a-z0-9_]*$/);
        assert.ok(result.stdout.includes(`define internal i64 @"$verified$${name}"(`),
          `${source} exposes LLVM helper ${name}`);
      }
      const ir = join(work, source + ".ll");
      const executable = join(work, source + ".guest");
      writeFileSync(ir, result.stdout);
      requireSuccess(run(clang, [ir, "-o", executable]), source + " native link");
      const guest = run(executable, []);
      if (expected.kind === "arithmeticFailure" || expected.kind === "refinementFailure") {
        // The native scalar ABI reports checked value failures as traps.
        const guard = llvmFailureGuards[expected.category];
        assert.ok(guard, source + " has an unknown runtime failure category");
        assert.ok(result.stdout.includes(guard), source + " lacks its runtime guard");
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
