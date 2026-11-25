import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkReferenceFrames } from "../lib/verified-core-protocol-mailbox.mjs";

const [checkout, java, mvn, common] = process.argv.slice(2);
if (!checkout || !java || !mvn || !common || process.argv.length !== 6) {
  throw new Error("Usage: node bin/verify-verified-core-protocol-mailbox-java.mjs <atto-source.java checkout> <java> <mvn> <atto-common-source checkout>");
}
const root = resolve(checkout);
const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));
const bindings = join(fixtures, "verified-core-protocol-handlers-v1");
const standalone = join(fixtures, "verified-core-protocol-mailbox-net-v1", "Standalone.atto");
const host = join(fixtures, "verified-core-protocol-mailbox-java-v1", "ProtocolMailboxHost.java");
const work = mkdtempSync(join(tmpdir(), "atto-protocol-mailbox-java-"));

function successful(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8",
    timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

try {
  const dependencyFile = join(work, "classpath");
  successful(mvn, ["-q", "-DskipTests", "compile", "dependency:build-classpath",
    "-Dmdep.outputFile=" + dependencyFile]);
  const classpath = join(root, "target/classes") + delimiter + readFileSync(dependencyFile, "utf8").trim();
  const result = successful(java, ["--enable-native-access=ALL-UNNAMED", "-cp", classpath, host,
    join(bindings, "connection-binding.atto"), join(bindings, "payment-binding.atto"),
    standalone, join(bindings, "effect-before-transition.atto")]);
  const trace = result.stdout.trim().split("\n");
  assert.equal(trace.length, 3);
  await checkReferenceFrames(trace, common);
  assert.equal(trace[2], "verified 20 live Java protocol turn receipts and 24 stop races");
  console.log(trace[2]);
  const [commit, tree] = successful("git", ["rev-parse", "HEAD", "HEAD^{tree}"]).stdout.trim().split("\n");
  console.log(JSON.stringify({
    commit, tree, modified: successful("git", ["status", "--porcelain"]).stdout.length !== 0,
    jdk: successful(java, ["-version"]).stderr.split("\n")[0],
  }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
