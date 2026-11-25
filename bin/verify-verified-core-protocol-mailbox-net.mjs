import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReferenceFrames } from "../lib/verified-core-protocol-mailbox.mjs";

const [checkout, dotnet, rid, common] = process.argv.slice(2);
if (!checkout || !dotnet || !rid || !common || process.argv.length !== 6) {
  throw new Error("Usage: node bin/verify-verified-core-protocol-mailbox-net.mjs <atto-source.net checkout> <dotnet> <AOT runtime identifier> <atto-common-source checkout>");
}
const root = resolve(checkout);
const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const bindings = join(fixtures, "verified-core-protocol-handlers-v1");
const mailbox = join(fixtures, "verified-core-protocol-mailbox-net-v1");
const work = mkdtempSync(join(tmpdir(), "atto-protocol-mailbox-net-"));
const compiler = join(root, "compiler/Ores.Net.Compiler/bin/Release/net10.0/oresnet.dll");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8",
    timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function successful(command, args) {
  const result = run(command, args);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");
function emit(source, output) {
  successful(dotnet, [compiler, "emit-actor-csharp", source, "--out", output]);
  return readFileSync(output, "utf8");
}

try {
  successful(dotnet, ["build", "compiler/Ores.Net.Compiler/Ores.Net.Compiler.csproj", "-c", "Release",
    "-p:PublishAot=false", "-p:PublishTrimmed=false", "-p:SelfContained=false"]);
  const connection = join(bindings, "connection-binding.atto");
  const generated = emit(connection, join(work, "Connection.g.cs"));
  assert.equal(generated, emit(connection, join(work, "Connection.second.cs")),
    "actor source emission depends on the output location");
  rmSync(join(work, "Connection.second.cs"));
  emit(join(bindings, "payment-binding.atto"), join(work, "Payment.g.cs"));
  emit(join(mailbox, "Standalone.atto"), join(work, "Standalone.g.cs"));
  const rejectedOutput = join(work, "Rejected.g.cs");
  const rejected = run(dotnet, [compiler, "emit-actor-csharp", join(bindings, "effect-before-transition.atto"),
    "--out", rejectedOutput]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /E_PROTOCOL_TRANSITION:/);
  assert.equal(existsSync(rejectedOutput), false);

  copyFileSync(join(mailbox, "Program.cs"), join(work, "Program.cs"));
  const project = join(work, "ProtocolMailbox.csproj");
  const reference = xml(join(root, "runtime/Ores.Net.Runtime/Ores.Net.Runtime.csproj"));
  writeFileSync(project, `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PublishAot>true</PublishAot>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${reference}" />
  </ItemGroup>
</Project>
`);
  const output = join(work, "native");
  successful(dotnet, ["publish", project, "-c", "Release", "-r", rid, "-o", output]);
  const executable = join(output, "ProtocolMailbox" + (rid.startsWith("win-") ? ".exe" : ""));
  assert.equal(existsSync(join(output, "ProtocolMailbox.dll")), false,
    "Publish must produce a native executable without a managed guest assembly");
  const trace = successful(executable, []).trim().split("\n");
  assert.equal(trace.length, 3);
  await checkReferenceFrames(trace, common);
  assert.equal(trace[2], "verified 20 live .NET protocol turn receipts and 24 stop races");
  console.log(trace[2]);
  const [commit, tree] = successful("git", ["rev-parse", "HEAD", "HEAD^{tree}"]).trim().split("\n");
  console.log(JSON.stringify({
    commit, tree, modified: successful("git", ["status", "--porcelain"]).length !== 0,
    rid, sdk: successful(dotnet, ["--version"]).trim(), nativeSha256: sha256(executable),
    sources: {
      connection: sha256(connection),
      payment: sha256(join(bindings, "payment-binding.atto")),
      standalone: sha256(join(mailbox, "Standalone.atto")),
      host: sha256(join(mailbox, "Program.cs")),
    },
  }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
