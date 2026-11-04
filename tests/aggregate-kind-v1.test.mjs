import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../fixtures/aggregate-kind/v1/", import.meta.url);
const source = file => {
  const url = new URL(file, root);
  const metadata = lstatSync(url);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(),
    "aggregate fixture must be a regular source file: " + file);
  return readFileSync(url);
};
const original = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const sha = data => createHash("sha1").update(Buffer.concat([
  Buffer.from("blob " + data.length + "\0"), data
])).digest("hex");

function validate(m, load = source) {
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.scope, "aggregate-kind-exact-shapes-v1");
  assert.equal(m.cases.length, 20);
  // A manifest that pins its declared blobs but silently ignores injected
  // .ores files is not an exhaustive acceptance corpus. Reject extras,
  // deletions and symlink substitutions rather than trusting a partial plan.
  const declared = m.cases.map(c => c.file).sort();
  const actual = readdirSync(root).filter(name => name.endsWith(".ores")).sort();
  assert.deepEqual(actual, declared, "unmanifested aggregate source fixtures");
  assert.equal(m.referenceJavaPr, "https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2181");
  assert.equal(m.exactJavaHead, "9cf102b3e4a2bdaab31d6d48f0ddb4f8eb67dba5");
  assert.deepEqual(Object.keys(m.backendClaims).sort(),
    ["forge","java-graalvm","llvm","net","wasm"]);
  assert.ok(Object.values(m.backendClaims).every(v =>
    v === "pending-exact-head" || v === "not-yet-proven"));
  const evidenceKeys = [
    "exactHeadMaven", "exactHeadNative", "llvmGuest", "wasm32Guest",
    "netNativeAot", "forgeGuest", "formatterRoundtrip"
  ];
  assert.deepEqual(Object.keys(m.evidence).sort(), evidenceKeys.sort(),
    "must retain all seven explicit unverified evidence fields");
  assert.ok(Object.values(m.evidence).every(v => v === false));
  const seen = new Set();
  for (const c of m.cases) {
    assert.match(c.id, /^(?:reject-)?[a-z][a-z0-9-]*$/);
    assert.equal(c.file, c.id + ".ores");
    assert.ok(!seen.has(c.id), "duplicate case " + c.id);
    seen.add(c.id);
    assert.equal(c.expect, c.id.startsWith("reject-") ? "reject" : "accept");
    assert.ok(["parser","parser-or-typecheck","typecheck"].includes(c.stage));
    assert.deepEqual(c.confirmedBackends, []);
    assert.equal(c.runtimeVerified, false);
    assert.match(c.sourceGitBlobSha1, /^[a-f0-9]{40}$/);
    assert.equal(sha(load(c.file)), c.sourceGitBlobSha1, "blob drift: " + c.id);
  }
  for (const id of ["exact-struct-return","readonly-record-return",
    "local-struct-alias-return","local-record-alias-return",
    "named-constructor-source-order","inferred-struct-binding",
    "reject-record-as-struct","reject-struct-as-record",
    "reject-alias-cross-scope","reject-nominal-local-struct"])
    assert.ok(seen.has(id), "missing " + id);
  return seen.size;
}
test("aggregate kinds: all 20 source blobs match exact Git hashes", () => {
  assert.equal(validate(original), 20);
});
test("aggregate kinds: reject invented native parity", () => {
  const m = structuredClone(original);
  m.backendClaims.llvm = "verified";
  assert.throws(() => validate(m));
});
test("aggregate kinds: missing or renamed evidence fields fail closed", () => {
  const missing = structuredClone(original);
  missing.evidence = {};
  assert.throws(() => validate(missing), /must retain all seven/);
  const removed = structuredClone(original);
  delete removed.evidence.llvmGuest;
  assert.throws(() => validate(removed), /must retain all seven/);
  const renamed = structuredClone(original);
  renamed.evidence.llvmGuestVerified = renamed.evidence.llvmGuest;
  delete renamed.evidence.llvmGuest;
  assert.throws(() => validate(renamed), /must retain all seven/);
  const unexpected = structuredClone(original);
  unexpected.evidence.unreviewedCompiler = false;
  assert.throws(() => validate(unexpected), /must retain all seven/);
});
test("aggregate kinds: reject fabricated Java execution", () => {
  const m = structuredClone(original);
  m.evidence.exactHeadMaven = true;
  assert.throws(() => validate(m));
});
test("aggregate kinds: reject a modified source hash", () => {
  const m = structuredClone(original);
  m.cases[0].sourceGitBlobSha1 = "0".repeat(40);
  assert.throws(() => validate(m));
});
test("aggregate kinds: reject traversal and duplicate case ids", () => {
  const m = structuredClone(original);
  m.cases[0].file = "../private.ores";
  assert.throws(() => validate(m));
  const n = structuredClone(original);
  n.cases[0] = { ...n.cases[1] };
  assert.throws(() => validate(n));
});
