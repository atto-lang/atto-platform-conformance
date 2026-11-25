#!/usr/bin/env node
/**
 * Integrity-only check. This is intentionally NOT a language backend test.
 * Execute via: node fixtures/select-plans/v1/verify-manifest.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const expectedBackends = ["java-graalvm", "llvm", "net", "wasm", "forge"];
const expectedCases = 6;

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.kind, "normative-target-corpus-not-execution-evidence");
assert.equal(manifest.compilerEvidence, "not-executed");
assert.deepEqual(Object.keys(manifest.backendStatus).sort(), expectedBackends.sort());
assert.equal(manifest.cases.length, expectedCases);

const ids = new Set();
const paths = new Set();
for (const entry of manifest.cases) {
  assert.match(entry.id, /^[a-z0-9][a-z0-9-]*$/);
  assert(!ids.has(entry.id), `duplicate fixture id: ${entry.id}`);
  ids.add(entry.id);
  assert.match(entry.file, /^[a-z0-9][a-z0-9-]*\.ores$/);
  assert(!paths.has(entry.file), `duplicate fixture path: ${entry.file}`);
  paths.add(entry.file);
  assert.equal(entry.verified, false, `unverified corpus cannot certify ${entry.id}`);
  assert.match(entry.sourceGitBlobSha1, /^[0-9a-f]{40}$/);
  assert(["accept_when_lowered", "reject_always"].includes(entry.outcome));
  if (entry.outcome === "accept_when_lowered") {
    assert.equal(typeof entry.expectedStdout, "string");
  } else {
    assert.equal(typeof entry.diagnostic, "string");
  }
  const contents = readFileSync(join(root, entry.file));
  const blobSha = createHash("sha1")
    .update(Buffer.from(`blob ${contents.length}\0`, "utf8"))
    .update(contents)
    .digest("hex");
  assert.equal(blobSha, entry.sourceGitBlobSha1,
    `fixture changed without pinned SHA update: ${entry.file}`);
}
console.log(`SELECT_PLAN_FIXTURE_INTEGRITY_PASS ${ids.size} source SHAs; no compiler evidence`);
