import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [checkout, dotnet = "dotnet"] = process.argv.slice(2);
if (!checkout || process.argv.length > 4) {
  throw new Error("Usage: node bin/verify-verified-core-quantities-net.mjs <atto-source.net checkout> [dotnet]");
}
const root = resolve(checkout);
const fixtureProfile = process.env.ATTO_VERIFIED_CORE_PROFILE ?? "verified-core-quantities-v1";
assert.ok(["verified-core-quantities-v1", "verified-core-refinements-v1"].includes(fixtureProfile));
const fixtures = fileURLToPath(new URL(`../fixtures/${fixtureProfile}/`, import.meta.url));
const manifest = JSON.parse(readFileSync(join(fixtures, "cases.json"), "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.profile, fixtureProfile);
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

let probeDll;
function requirePrivateHelpers(names, source) {
  if (!probeDll) {
    const probe = join(work, "abi-probe");
    mkdirSync(probe);
    const project = join(probe, "Probe.csproj");
    writeFileSync(project, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
    writeFileSync(join(probe, "Program.cs"), `
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

using var stream = File.OpenRead(args[0]);
using var pe = new PEReader(stream);
var reader = pe.GetMetadataReader();
var required = new HashSet<string>(StringComparer.Ordinal);
foreach (var name in args[1..]) required.Add("helper_" + name);
int publicEntries = 0;
foreach (var handle in reader.MethodDefinitions)
{
    var method = reader.GetMethodDefinition(handle);
    string name = reader.GetString(method.Name);
    var access = method.Attributes & MethodAttributes.MemberAccessMask;
    if (name == "Run" && access == MethodAttributes.Public) publicEntries++;
    else if (access != MethodAttributes.Private || !required.Remove(name))
        throw new InvalidOperationException("Unexpected emitted method or access: " + name + " " + access);
}
if (publicEntries != 1 || required.Count != 0)
    throw new InvalidOperationException("Incorrect verified entry/helper set");
`);
    const output = join(probe, "out");
    successfulBuild(["build", project, "-c", "Release", "-o", output]);
    probeDll = join(output, "Probe.dll");
  }
  const result = run([probeDll, assembly, ...names]);
  assert.equal(result.status, 0, source + ": " + result.stderr);
}

const arithmeticErrors = {
  divisionByZero: "Oreslang division by zero",
  integerOverflow: "Oreslang arithmetic overflow",
  i32Overflow: "Oreslang arithmetic overflow",
};

try {
  successfulBuild(["build", "compiler/Ores.Net.Compiler/Ores.Net.Compiler.csproj", ...buildOptions]);
  let hostBuilt = false;
  for (const { source, expected, privateHelpers = [] } of manifest.cases) {
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
      if (privateHelpers.length !== 0) requirePrivateHelpers(privateHelpers, source);
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
