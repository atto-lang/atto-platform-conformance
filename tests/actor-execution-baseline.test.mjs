import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";

const root = new URL("../fixtures/actor-execution/v1/", import.meta.url);
const original = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const sourceBytes = readFileSync(new URL("spawn-send-receive-stop.ores", root));
const blobSha = bytes => createHash("sha1")
  .update("blob " + bytes.length + "\0").update(bytes).digest("hex");
const backends = [
  "java-graalvm", "llvm-native", "wasm", "forge",
  "net-native-aot", "cranelift-native"
];
function check(m, bytes) {
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.scope, "actor-spawn-send-receive-output-stop-v1");
  assert.equal(m.evidenceLevel, "source-fixture-only");
  assert.equal(m.normativePhase, "lifecycle-baseline-without-sealed-state");
  assert.deepEqual(Object.keys(m.backends), backends);
  assert.equal(m.cases.length, 1);
  const c = m.cases[0];
  assert.equal(c.id, "single-actor-request-reply-stop");
  assert.equal(c.file, "spawn-send-receive-stop.ores");
  assert.match(c.sourceGitBlobSha1, /^[0-9a-f]{40}$/);
  assert.equal(c.sourceGitBlobSha1, blobSha(bytes));
  assert.deepEqual(c.expected, {
    exitCode: 0, stdout: "42", actorInstances: 1,
    messageAdmissions: 1, outputMessages: 1,
    readyBeforeSend: true, doneAfterOutput: true
  });
  assert.deepEqual(c.verifiedGuestBackends, []);
  for (const name of backends) {
    assert.equal(m.backends[name].verified, false,
      name + " needs actual compiled guest logs, not a manifest");
    assert.equal(typeof m.backends[name].candidate, "string");
    assert.match(m.backends[name].pr,
      /^https:\/\/github\.com\/ores-truffle-oreslang\/oreslang-source\./);
  }
  assert.ok(m.notCovered.includes("sealed state schema and critical read/write loans"));
  assert.ok(m.notCovered.includes("trait or interface dispatch"));
  assert.match(m.evidenceRule, /nonzero test steps/);
  const source = bytes.toString("utf8");
  assert.ok(source.endsWith("\n"));
  assert.match(source, /define actor A1 as/);
  assert.match(source, /receive\(ActorMail<int> mail\): void/);
  assert.match(source, /self\.send\(mail\.value \+ 1\)/);
  assert.match(source, /self\.end\(\)/);
  assert.match(source, /val worker = spawn A1\(\)/);
  assert.match(source, /await worker\.get_ready\(\)/);
  assert.match(source, /worker\.send\(41\)/);
  assert.match(source, /worker\.outputs\.next\(\)/);
  assert.match(source, /await worker\.get_done\(\)/);
  return true;
}

test("pinned actor source contract declares zero guest backend passes", () => {
  assert.equal(check(original, sourceBytes), true);
});

test("manifest cannot counterfeit execution or silently drift source bytes", () => {
  const edited = () => structuredClone(original);
  const violations = [
    m => {m.evidenceLevel = "runtime-verified";},
    m => {m.cases[0].verifiedGuestBackends.push("java-graalvm");},
    m => {m.backends["java-graalvm"].verified = true;},
    m => {m.backends["llvm-native"].verified = true;},
    m => {delete m.backends["cranelift-native"];},
    m => {m.cases[0].sourceGitBlobSha1 = "0".repeat(40);},
    m => {m.cases[0].expected.stdout = "43";},
    m => {m.cases.push(structuredClone(m.cases[0]));},
    m => {m.cases[0].file = "../private-source.ores";},
    m => {m.notCovered = [];},
  ];
  for (const mutate of violations) {
    const m = edited();
    mutate(m);
    assert.throws(() => check(m, sourceBytes));
  }
});

test("actor lifecycle fixture content is immutably pinned by its Git blob", () => {
  const mutated = Buffer.from(sourceBytes);
  mutated[mutated.length - 2] ^= 1;
  assert.throws(() => check(original, mutated));
  assert.throws(() => check(original,
    Buffer.from(sourceBytes.toString("utf8").replaceAll("\n", "\r\n"))));
});
