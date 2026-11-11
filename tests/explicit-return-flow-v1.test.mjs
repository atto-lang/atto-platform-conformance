import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "contracts/v3/atto-explicit-return-flow-v1.json");
const fixtures = path.join(root, "fixtures/explicit-return-flow-v1");
const backends = ["java", "llvm", "net", "wasm", "forge", "cranelift"];

const pinned = Object.freeze({
  "nonvoid-all-branches": ["1be5798959c3ba4e682d0701cd4b424b95cb9eaa", "accept", 1],
  "void-fallthrough": ["30d0745a2b2095f1992b6f91c68ed28bbf6a6ac7", "accept", 0],
  "braceless-lambda-value": ["76d78382f8766553a064e279f9c374ff29aa35e2", "accept", 2],
  "braced-lambda-return": ["7a23265c28e5957491f4a53d8fd739530d8f898b", "accept", 2],
  "nonvoid-no-return": ["0a62c35d2fe6b6b13e77dec7066cc87bbfc600a6", "reject", "missing-explicit-return"],
  "nonvoid-bare-return": ["b864775dbd7c93d90de39cd6bf223cb498094ace", "reject", "missing-return-value"],
  "void-valued-return": ["2565d745022507525802981b7481a776493c6d19", "reject", "void-valued-return"],
  "braced-lambda-fallthrough": ["a315f657a79ea211a9600d0616e2017a1c9dd6df", "reject", "braced-lambda-missing-return"],
  "nested-lambda-no-outer-return": ["7d1e307df616e463cfdb8f541f808fde75874fa2", "reject", "outer-missing-return"],
  "single-branch-return": ["c2b5ef9e4395925c40416e1c3bea784891329e55", "reject", "branch-missing-return"],
});

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function verify(data, onDisk = true) {
  assert.deepEqual(Object.keys(data).sort(), [
    "version", "status", "semantics", "targetBackends", "confirmedBackends",
    "executableParityCertified", "cases"
  ].sort());
  assert.equal(data.version, "atto-explicit-return-flow-v1");
  assert.equal(data.status, "contract-only-not-executed");
  assert.deepEqual(data.targetBackends, backends);
  assert.deepEqual(data.confirmedBackends, []);
  assert.equal(data.executableParityCertified, false);
  assert.deepEqual(Object.keys(data.semantics).sort(), [
    "nonVoidFunctions", "voidFunctions", "bracelessLambda",
    "bracedLambda", "nestedLambda"
  ].sort());
  assert.match(data.semantics.nonVoidFunctions, /explicit return/);
  assert.match(data.semantics.voidFunctions, /fallthrough allowed/);
  assert.match(data.semantics.bracelessLambda, /without explicit return/);
  assert.match(data.semantics.bracedLambda, /explicit return required/);
  assert.match(data.semantics.nestedLambda, /does not satisfy enclosing function/);
  assert.ok(Array.isArray(data.cases) && data.cases.length === 10);
  const ids = new Set();
  const names = new Set();
  for (const c of data.cases) {
    assert.equal(typeof c.id, "string");
    assert.match(c.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(c.id), "duplicate contract case");
    ids.add(c.id);
    assert.equal(c.file, c.id + ".atto");
    assert.ok(!names.has(c.file));
    names.add(c.file);
    assert.match(c.gitBlobSha1, /^[0-9a-f]{40}$/);
    assert.deepEqual(c.confirmedBackends, []);
    assert.equal(c.executableParityCertified, false);
    const expected = pinned[c.id];
    assert.ok(expected, "unknown return case");
    assert.equal(c.gitBlobSha1, expected[0]);
    assert.equal(c.outcome, expected[1]);
    assert.deepEqual(Object.keys(c).sort(), (c.outcome === "accept" ? [
      "id", "file", "gitBlobSha1", "outcome", "expectedExitCode",
      "confirmedBackends", "executableParityCertified"
    ] : [
      "id", "file", "gitBlobSha1", "outcome", "rejectKind",
      "confirmedBackends", "executableParityCertified"
    ]).sort());
    if (c.outcome === "accept") assert.equal(c.expectedExitCode, expected[2]);
    else assert.equal(c.rejectKind, expected[2]);
    if (onDisk) {
      const name = path.join(fixtures, c.file);
      const before = fs.lstatSync(name, { bigint: true });
      assert.ok(before.isFile() && !before.isSymbolicLink() &&
        before.nlink === 1n, "fixture must be a singly linked plain file");
      const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let bytes;
      try {
        const st = fs.fstatSync(fd, { bigint: true });
        assert.equal(st.ino, before.ino);
        assert.equal(st.dev, before.dev);
        assert.ok(st.size > 0n && st.size < 16384n);
        bytes = fs.readFileSync(fd);
        const after = fs.fstatSync(fd, { bigint: true });
        assert.equal(after.size, st.size);
        assert.equal(after.mtimeNs, st.mtimeNs);
        assert.equal(after.ctimeNs, st.ctimeNs);
      } finally { fs.closeSync(fd); }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      assert.ok(!text.includes("\0"));
      assert.match(text, /fnc main/);
      const digest = createHash("sha1")
        .update("blob " + bytes.length + "\0").update(bytes).digest("hex");
      assert.equal(digest, c.gitBlobSha1, "fixture Git blob does not match");
    }
  }
  assert.deepEqual([...ids].sort(), Object.keys(pinned).sort());
  if (onDisk)
    assert.deepEqual(fs.readdirSync(fixtures).sort(),
      [...names].sort(), "extra fixture slipped into manifest");
  assert.equal(data.cases.filter(x => x.outcome === "accept").length, 4);
  assert.equal(data.cases.filter(x => x.outcome === "reject").length, 6);
}

test("canonical explicit return and lambda-exception fixtures are pinned, not certified", () => {
  verify(readManifest());
});
test("reject falsified evidence, path substitution, and expected-outcome mutation", () => {
  const mutate = [
    x => { x.executableParityCertified = true; },
    x => { x.confirmedBackends = ["llvm"]; },
    x => { x.cases[0].confirmedBackends = ["net"]; },
    x => { x.cases[0].executableParityCertified = true; },
    x => { x.cases[0].gitBlobSha1 = "0".repeat(40); },
    x => { x.cases[0].id = "../escape"; },
    x => { x.cases[1].id = x.cases[0].id; },
    x => { x.cases[0].outcome = "reject"; },
    x => { x.cases[0].expectedExitCode = 99; },
    x => { x.cases[0].unreviewedCert = true; },
    x => { x.semantics.bracelessLambda = "explicit return required"; },
  ];
  for (const change of mutate) {
    const x = structuredClone(readManifest());
    change(x);
    assert.throws(() => verify(x, false));
  }
});
