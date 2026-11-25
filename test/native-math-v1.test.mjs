import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../fixtures/native-math-v1/", import.meta.url);

function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(Buffer.from("blob " + bytes.length + "\0", "ascii"))
    .update(bytes)
    .digest("hex");
}

test("native Math v1 manifest pins every source file and never self-certifies parity", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.suite, "native-math-v1");
  assert.equal(manifest.policy,
    "fixtures-and-reference-contracts-never-certify-backend-parity");

  const backends = ["java", "llvm", "net", "wasm", "forge"];
  assert.deepEqual(manifest.backends, backends);
  const allowed = new Set(manifest.allowedTargetStates);
  assert.ok(!allowed.has("verified"));
  assert.ok(!allowed.has("passed"));

  const ids = new Set();
  for (const item of manifest.cases) {
    assert.ok(!ids.has(item.id), "duplicate case id: " + item.id);
    ids.add(item.id);
    const bytes = await readFile(new URL(item.file, root));
    assert.equal(gitBlobSha(bytes), item.gitBlob, item.id + " source identity");
    assert.deepEqual(Object.keys(item.targets), backends, item.id + " backend inventory");
    for (const [backend, state] of Object.entries(item.targets)) {
      assert.ok(allowed.has(state), item.id + ": invalid " + backend + " state " + state);
      assert.notEqual(state, "verified");
      assert.notEqual(state, "passed");
    }
  }

  assert.equal(manifest.contracts.mathUnaryPrecisionGitBlob,
    "3249d837ae6bcf6e2c2c23cac872becf92d0c8e0");
  assert.equal(manifest.contracts.bigIntExactGitBlob,
    "b49c7a7d9395f7298e5534c4a6e5b90d4a2a518c");
  assert.equal(manifest.contracts.decimalPrecisionGitBlob,
    "3bbb44277f3816add53da40a1e161e466ab162b1");
  assert.equal(manifest.contracts.numericPublicApiGitBlob,
    "1b0f0295de78ce7d33b2dc0b07eed3cc78cf6983");
  assert.equal(manifest.contracts.binaryFloatingGitBlob,
    "4f5a8da960f017f9254872cccd565cfff5fc8f33");
});

test("f32 remains fail-closed until a distinct binary32 implementation exists", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const f32 = manifest.cases.find(item => item.id === "f32-distinct-or-reject");
  assert.ok(f32);
  assert.equal(f32.mode, "reject-until-distinct-binary32");
  for (const state of Object.values(f32.targets)) {
    assert.equal(state, "blocked-distinct-binary32");
  }
});
