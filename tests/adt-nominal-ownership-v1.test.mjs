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

const pinnedCases = Object.freeze({
  "nullary-value": ["b57697ffa7b71eac77e87a2762e865f4639c81dc", "accept", "true\n"],
  "payload-exhaustive": ["8a6a20fbfbe84ae4ad18c6c893b2a82a555cba2d", "accept", "7\n"],
  "nested-owner": ["4df72420fd83b1fe09332d42876d89a59107a518", "accept", "true\n"],
  "duplicate-tag": ["792fd44c429e50a8577123f9fecc678efdec9d71", "reject", "duplicate-tag"],
  "duplicate-case": ["2b596409374bb3d93fcbf78cb641ce0f9fee4fea", "reject", "duplicate-case"],
  "foreign-case-pattern": ["4bbe50455ebd633602be3a14dd3744a23799e728", "reject", "foreign-owner"],
  "wrong-payload-type": ["6445603141b14ac9bcadd15f7693f26056e79de6", "reject", "payload-type"],
  "nullary-extra-argument": ["7554587bb3b85e1d20f4c356a5c5cec83a50ae9d", "reject", "constructor-arity"],
  "nonexhaustive": ["26b90b015f0b027dd51cc4428baae75682398f19", "reject", "exhaustiveness"],
  "guarded-not-exhaustive": ["abafa14100a5fd5f72ef8098cfabf5a0905f8112", "reject", "guarded-coverage"],
  "direct-unboxed-recursion": ["8e5238183a0e94584a82ad7552980fbd869e06d1", "reject", "unboxed-cycle"],
  "double-move-nominal": ["51ad0d61a3e0b5b875b509aeb79d7609c19f6b60", "reject", "move-after-move"]
});

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
    const pinned = pinnedCases[item.id];
    assert.ok(pinned, "unknown nominal ADT corpus case");
    assert.equal(item.gitBlobSha1, pinned[0], "manifest pin changed");
    assert.equal(item.outcome, pinned[1], "expected result category changed");
    assert.equal(item.outcome === "accept" ? item.expectedStdout : item.rejectKind,
      pinned[2], "expected result payload changed");
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
  assert.deepEqual(Array.from(ids).sort(), Object.keys(pinnedCases).sort());
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
    x => { x.cases[0].gitBlobSha1 = x.cases[1].gitBlobSha1; },
    x => { x.cases[0].expectedStdout = "false\\n"; },
  ]) {
    const mutated = structuredClone(readManifest());
    mutate(mutated);
    assert.throws(() => verify(mutated));
  }
});
