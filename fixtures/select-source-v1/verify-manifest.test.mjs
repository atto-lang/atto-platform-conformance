import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "./verify-manifest.mjs";

const root = dirname(fileURLToPath(import.meta.url));
test("all select sources match pinned Git blob SHAs without claiming execution", () => {
  assert.equal(verify(root).count, 8);
});
test("source mutation and path traversal both fail closed", () => {
  const tmp = mkdtempSync(join(tmpdir(), "atto-select-v1-"));
  try {
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    for (const c of manifest.cases) copyFileSync(join(root, c.path), join(tmp, c.path));
    writeFileSync(join(tmp, "manifest.json"), JSON.stringify(manifest));
    assert.equal(verify(tmp).count, 8);
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
