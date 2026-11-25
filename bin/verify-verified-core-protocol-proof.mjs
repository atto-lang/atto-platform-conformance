import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [directoryArg, compilerArg, commonArg, solverArg, executableArg] = process.argv.slice(2);
if (!executableArg || process.argv.length !== 7)
  throw new Error("Usage: node bin/verify-verified-core-protocol-proof.mjs <bundle> <compiler checkout> <common checkout> <z3> <compiler executable>");

const directory = resolve(directoryArg);
const compiler = resolve(compilerArg);
const common = resolve(commonArg);
const conformance = fileURLToPath(new URL("../", import.meta.url));
const fixture = readFileSync(join(conformance, "fixtures/verified-core-protocol-guest-v1/connection.atto"));

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const hex = /^[a-f0-9]{64}$/;

function execute(command, args, timeout) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function pinnedIdentity(repository, record) {
  const metadata = execute("git", ["-C", repository, "rev-parse", "HEAD", "HEAD^{tree}"], 10_000);
  assert.equal(metadata.status, 0, metadata.stderr);
  const [commit, tree] = metadata.stdout.trim().split("\n");
  const state = execute("git", ["-C", repository, "status", "--porcelain"], 10_000);
  assert.equal(state.status, 0, state.stderr);
  assert.equal(state.stdout, "", `Verifier requires a clean checkout at ${repository}`);
  assert.deepEqual(record, { commit, tree, modified: false }, `Stale evidence for ${repository}`);
}

function readRegular(name, maximum) {
  const path = join(directory, name);
  const info = lstatSync(path);
  assert.ok(info.isFile() && info.size > 0 && info.size <= maximum, `Invalid evidence file ${name}`);
  return { path, bytes: readFileSync(path) };
}

const receipt = JSON.parse(readRegular("receipt.json", 256 * 1024).bytes.toString("utf8"));
assert.ok(["llvm", "net"].includes(receipt.backend), "Expected native protocol artifact evidence");
const executable = resolve(executableArg);
assert.equal(hash(readFileSync(executable)), receipt.compilerSha256, "Substituted compiler executable");
if (receipt.backend === "net") {
  const core = join(dirname(executable), "Ores.Net.Compiler.Core.dll");
  assert.equal(hash(readFileSync(core)), receipt.compilerCoreSha256, "Substituted compiler core assembly");
}
pinnedIdentity(compiler, receipt.compiler);
pinnedIdentity(common, receipt.common);
pinnedIdentity(conformance, receipt.conformance);
assert.equal(receipt.fixtureSha256, hash(fixture), "Stale Connection source");

const { verifyConnectionStaging } = await import(pathToFileURL(join(common,
  "reference/verified-core/protocol-staging-proof.mjs")).href);
const proof = verifyConnectionStaging(fixture, resolve(solverArg));
assert.deepEqual(receipt.proof, proof, "Missing or mismatched staging proof");

const expected = new Map([
  ["initialRejection", 6], ["connecting", 1], ["overflowed", 6],
  ["connected", 1], ["terminal", 2],
]);
const positive = receipt.observations.filter(observation => Number.isInteger(observation.status));
assert.equal(positive.length, expected.size, "Incomplete executable evidence");
const native = positive.map(({ name, sourceSha256, status, executableSha256 }) => {
  assert.ok(expected.has(name), "Repeated or unknown Connection observation");
  assert.equal(status, expected.get(name), `Wrong receipt for ${name}`);
  expected.delete(name);
  const variant = fixture.toString("utf8").replace("return connected;", `return ${name};`);
  assert.equal(sourceSha256, hash(variant), `Wrong source for ${name}`);
  assert.ok(hex.test(executableSha256), `Missing executable digest for ${name}`);
  const { path, bytes } = readRegular(`${name}.guest`, 128 * 1024 * 1024);
  assert.equal(hash(bytes), executableSha256, `Substituted executable for ${name}`);
  return { path, status };
});
for (const { path, status } of native) {
  const result = execute(path, [], 30_000);
  assert.equal(result.stdout.trim(), "", path);
  assert.equal(result.stderr.trim(), "", path);
  assert.equal(result.status, status, path);
}
console.log(JSON.stringify({
  profile: proof.profile, modelObligations: proof.results.length, executableReplays: native.length,
  backend: receipt.backend, compiler: receipt.compiler,
}));
