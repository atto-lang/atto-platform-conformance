import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

// CONTRACT/INVENTORY TEST ONLY: this does not launch an Oreslang compiler,
// check ownership diagnostics, or provide native guest execution receipts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "contracts/immutable-default-v1.json");
const canonical = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const five = ["java", "llvm", "wasm", "net", "forge"];
const optional = ["cranelift"];

function validate(data, verifyFiles = true) {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.contract, "ores.immutable-default/v1");
  assert.equal(data.status, "authored-fixtures-only-NOT-executed");
  assert.deepEqual(data.backends, five);
  assert.deepEqual(data.optionalBackends, optional);
  assert.deepEqual(Object.keys(data.backendCapabilities).sort(), [...five, ...optional].sort());
  for (const state of Object.values(data.backendCapabilities)) {
    assert.match(state, /^(candidate-on-unverified-draft|llvm-frontend-delegated-guest-not-verified|native-i64-draft-unverified|shipping-parser-unsupported)$/);
  }
  assert.ok(Array.isArray(data.cases));
  assert.equal(data.cases.length, 32);
  const ids = new Set(), files = new Set();
  let accept = 0, reject = 0, trap = 0;
  for (const [index, entry] of data.cases.entries()) {
    assert.equal(entry.id, `IDB-${String(index + 1).padStart(2, "0")}`);
    assert.ok(!ids.has(entry.id), "duplicate case ID");
    ids.add(entry.id);
    assert.match(entry.file, /^fixtures\/immutable-default\/v1\/[a-z0-9-]+\.ores$/);
    assert.ok(!files.has(entry.file), "duplicate source file");
    files.add(entry.file);
    assert.ok(["accept", "reject", "runtime-trap"].includes(entry.expect));
    assert.equal(typeof entry.oracle, "string");
    assert.ok(entry.oracle.length >= 1 && entry.oracle.length <= 80);
    assert.equal(typeof entry.source, "string");
    assert.ok(entry.source.length > 15 && entry.source.length <= 4096);
    assert.match(entry.source, /^fnc main(\(\)|\(int x\)): int \{ /);
    assert.ok(entry.source.endsWith("}\n"));
    if (entry.expect === "accept") {
      accept++;
      assert.match(entry.oracle, /^-?[0-9]+$/);
    } else if (entry.expect === "reject") {
      reject++;
      assert.match(entry.oracle, /^[a-z][a-z0-9-]+$/);
    } else {
      trap++;
      assert.equal(entry.oracle, "checked-i64-overflow");
    }
    if (verifyFiles) {
      const resolved = path.resolve(root, entry.file);
      assert.ok(resolved.startsWith(root + path.sep), "path confinement");
      const stat = fs.lstatSync(resolved);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), "regular source file");
      assert.equal(stat.nlink, 1, "no hardlinked source fixture");
      assert.equal(fs.readFileSync(resolved, "utf8"), entry.source, "source bytes must match pinned manifest");
    }
  }
  assert.equal(accept, 12);
  assert.equal(reject, 19);
  assert.equal(trap, 1);
}

test("immutable default corpus: five backend targets, 32 exact native Oreslang files", () => {
  validate(canonical);
});

test("immutable default corpus: mutation controls are rejected", () => {
  function mutation(name, change) {
    const data = structuredClone(canonical);
    change(data);
    assert.throws(() => validate(data, false), name);
  }
  mutation("claimed executable evidence", d => { d.status = "verified"; });
  mutation("backend substituted", d => { d.backends[0] = "cranelift"; });
  mutation("Forge missing", d => { d.backends.pop(); });
  mutation("Cranelift falsely promoted", d => { d.optionalBackends = []; });
  mutation("Forge falsely certified", d => { d.backendCapabilities.forge = "passed"; });
  mutation("unknown backend capacity", d => { d.backendCapabilities.llvm = "passed"; });
  mutation("deleted case", d => { d.cases.pop(); });
  mutation("duplicate case", d => { d.cases[1].id = d.cases[0].id; });
  mutation("duplicate path", d => { d.cases[1].file = d.cases[0].file; });
  mutation("path escape", d => { d.cases[0].file = "../secret.ores"; });
  mutation("wrong source syntax", d => { d.cases[0].source = "unrelated"; });
  mutation("false expected pass", d => { d.cases[6].expect = "accept"; });
  mutation("lost diagnostic oracle", d => { d.cases[6].oracle = ""; });
  mutation("trap reclassified as success", d => { d.cases[16].expect = "accept"; });
  mutation("mismatched schema", d => { d.schemaVersion = 2; });
  mutation("unknown backend", d => { d.backendCapabilities.extra = "native-i64-draft-unverified"; });
  mutation("unsafe fixture path", d => { d.cases[0].file = "fixtures/immutable-default/v1/../typed-default.ores"; });
});
