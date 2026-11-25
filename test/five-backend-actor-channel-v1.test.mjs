// Host-only admission tests; cannot prove any guest backend.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const dir = new URL("../verification/fixtures/five-backend-actor-channel-v1/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
const blobSha = bytes => createHash("sha1")
  .update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
test("ten .atto fixtures have immutable exact Git blob identity", () => {
  assert.deepEqual(manifest.backends, ["java", "llvm", "net", "wasm", "cranelift"]);
  assert.equal(manifest.fixtures.length, 10);
  const ids = new Set();
  for (const entry of manifest.fixtures) {
    assert.ok(!ids.has(entry.id), "duplicate case id");
    ids.add(entry.id);
    assert.match(entry.file, /^[a-z0-9-]+\.atto$/u);
    const bytes = readFileSync(new URL(entry.file, dir));
    assert.equal(blobSha(bytes), entry.gitBlobSha1);
    assert.ok(bytes.length > 30 && bytes.length < 65536);
    assert.ok(["accept", "reject"].includes(entry.kind));
    if (entry.kind === "accept") assert.equal(typeof entry.stdout, "string");
    else {
      assert.ok(entry.diagnosticPattern.length > 0);
      assert.doesNotThrow(() => new RegExp(entry.diagnosticPattern, "iu"));
    }
  }
  assert.equal([...ids].filter(id => id.startsWith("reject-")).length, 7);
  assert.equal([...ids].filter(id => !id.startsWith("reject-")).length, 3);
});
test("negative callable matrix covers channels, nested payloads, captures, nominal fields and topics", () => {
  const required = [
    "reject-function-message",
    "reject-nested-callable-message",
    "reject-captured-closure-message",
    "reject-nominal-callable-field-message",
    "reject-nested-callable-topic"
  ];
  const fixtureMap = new Map(manifest.fixtures.map(f => [f.id, f]));
  for (const id of required) {
    const entry = fixtureMap.get(id);
    assert.ok(entry, "required negative fixture missing: " + id);
    assert.equal(entry.kind, "reject", id + " must reject at compile time");
    assert.ok(entry.diagnosticPattern.includes("transport") ||
      entry.diagnosticPattern.includes("MessageData") ||
      entry.diagnosticPattern.includes("Topic payload"), "diagnostic not payload-specific: " + id);
  }
  assert.equal(new Set(manifest.fixtures.map(f => f.file)).size, 10,
    "fixture filenames must not be reused");
  assert.equal(new Set(manifest.fixtures.map(f => f.gitBlobSha1)).size, 10,
    "fixture sources must be distinct immutable Git blobs");
});

test("source-only fixtures never promote native proof or skip compiler execution", () => {
  assert.equal(manifest.state, "CANDIDATE_NOT_EXECUTED");
  assert.deepEqual(manifest.nativeGuestReceipts, []);
  assert.equal(manifest.hostReferenceCountAsGuest, false);
  for (const backend of manifest.backends)
    assert.equal(manifest.backendStatus[backend], "NOT_EXECUTED");
  const runner = fileURLToPath(new URL("../bin/execute-five-backend-actor-channel-v1.mjs", import.meta.url));
  const launch = spawnSync(process.execPath, [runner], {
    encoding: "utf8", timeout: 8000, maxBuffer: 128 * 1024,
  });
  assert.equal(launch.status, 1, "missing adapters must fail closed");
  const report = JSON.parse(launch.stdout);
  assert.ok(report.errors.some(e => e.backend === "admission"));
  for (const backend of manifest.backends)
    assert.equal(report.backendStatus[backend], "NOT_EXECUTED");
});
