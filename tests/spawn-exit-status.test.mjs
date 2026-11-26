import test from "node:test";
import assert from "node:assert/strict";
import {runSuite} from "../src/harness.mjs";

const sourceSha = "012345678901234567890123456789abcdefabcd";
const argv = [process.execPath, "{file}"];

const unsupportedIds = ["generator-sync","generator-async","generator-suspend"];
function assertCoverage(report,backend,expected) {
  const byId=new Map(report.results.map(x=>[x.id,x]));
  const admitted=["int-arithmetic","unresolved-identifier",...(backend==="js"?[]:["liveview-revision-order"])];
  assert.equal(byId.size,report.results.length,"duplicate fixture result");
  assert.deepEqual([...byId.keys()].sort(),[...admitted,...unsupportedIds].sort());
  for(const id of unsupportedIds) {
    const row=byId.get(id);
    assert.equal(row.status,"UNSUPPORTED",id);
    assert.equal(row.exitCode,null,id);
    assert.equal(row.executableSha256Before,null,id);
    assert.equal(row.executableSha256After,null,id);
    assert.equal(row.executableResolvedPathBefore,null,id);
    assert.equal(row.executableResolvedPathAfter,null,id);
  }
  for(const id of admitted) assert.equal(byId.get(id).status,expected(id),id);
  assert.equal(report.unsupported,3);
  assert.equal(report.verified,admitted.filter(id=>expected(id)==="VERIFIED").length);
  assert.equal(report.failed,report.results.length-report.verified);
  assert.equal(report.ok,false,"unsupported fixtures must keep overall gate red");
}


test("missing exit status cannot masquerade as a successful negative-compiler test", async () => {
  const r = await runSuite({
    backend: "java", argv, sourceSha,
    spawn: () => ({status: null, signal: null, stdout: "", stderr: "error: nonexistent_symbol"})
  });
  assert.equal(r.ok, false);
  assert.equal(r.verified, 0);
  assert.equal(r.failed, r.results.length);
  assert.ok(r.results.length > 0);
  assertCoverage(r,"java",()=> "INVALID_EXIT_STATUS");
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
    assertCoverage(r,"llvm",()=> "INVALID_EXIT_STATUS");
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
  assertCoverage(r,"forge",id=>id==="unresolved-identifier"?"VERIFIED":"MISMATCH");
});
