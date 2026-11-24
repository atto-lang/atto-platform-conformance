import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [checkout, dotnet = "dotnet"] = process.argv.slice(2);
if (!checkout || process.argv.length > 4) {
  throw new Error("Usage: node bin/verify-verified-core-quantities-net.mjs <atto-source.net checkout> [dotnet]");
}
const root = resolve(checkout);
const fixtures = fileURLToPath(new URL("../fixtures/verified-core-quantities-v1/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(fixtures, "cases.json"), "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.profile, "verified-core-quantities-v1");
const work = mkdtempSync(join(tmpdir(), "atto-quantities-net-"));
const assembly = join(work, "OresGenerated.dll");
const host = join(work, "host");
const compiler = join(root, "compiler/Ores.Net.Compiler/bin/Release/net10.0/oresnet.dll");
const buildOptions = ["-c", "Release", "-p:PublishAot=false", "-p:PublishTrimmed=false", "-p:SelfContained=false"];

function run(args) {
  const result = spawnSync(dotnet, args, { cwd: root, encoding: "utf8", timeout: 180_000 });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`dotnet terminated by ${result.signal}: ${args.join(" ")}`);
  return result;
}

function successfulBuild(args) {
  const result = run(args);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

const arithmeticErrors = {
  divisionByZero: "Oreslang division by zero",
  integerOverflow: "Oreslang arithmetic overflow",
};

try {
  successfulBuild(["build", "compiler/Ores.Net.Compiler/Ores.Net.Compiler.csproj", ...buildOptions]);
  let hostBuilt = false;
  for (const { source, expected } of manifest.cases) {
    assert.match(source, /^[a-z0-9-]+\.atto$/);
    rmSync(assembly, { force: true });
    const compiled = run([compiler, "compile", join(fixtures, source), "--out", assembly]);
    if (expected.kind === "diagnostic") {
      assert.notEqual(compiled.status, 0, source);
      assert.ok(compiled.stderr.includes(expected.category + ":"), source + ": " + compiled.stderr);
      assert.equal(existsSync(assembly), false, source + " emitted a rejected assembly");
    } else {
      assert.equal(compiled.status, 0, source + ": " + compiled.stderr);
      assert.ok(statSync(assembly).size > 0, source);
      if (!hostBuilt) {
        successfulBuild(["build", "host/Ores.Net.NativeHost/Ores.Net.NativeHost.csproj", ...buildOptions,
          `-p:GeneratedAssembly=${assembly}`, "-o", host]);
        hostBuilt = true;
      }
      copyFileSync(assembly, join(host, "OresGenerated.dll"));
      const guest = run([join(host, "oreslang-app.dll")]);
      if (expected.kind === "arithmeticFailure") {
        assert.equal(guest.status, 70, source + ": " + guest.stderr);
        assert.equal(guest.stderr.trim(), arithmeticErrors[expected.category], source);
        assert.equal(guest.stdout, "", source);
      } else {
        assert.equal(expected.kind, "value", source);
        assert.equal(guest.status, 0, source + ": " + guest.stderr);
        assert.equal(guest.stdout.trim(), expected.decimal, source);
      }
    }
    console.log(`PASS ${source} ${expected.kind}`);
  }
  console.log(`verified ${manifest.cases.length} cases through the .NET source compiler and CoreCLR CIL guest`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
