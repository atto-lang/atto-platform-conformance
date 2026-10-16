import test from "node:test";
import assert from "node:assert/strict";
import {runSuite} from "../src/harness.mjs";

const sourceSha = "012345678901234567890123456789abcdefabcd";
const command = [process.execPath, "{file}"];

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
    assert.equal(negative.status, "MISMATCH", `exit code ${code} must not verify rejection`);
    assert.equal(result.ok, false);
  }
  const genuine = await runSuite({
    backend: "llvm", argv: command, sourceSha,
    spawn: fakeCompiler(1),
  });
  assert.equal(genuine.verified, 2);
  assert.equal(genuine.ok, true);
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
    assert.equal(result.results.at(-1).status, "MISMATCH", failure);
  }
});

test("all five source backends are recognized but absent cases never create proof", async () => {
  for (const backend of ["net", "forge", "wasm", "browser"]) {
    const report = await runSuite({
      backend, argv: command, sourceSha,
      spawn() { throw Error("no compiler can run without a matching case"); },
    });
    assert.equal(report.coverage, "NO_CASES");
    assert.equal(report.verified, 0);
    assert.equal(report.ok, false);
    assert.deepEqual(report.results, []);
    const discovery = await runSuite({backend, requireConfigured: false});
    assert.equal(discovery.ok, false);
    assert.equal(discovery.coverage, "NO_CASES");
  }
  await assert.rejects(runSuite({backend:"invented",argv:command,sourceSha}), /unknown backend/);
});
