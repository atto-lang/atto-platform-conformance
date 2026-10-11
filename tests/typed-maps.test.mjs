import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

const directory = new URL("../fixtures/typed-maps/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", directory), "utf8")
);

test("typed Map matrix does not overclaim unsupported backend parity", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.scope, "typed-open-map-v1");
  assert.match(manifest.javaCompilerHead, /^[a-f0-9]{40}$/);
  assert.match(manifest.javaGraalEvidence, /actions\/runs\/[0-9]+$/);
  assert.equal(manifest.cases.length, 4);
  const seen = new Set();
  for (const entry of manifest.cases) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.equal(seen.has(entry.id), false);
    seen.add(entry.id);
    assert.equal(entry.javaGraal, "equivalent-source-junit-verified");
    assert.equal(entry.exactFixtureExecution, "verified");
    assert.equal(entry.exactFixtureEvidence, manifest.javaGraalEvidence);
    assert.deepEqual(entry.otherBackends, {
      llvm: "pending", wasm: "pending", browser: "pending"
    });
    assert.ok(entry.expect === "accept" || entry.expect === "reject");
    if (entry.expect === "accept") {
      assert.equal(entry.expectedStdout, "PPGhelloGtrueRGtrue");
      assert.equal(entry.diagnosticClass, undefined);
    } else {
      assert.match(entry.diagnosticClass, /^[a-z-]+$/);
      assert.equal(entry.expectedStdout, undefined);
    }
  }
});

test("typed Map fixtures are pinned to their exact Git blob bytes", async () => {
  for (const entry of manifest.cases) {
    assert.match(entry.file, /^[a-z-]+\.ores$/);
    assert.match(entry.sourceGitBlobSha1, /^[a-f0-9]{40}$/);
    const bytes = await readFile(new URL(entry.file, directory));
    const actual = createHash("sha1")
      .update("blob " + bytes.length + "\0")
      .update(bytes)
      .digest("hex");
    assert.equal(actual, entry.sourceGitBlobSha1, entry.file + " drifted");
  }
});
