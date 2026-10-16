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
  assert.equal(r.failed, 2);
  assert.deepEqual(r.results.map(x => x.status), ["MISMATCH", "INVALID_EXIT_STATUS"]);
});

test("negative or noninteger exit status is rejected even with expected diagnostic", async () => {
  for (const status of [-1, NaN, "1", undefined]) {
    const r = await runSuite({
      backend: "llvm", argv, sourceSha,
      spawn: () => ({status, signal: null, stdout: "", stderr: "error: nonexistent_symbol"})
    });
    assert.equal(r.verified, 0);
    assert.equal(r.ok, false);
    assert.equal(r.results[1].status, "INVALID_EXIT_STATUS");
  }
});

test("real nonzero integer exit with expected compile-time diagnostic remains valid", async () => {
  const r = await runSuite({
    backend: "forge", argv, sourceSha,
    spawn: () => ({status: 1, signal: null, stdout: "", stderr: "error: nonexistent_symbol"})
  });
  assert.equal(r.verified, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.results[1].status, "VERIFIED");
});
