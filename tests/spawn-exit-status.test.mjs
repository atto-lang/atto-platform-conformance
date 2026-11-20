import test from "node:test";
import assert from "node:assert/strict";
import {runSuite} from "../src/harness.mjs";

const sourceSha = "012345678901234567890123456789abcdefabcd";
const argv = [process.execPath, "{file}"];

test("missing exit status cannot masquerade as a successful negative-compiler test", async () => {
  const r = await runSuite({
    backend: "java", argv, sourceSha,
    spawn: () => ({status: null, signal: null, stdout: "", stderr: "error: nonexistent_symbol"})
  });
  assert.equal(r.ok, false);
  assert.equal(r.verified, 0);
  assert.equal(r.failed, r.results.length);
  assert.ok(r.results.length > 0);
  assert.deepEqual(new Set(r.results.map(x => x.status)), new Set(["INVALID_EXIT_STATUS"]));
});

test("negative or noninteger exit status is rejected even with expected diagnostic", async () => {
  for (const status of [-1, NaN, "1", undefined]) {
    const r = await runSuite({
      backend: "llvm", argv, sourceSha,
      spawn: () => ({status, signal: null, stdout: "", stderr: "error: nonexistent_symbol"})
    });
    assert.equal(r.verified, 0);
    assert.equal(r.ok, false);
    assert.ok(r.results.length > 0);
    assert.deepEqual(new Set(r.results.map(x => x.status)), new Set(["INVALID_EXIT_STATUS"]));
  }
});

test("real nonzero integer exit with explicit unresolved-name diagnostic remains valid", async () => {
  const r = await runSuite({
    backend: "forge", argv, sourceSha,
    spawn: () => ({status: 1, signal: null, stdout: "", stderr: "error: unresolved identifier nonexistent_symbol"})
  });
  assert.equal(r.ok, false);
  assert.equal(r.verified, 1);
  assert.equal(r.failed, r.results.length - 1);
  const unresolved = r.results.find(x => x.id === "unresolved-identifier");
  assert.ok(unresolved, "missing unresolved-identifier fixture");
  assert.equal(unresolved.status, "VERIFIED");
  assert.deepEqual(
    new Set(r.results.filter(x => x.id !== "unresolved-identifier").map(x => x.status)),
    new Set(["MISMATCH"])
  );
});
