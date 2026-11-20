import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, readFileSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const script = fileURLToPath(new URL("../bin/verify-error-pattern-matrix.mjs", import.meta.url));

function invoke(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8", timeout: 15_000
  });
}

test("100 error matching cases are unique, categorized, and unverified", () => {
  const run = invoke();
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.compilerExecuted, false);
  assert.equal(report.cases, 100);
  assert.equal(report.accept, 55);
  assert.equal(report.reject, 45);
  assert.deepEqual(report.categories, {
    order: 20, guards: 10, open: 15, fallback: 15,
    result: 20, interface: 10, complement: 10
  });
});

test("materialization produces 100 source files with matching SHA-256 receipts", () => {
  const parent = mkdtempSync(join(tmpdir(), "ores-error-pattern-"));
  const destination = join(parent, "source");
  try {
    const run = invoke("--materialize=" + destination);
    assert.equal(run.status, 0, run.stderr);
    const entries = readdirSync(destination);
    assert.equal(entries.filter(x => x.endsWith(".ores")).length, 100);
    const index = JSON.parse(readFileSync(join(destination, "index.json"), "utf8"));
    assert.equal(index.compilerExecution, false);
    assert.equal(index.cases.length, 100);
    for (const item of index.cases) {
      const bytes = readFileSync(join(destination, item.file));
      const digest = createHash("sha256").update(bytes).digest("hex");
      assert.equal(digest, item.sha256, item.id);
      assert.equal(bytes.includes(Buffer.from("match value over")), true, item.id);
    }
    const repeated = invoke("--materialize=" + destination);
    assert.notEqual(repeated.status, 0, "must refuse to overwrite an existing source directory");
  } finally {
    rmSync(parent, {recursive: true, force: true});
  }
});

test("unknown arguments, relative destinations and root writes fail closed", () => {
  for (const flag of ["--wrong", "--materialize=relative", "--materialize=/"]) {
    const run = invoke(flag);
    assert.notEqual(run.status, 0, "unexpectedly admitted " + flag);
  }
});
