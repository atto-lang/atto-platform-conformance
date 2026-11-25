import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const dir = join(root, "../fixtures/inverted-class/v1");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const requiredTargets = ["forge", "java", "js", "llvm", "net", "wasm"];

test("inverted class v1 remains evidence-honest and target-complete", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.contract, "inverted-class-v1");
  assert.equal(manifest.evidenceLevel, "fixtures-only-source-unverified");
  assert.deepEqual(Object.keys(manifest.backends).sort(), requiredTargets);
  for (const [name, gate] of Object.entries(manifest.backends)) {
    assert.equal(gate.sourceCompilerVerified, false, name);
    assert.equal(gate.guestExecutionVerified, false, name);
    assert.equal(gate.exactHeadCiVerified, false, name);
  }
  assert.deepEqual(manifest.semantics.scalars, ["i64", "f64", "bool"]);
  assert.equal(new Set(manifest.hostVectors.map(v => v.id)).size, manifest.hostVectors.length);
  assert.ok(manifest.hostVectors.length >= 12);
  assert.ok(manifest.promotionGates.length >= 5);
});

test("inverted v1 source fixtures are pinned to exact Git blob identities", () => {
  assert.equal(manifest.sourceCases.length, 6);
  const ids = new Set();
  const paths = new Set();
  for (const entry of manifest.sourceCases) {
    assert.match(entry.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(entry.id), "duplicate fixture id");
    assert.ok(!paths.has(entry.file), "duplicate fixture path");
    ids.add(entry.id);
    paths.add(entry.file);
    assert.match(entry.file, /^(positive|reject)-[a-z0-9-]+\.ores$/);
    assert.match(entry.sourceGitBlobSha1, /^[0-9a-f]{40}$/);
    assert.deepEqual(entry.verifiedBackends, [], "no source backend is verified");
    assert.ok(["accept-execute", "reject-no-codegen"].includes(entry.expect));
    if (entry.expect === "accept-execute") assert.equal(entry.expectedI64, "42");
    else assert.equal(entry.expectedI64, undefined);
    const payload = readFileSync(join(dir, entry.file));
    assert.ok(payload.length > 0 && payload.length < 8192);
    const prefix = Buffer.from("blob " + payload.length + "\0");
    const actual = createHash("sha1").update(prefix).update(payload).digest("hex");
    assert.equal(actual, entry.sourceGitBlobSha1, entry.file);
  }
});
