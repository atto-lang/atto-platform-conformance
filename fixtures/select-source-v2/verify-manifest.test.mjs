import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "./verify-manifest.mjs";

const root = dirname(fileURLToPath(import.meta.url));
test("all select sources match pinned Git blob SHAs without claiming execution", () => {
  assert.equal(verify(root).count, 36);
});
test("source mutation and path traversal both fail closed", () => {
  const tmp = mkdtempSync(join(tmpdir(), "atto-select-v2-"));
  try {
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    for (const c of manifest.cases) copyFileSync(join(root, c.path), join(tmp, c.path));
    writeFileSync(join(tmp, "manifest.json"), JSON.stringify(manifest));
    assert.equal(verify(tmp).count, 36);
    const target = join(tmp, manifest.cases[0].path);
    writeFileSync(target, readFileSync(target, "utf8") + " // unauthorized edit");
    assert.throws(() => verify(tmp), /blob drift/);
    copyFileSync(join(root, manifest.cases[0].path), target);
    manifest.cases[0].path = "../outside.atto";
    writeFileSync(join(tmp, "manifest.json"), JSON.stringify(manifest));
    assert.throws(() => verify(tmp), /AssertionError/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("backend omission and fabricated evidence fail closed", () => {
  const tmp = mkdtempSync(join(tmpdir(), "atto-select-matrix-"));
  try {
    const original = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    for (const c of original.cases) copyFileSync(join(root, c.path), join(tmp, c.path));
    const m = structuredClone(original);
    delete m.cases[0].expected.hdl;
    writeFileSync(join(tmp, "manifest.json"), JSON.stringify(m));
    assert.throws(() => verify(tmp));
    const falsePass = structuredClone(original);
    falsePass.cases[0].evidenceStatus = "passed";
    writeFileSync(join(tmp, "manifest.json"), JSON.stringify(falsePass));
    assert.throws(() => verify(tmp), /cannot claim execution evidence/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("undeclared receipts, identity substitution and symlink fixtures fail closed", () => {
  const tmp = mkdtempSync(join(tmpdir(), "atto-select-strict-"));
  try {
    const original = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    for (const c of original.cases) copyFileSync(join(root, c.path), join(tmp, c.path));
    const write = m => writeFileSync(join(tmp, "manifest.json"), JSON.stringify(m));
    const mutations = [
      m => { m.receipt = {passed: true}; },
      m => { m.cases[0].receipt = {passed: true}; },
      m => { m.cases[0].expected.llvm.receipt = {passed: true}; },
      m => { m.cases.find(c => c.target).target.receipt = {passed: true}; },
      m => { m.cases[0].id = "substituted-identity"; },
    ];
    for (const mutate of mutations) {
      const m = structuredClone(original);
      mutate(m); write(m);
      assert.throws(() => verify(tmp), /undeclared field|ID\/path mismatch/);
    }
    write(original);
    const path = original.cases[0].path;
    unlinkSync(join(tmp, path));
    symlinkSync(join(root, path), join(tmp, path));
    assert.throws(() => verify(tmp), /regular file/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
