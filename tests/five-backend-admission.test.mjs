import test from "node:test";
import assert from "node:assert/strict";
import {runSuite} from "../src/harness.mjs";

const sourceSha = "012345678901234567890123456789abcdefabcd";
const command = [process.execPath, "{file}"];

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


function fakeCompiler(exitCode, diagnostic = "error: unknown nonexistent_symbol") {
  return (_executable, args) => {
    const negative = args.at(-1).endsWith("/unresolved-identifier.ores");
    return {
      status: negative ? exitCode : 0,
      signal: null,
      stdout: "",
      stderr: negative ? diagnostic : "",
    };
  };
}

test("compiler diagnostic is accepted only at semantic rejection exit 1", async () => {
  for (const code of [0, 2, 3, 126, 127, 255, -9]) {
    const result = await runSuite({
      backend: "llvm", argv: command, sourceSha,
      spawn: fakeCompiler(code),
    });
    const negative = result.results.find(x => x.id === "unresolved-identifier");
    assert.equal(negative.status, code<0?"INVALID_EXIT_STATUS":"MISMATCH", `exit code ${code} must not verify rejection`);
    assert.equal(result.ok, false);
  }
  const genuine = await runSuite({
    backend: "llvm", argv: command, sourceSha,
    spawn: fakeCompiler(1),
  });
  assertCoverage(genuine,"llvm",()=> "VERIFIED");
});

test("a crash quoting the expected symbol is not a negative compiler proof", async () => {
  for (const failure of [
    "fatal signal: error: nonexistent_symbol unknown",
    "unhandled exception: error: nonexistent_symbol unknown",
    "segmentation fault: error: nonexistent_symbol unknown",
    "traceback: error: nonexistent_symbol unknown",
  ]) {
    const result = await runSuite({
      backend: "java", argv: command, sourceSha,
      spawn: fakeCompiler(1, failure),
    });
    assert.equal(result.results.find(x=>x.id==="unresolved-identifier").status,"MISMATCH",failure);
    assertCoverage(result,"java",id=>id==="unresolved-identifier"?"MISMATCH":"VERIFIED");
  }
});

test("all six source backends require real case outcomes; uncovered browser never creates proof", async () => {
  for (const backend of ["java","llvm","net","forge","wasm","js"]) {
    const report=await runSuite({backend,argv:command,sourceSha,spawn:fakeCompiler(1)});
    assertCoverage(report,backend,()=> "VERIFIED");
    assert.equal(report.runtimeVerified,false,backend);
    const unconfigured=await runSuite({backend});
    assert.equal(unconfigured.ok,false,backend);
  }
  const report=await runSuite({backend:"browser",argv:command,sourceSha,
    spawn(){throw Error("no compiler can run without a matching case")}});
  assert.equal(report.coverage,"NO_CASES");
  assert.equal(report.verified,0);
  assert.equal(report.ok,false);
  assert.deepEqual(report.results,[]);
  const discovery=await runSuite({backend:"browser",requireConfigured:false});
  assert.equal(discovery.ok,false);
  assert.equal(discovery.coverage,"NO_CASES");
  await assert.rejects(runSuite({backend:"invented",argv:command,sourceSha}),/unknown backend/);
});
