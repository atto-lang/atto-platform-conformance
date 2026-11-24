import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReferenceFrames } from "../lib/verified-core-protocol-mailbox.mjs";

const [checkout, compilerArg, clangArg, common] = process.argv.slice(2);
if (!common || process.argv.length !== 6) {
  throw new Error("Usage: node bin/verify-verified-core-protocol-mailbox-llvm.mjs <atto-source.llvm checkout> <oreslang-llvmc> <clang> <atto-common-source checkout>");
}
const root = resolve(checkout);
const compiler = resolve(compilerArg);
const clang = resolve(clangArg);
const conformance = fileURLToPath(new URL("../", import.meta.url));
const fixtures = join(conformance, "fixtures");
const bindings = join(fixtures, "verified-core-protocol-handlers-v1");
const standalone = join(fixtures, "verified-core-protocol-mailbox-net-v1", "Standalone.atto");
const host = join(fixtures, "verified-core-protocol-mailbox-llvm-v1", "host.c");
const sourceRoot = join(root, "src/main/cpp");
const runtime = join(sourceRoot, "oreslang/runtime");
const work = mkdtempSync(join(tmpdir(), "atto-protocol-mailbox-llvm-"));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 120_000 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function successful(command, args) {
  const result = run(command, args);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

const sha256 = file => createHash("sha256").update(readFileSync(file)).digest("hex");

function identity(repository) {
  const git = ["-C", resolve(repository)];
  const [commit, tree] = successful("git", [...git, "rev-parse", "HEAD", "HEAD^{tree}"]).trim().split("\n");
  return { commit, tree, modified: successful("git", [...git, "status", "--porcelain"]).length !== 0 };
}

try {
  const sources = [join(bindings, "connection-binding.atto"), join(bindings, "payment-binding.atto"), standalone];
  const objects = sources.map((source, index) => {
    const args = ["--emit-protocol-actors", source];
    const ir = successful(compiler, args);
    assert.equal(ir, successful(compiler, args));
    assert.doesNotMatch(ir, /define .* @main\(/);
    const ll = join(work, `actor-${index}.ll`);
    const object = join(work, `actor-${index}.o`);
    writeFileSync(ll, ir);
    successful(clang, ["-O2", "-c", ll, "-o", object]);
    return object;
  });
  const rejected = run(compiler, ["--emit-protocol-actors", join(bindings, "effect-before-transition.atto")]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /E_PROTOCOL_TRANSITION:/);
  assert.equal(rejected.stdout, "");
  const wrongTarget = run(compiler, ["--emit-protocol-actors", "--target=wasm32", sources[0]]);
  assert.notEqual(wrongTarget.status, 0);
  assert.equal(wrongTarget.stdout, "");

  const runtimeUnits = [
    "ActorOwnedI64Heap", "NativeActorScheduler", "NativeOresVM", "NativeActorFuture",
    "SourceActorBootstrap", "NativeActorLogicalFramesV1", "NativeExecutionContextStore",
    "NativeContinuationStore", "NativeAwaitTraceBridge", "NativeLogicalTrace",
  ];
  const native = join(work, "protocol-mailbox");
  const sanitize = process.env.ATTO_PROTOCOL_SANITIZE === "1";
  const flags = sanitize
    ? ["-g", "-fno-omit-frame-pointer", "-fsanitize=address,undefined", "-fno-sanitize-recover=all"]
    : [];
  successful(clang, ["-O1", ...flags, "-std=c11", "-pthread", "-I", sourceRoot,
    host, ...runtimeUnits.map(name => join(runtime, name + ".c")), ...objects, "-o", native]);
  const trace = successful(native, []).trim().split("\n");
  assert.equal(trace.length, 3);
  await checkReferenceFrames(trace, common);
  assert.equal(trace[2], "verified 21 live LLVM protocol turn receipts and 24 stop races");
  console.log(trace[2]);
  console.log(JSON.stringify({
    llvm: identity(root), conformance: identity(conformance), common: identity(common),
    compilerSha256: sha256(compiler), clang: successful(clang, ["--version"]).split("\n")[0],
    target: successful(clang, ["-dumpmachine"]).trim(),
    nativeSha256: sha256(native), sanitize,
    sources: { connection: sha256(sources[0]), payment: sha256(sources[1]),
      standalone: sha256(sources[2]), host: sha256(host) },
  }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
