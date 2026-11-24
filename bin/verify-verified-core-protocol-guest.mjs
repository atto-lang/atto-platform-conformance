import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nativeProtocolRuntimeUnits } from "../lib/verified-core-protocol-mailbox.mjs";

const [backend, checkout, commonCheckout, compilerArg, toolArg] = process.argv.slice(2);
if (!toolArg || process.argv.length !== 7 || !["java", "llvm", "net"].includes(backend)) {
  throw new Error("Usage: node bin/verify-verified-core-protocol-guest.mjs java <checkout> <common checkout> <java> <mvn> | llvm <checkout> <common checkout> <oreslang-llvmc> <clang> | net <checkout> <common checkout> <dotnet> <runtime ID>");
}
const root = resolve(checkout);
const common = resolve(commonCheckout);
const conformance = fileURLToPath(new URL("../", import.meta.url));
const fixture = join(conformance, "fixtures/verified-core-protocol-guest-v1/connection.atto");
const work = mkdtempSync(join(tmpdir(), "atto-protocol-guest-"));
const source = readFileSync(fixture, "utf8");
const sanitize = backend === "llvm" && process.env.ATTO_PROTOCOL_SANITIZE === "1";
const solver = process.env.ATTO_PROTOCOL_SOLVER;
const evidenceDirectory = process.env.ATTO_PROTOCOL_EVIDENCE_DIR;

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function successful(command, args, cwd) {
  const result = run(command, args, cwd);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const fileSha256 = file => sha256(readFileSync(file));

function orderedFileHashes(directory, current = directory) {
  return readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap(entry => {
      const path = join(current, entry.name);
      if (entry.isDirectory()) return orderedFileHashes(directory, path);
      assert.ok(entry.isFile(), path);
      return [[relative(directory, path), fileSha256(path)]];
    });
}

function identity(repository) {
  const git = ["-C", repository];
  const [commit, tree] = successful("git", [...git, "rev-parse", "HEAD", "HEAD^{tree}"]).trim().split("\n");
  return { commit, tree, modified: successful("git", [...git, "status", "--porcelain"]).length !== 0 };
}

function mutate(from, to) {
  const first = source.indexOf(from);
  assert.ok(first >= 0 && source.indexOf(from, first + from.length) < 0, from);
  return source.replace(from, to);
}

async function referenceStatuses() {
  const { elaborateProtocol, SerialProtocolReference } = await import(
    pathToFileURL(join(common, "reference/verified-core/protocols.mjs")).href);
  const timeout = [{ name: "value", type: "Timeout" }];
  const protocol = elaborateProtocol({
    name: "Connection", initial: "Disconnected", terminals: ["Connected"],
    edges: [
      { source: "Disconnected", message: "connect", target: "Connecting", payload: timeout },
      { source: "Connecting", message: "complete", target: "Connected", payload: timeout },
    ],
  }, new Map([["Timeout", { carrier: "i32", unit: "Millis", range: [1n, 60_000n] }]]), [
    { kind: "dimension", name: "Time" },
    { kind: "unit", name: "Second", dimension: "Time" },
    { kind: "unit", name: "Millis", dimension: "Time", relativeTo: "Second", factor: "1000", divide: true },
  ]);
  const reference = new SerialProtocolReference(protocol, 2n, elapsed => elapsed >= 0n && elapsed <= 10n);
  const status = new Map([["committed", 1], ["illegal-edge", 2], ["invariant-failed", 6]]);
  return [
    ["initialRejection", "connect", "Connecting", 9n],
    ["connecting", "connect", "Connecting", 7n],
    ["overflowed", "complete", "Connected", 2n],
    ["connected", "complete", "Connected", 1n],
    ["terminal", "complete", "Connected", 1n],
  ].map(([name, message, target, value]) => {
    const before = reference.snapshot;
    const outcome = reference.dispatch({ incarnation: 1n, message,
      payload: [{ value, unit: protocol.unit("Millis") }] }, elapsed => ({ target, value: elapsed + value }));
    if (outcome !== "committed") assert.equal(reference.snapshot, before);
    assert.ok(status.has(outcome), outcome);
    return { name, status: status.get(outcome) };
  });
}

const negativeCases = [
  ["wrong-scale", mutate("connect(9<Millis>)", "connect(9<Second>)"), /E_UNIT_SCALE:/],
  ["out-of-range", mutate("connect(9<Millis>)", "connect(0<Millis>)"), /E_PROTOCOL_PAYLOAD:/],
  ["initial-invariant", mutate("elapsed = 2<Millis>", "elapsed = 11<Millis>"), /E_PROTOCOL_INVARIANT:/],
  ["after-stop", mutate("worker.stop();", "worker.stop(); worker.send(connect(1<Millis>));"), /E_PROTOCOL_GUEST:/],
  ["missing-stop", mutate("worker.stop();", ""), /E_PROTOCOL_GUEST:/],
  ["effect-before-publish", mutate("transition Connecting;", "send(timeout); transition Connecting;"), /E_PROTOCOL_TRANSITION:/],
];

const xml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

function javaDriver() {
  const [java, mvn] = [compilerArg, toolArg];
  const dependencyFile = join(work, "classpath");
  successful(mvn, ["-q", "-DskipTests", "compile", "dependency:build-classpath", `-Dmdep.outputFile=${dependencyFile}`]);
  const classes = join(root, "target/classes");
  const dependencies = readFileSync(dependencyFile, "utf8").trim().split(delimiter);
  const launcher = ["--enable-native-access=ALL-UNNAMED", "-Dpolyglot.engine.WarnInterpreterOnly=false",
    "-cp", [classes, ...dependencies].join(delimiter), "dev.oreslang.launcher.OresMain"];
  const jdk = run(java, ["--version"]);
  assert.equal(jdk.status, 0, jdk.stderr);
  return {
    toolchain: jdk.stdout.split("\n")[0],
    compilerSha256: sha256(JSON.stringify(orderedFileHashes(classes))),
    dependencySha256: sha256(JSON.stringify(dependencies.map(fileSha256))),
    check: input => run(java, [...launcher, "--check", input]),
    execute: input => ({ result: run(java, [...launcher, input]), executableSha256: null }),
  };
}

function llvmDriver() {
  const [compiler, clang] = [resolve(compilerArg), resolve(toolArg)];
  const sourceRoot = join(root, "src/main/cpp");
  const runtimeUnits = nativeProtocolRuntimeUnits.map(unit => join(sourceRoot, "oreslang/runtime", unit + ".c"));
  const flags = sanitize
    ? ["-g", "-fno-omit-frame-pointer", "-fsanitize=address,undefined", "-fno-sanitize-recover=all"]
    : [];
  const objects = runtimeUnits.map((source, index) => {
    const object = join(work, `runtime-${index}.o`);
    successful(clang, ["-O1", ...flags, "-std=c11", "-pthread", "-I", sourceRoot, "-c", source, "-o", object]);
    return object;
  });
  return {
    toolchain: successful(clang, ["--version"]).split("\n")[0],
    target: successful(clang, ["-dumpmachine"]).trim(),
    compilerSha256: fileSha256(compiler),
    check: input => run(compiler, ["--check", input]),
    execute(input) {
      const ir = successful(compiler, ["--target=host", input]);
      const ll = join(work, "guest.ll"), guest = join(work, "guest");
      assert.match(ir, /define i32 @main\(\)/);
      assert.match(ir, /call .* @oreslang_source_actor_complete_protocol_send_id\(/);
      writeFileSync(ll, ir);
      successful(clang, ["-O2", ...flags, "-pthread", ll, ...objects, "-o", guest]);
      return { result: run(guest, []), executableSha256: fileSha256(guest), executable: guest };
    },
  };
}

function netDriver() {
  const [dotnet, rid] = [compilerArg, toolArg];
  const compiler = join(root, "compiler/Ores.Net.Compiler/bin/Release/net10.0/oresnet.dll");
  successful(dotnet, ["build", "compiler/Ores.Net.Compiler/Ores.Net.Compiler.csproj", "-c", "Release",
    "-p:PublishAot=false", "-p:PublishTrimmed=false", "-p:SelfContained=false"]);
  const projectText = `<Project Sdk="Microsoft.NET.Sdk">
    <PropertyGroup>
      <OutputType>Exe</OutputType>
      <TargetFramework>net10.0</TargetFramework>
      <ImplicitUsings>enable</ImplicitUsings>
      <Nullable>enable</Nullable>
      <PublishAot>true</PublishAot>
      <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    </PropertyGroup>
    <ItemGroup>
      <ProjectReference Include="${xml(join(root, "runtime/Ores.Net.Runtime/Ores.Net.Runtime.csproj"))}" />
    </ItemGroup>
  </Project>
`;
  return {
    toolchain: successful(dotnet, ["--version"]).trim(),
    target: rid,
    compilerSha256: fileSha256(compiler),
    compilerCoreSha256: fileSha256(join(root, "compiler/Ores.Net.Compiler/bin/Release/net10.0/Ores.Net.Compiler.Core.dll")),
    check: input => run(dotnet, [compiler, "check", input]),
    execute(input, name) {
      const projectDir = join(work, name);
      mkdirSync(projectDir);
      const generated = join(projectDir, "Guest.cs");
      successful(dotnet, [compiler, "emit-csharp", input, "--out", generated]);
      const project = join(projectDir, "ProtocolGuest.csproj");
      writeFileSync(project, projectText);
      const output = join(work, `${name}-native`);
      successful(dotnet, ["publish", project, "-c", "Release", "-r", rid, "-o", output]);
      assert.equal(existsSync(join(output, "ProtocolGuest.dll")), false);
      const guest = join(output, rid.startsWith("win-") ? "ProtocolGuest.exe" : "ProtocolGuest");
      return { result: run(guest, []), executableSha256: fileSha256(guest), executable: guest };
    },
  };
}

try {
  if (evidenceDirectory && (!solver || backend === "java"))
    throw new Error("Native proof bundles require LLVM or .NET and ATTO_PROTOCOL_SOLVER");
  const bundle = evidenceDirectory ? resolve(evidenceDirectory) : null;
  const proof = solver ? await import(pathToFileURL(join(common,
    "reference/verified-core/protocol-staging-proof.mjs")).href)
    .then(module => module.verifyConnectionStaging(Buffer.from(source), resolve(solver))) : null;
  if (bundle) mkdirSync(bundle);
  const { check, execute, ...toolchain } = ({ java: javaDriver, llvm: llvmDriver, net: netDriver })[backend]();
  const observations = [];
  for (const [name, text, diagnostic] of negativeCases) {
    const input = join(work, `${name}.atto`);
    writeFileSync(input, text);
    const result = check(input);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, diagnostic, name);
    observations.push({ name, sourceSha256: fileSha256(input), diagnostic: diagnostic.source });
  }
  for (const { name, status } of await referenceStatuses()) {
    const input = join(work, `${name}.atto`);
    writeFileSync(input, mutate("return connected;", `return ${name};`));
    const checked = check(input);
    assert.equal(checked.status, 0, name + ": " + checked.stdout + checked.stderr);
    const { result, executableSha256, executable } = execute(input, name);
    assert.equal(result.status, status, name + ": " + result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), "", name);
    if (bundle) copyFileSync(executable, join(bundle, `${name}.guest`));
    observations.push({ name, sourceSha256: fileSha256(input), status, executableSha256 });
  }
  console.log(`verified 5 guest receipts and 6 static rejections through ${backend}`);
  const receipt = {
    backend, sanitize, compiler: identity(root), conformance: identity(conformance), common: identity(common),
    fixtureSha256: fileSha256(fixture), ...toolchain, observations, proof,
  };
  if (bundle) writeFileSync(join(bundle, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
} finally {
  rmSync(work, { recursive: true, force: true });
}
