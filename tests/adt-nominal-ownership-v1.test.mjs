import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventory = path.join(root, "contracts", "v3", "atto-adt-nominal-ownership-v1.json");
const sourceDirectory = path.join(root, "fixtures", "adt-nominal-ownership-v1");
const backends = ["java", "llvm", "net", "wasm", "forge", "cranelift"];
const rejectionKinds = new Set([
  "duplicate-tag", "duplicate-case", "foreign-owner", "payload-type",
  "constructor-arity", "exhaustiveness", "guarded-coverage",
  "unboxed-cycle", "move-after-move"
]);

function readManifest() {
  return JSON.parse(fs.readFileSync(inventory, "utf8"));
}

function verify(manifest, checkDisk = true) {
  assert.equal(manifest.version, "atto-adt-nominal-ownership-v1");
  assert.equal(manifest.status, "contract-only-not-executed");
  assert.deepEqual(manifest.targetBackends, backends);
  assert.equal(manifest.executableParityCertified, false);
  assert.deepEqual(manifest.confirmedBackends, []);
  assert.ok(Array.isArray(manifest.cases) && manifest.cases.length === 12);
  const ids = new Set();
  const names = new Set();
  const expected = new Set();
  for (const item of manifest.cases) {
    assert.equal(typeof item.id, "string");
    assert.match(item.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(item.id), "duplicate test id");
    ids.add(item.id);
    assert.equal(item.file, item.id + ".atto");
    assert.ok(!names.has(item.file), "duplicate filename");
    names.add(item.file);
    assert.match(item.gitBlobSha1, /^[a-f0-9]{40}$/);
    assert.deepEqual(item.confirmedBackends, []);
    assert.equal(item.executableParityCertified, false);
    assert.ok(item.outcome === "accept" || item.outcome === "reject");
    if (item.outcome === "accept") {
      assert.equal(typeof item.expectedStdout, "string");
      assert.ok(item.expectedStdout.length > 0);
      assert.ok(!("rejectKind" in item));
    } else {
      assert.ok(rejectionKinds.has(item.rejectKind));
      assert.ok(!("expectedStdout" in item));
    }
    expected.add(item.file);
    if (checkDisk) {
      const name = path.join(sourceDirectory, item.file);
      const st = fs.lstatSync(name);
      assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1,
        "fixture must be a plain, singly linked file");
      assert.ok(st.size > 0 && st.size < 65536);
      const bytes = fs.readFileSync(name);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      assert.ok(!text.includes("\0"), "fixture contains embedded NUL");
      assert.match(text, /define enum /);
      const digest = createHash("sha1").update("blob " + bytes.length + "\0")
        .update(bytes).digest("hex");
      assert.equal(digest, item.gitBlobSha1, "Git blob integrity failure: " + item.id);
    }
  }
  if (checkDisk) {
    const parent = fs.lstatSync(sourceDirectory);
    assert.ok(parent.isDirectory() && !parent.isSymbolicLink());
    const actual = fs.readdirSync(sourceDirectory).sort();
    assert.deepEqual(actual, Array.from(expected).sort(), "unexpected fixture file");
  }
  assert.equal(manifest.cases.filter(x => x.outcome === "accept").length, 3);
  assert.equal(manifest.cases.filter(x => x.outcome === "reject").length, 9);
}

test("canonical ADT nominal/ownership source inventory is pinned, not certified", () => {
  verify(readManifest());
});

test("manifest rejects fake parity, duplicate cases, and path substitution", () => {
  for (const mutate of [
    x => { x.executableParityCertified = true; },
    x => { x.confirmedBackends = ["java"]; },
    x => { x.cases[0].confirmedBackends = ["llvm"]; },
    x => { x.cases[0].executableParityCertified = true; },
    x => { x.cases[1].id = x.cases[0].id; },
    x => { x.cases[0].file = "../escape.atto"; },
    x => { x.cases[0].gitBlobSha1 = "0".repeat(40); },
    x => { x.cases[0].outcome = "reject"; },
  ]) {
    const mutated = structuredClone(readManifest());
    mutate(mutated);
    assert.throws(() => verify(mutated));
  }
});
