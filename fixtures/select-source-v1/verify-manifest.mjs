#!/usr/bin/env node
// Source-blob integrity and matrix-schema gate only. No compiler is executed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function verify(root = dirname(fileURLToPath(import.meta.url))) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.schema, "atto.select.source-v1");
  assert.equal(manifest.compilerEvidence, "not-executed");
  assert.equal(manifest.sourceExtension, ".atto");
  assert.deepEqual(manifest.backends, ["java-graalvm", "llvm", "net"]);
  assert.equal(manifest.cases.length, 8);
  const seenIds = new Set();
  const seenPaths = new Set();
  for (const c of manifest.cases) {
    assert.match(c.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert(!seenIds.has(c.id), "duplicate select fixture id");
    assert.match(c.path, /^[a-z0-9]+(?:-[a-z0-9]+)*\.atto$/);
    assert(!seenPaths.has(c.path), "duplicate select fixture path");
    seenIds.add(c.id);
    seenPaths.add(c.path);
    assert.equal(c.evidenceStatus, "not-executed",
      "source contract cannot claim execution evidence");
    assert.deepEqual(Object.keys(c.expected).sort(), [...manifest.backends].sort());
    for (const backend of manifest.backends) {
      const expectation = c.expected[backend];
      assert(["run", "reject", "unverified"].includes(expectation.mode));
      if (expectation.mode === "run") {
        assert(Number.isSafeInteger(expectation.exitCode));
        assert(expectation.exitCode >= 0 && expectation.exitCode <= 255);
      } else {
        assert(!Object.hasOwn(expectation, "exitCode"));
      }
      if (expectation.diagnosticContains !== undefined) {
        assert.equal(expectation.mode, "reject");
        assert.equal(typeof expectation.diagnosticContains, "string");
        assert(expectation.diagnosticContains.length > 0);
      }
    }
    const content = readFileSync(join(root, c.path));
    const sha = createHash("sha1").update(
      Buffer.from(`blob ${content.length}\0`, "utf8")).update(content).digest("hex");
    assert.match(c.gitBlobSha1, /^[0-9a-f]{40}$/);
    assert.equal(sha, c.gitBlobSha1, "select fixture blob drift: " + c.path);
  }
  return { count: seenIds.size, schema: manifest.schema };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verify();
  console.log("SELECT_SOURCE_INTEGRITY_PASS " + result.count +
    " pinned source blobs; NOT guest execution");
}
