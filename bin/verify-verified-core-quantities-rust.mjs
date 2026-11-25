import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandQuantityCases } from "../lib/verified-core-quantity-expansion.mjs";

const [compilerPath] = process.argv.slice(2);
if (!compilerPath || process.argv.length !== 3)
  throw new Error("Usage: node bin/verify-verified-core-quantities-rust.mjs <built attoc>");
const compiler = resolve(compilerPath);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const original = fileURLToPath(new URL("../fixtures/verified-core-quantities-v1/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(original, "cases.json"), "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.profile, "verified-core-quantities-v1");
const work = mkdtempSync(join(tmpdir(), "atto-quantity-rust-"));
const results = [];
const codes = {integerOverflow:1, divisionByZero:2};
try {
  const {fixtures,cases} = expandQuantityCases(original, work, manifest);
  for (const {source,expected} of cases) {
    assert.match(source, /^[a-z0-9-]+\.atto$/);
    const input = join(fixtures, source);
    const output = join(work, source + ".wasm");
    const sourceBytes = readFileSync(input);
    const build = spawnSync(compiler, [input, "-o", output], {cwd:work, encoding:"utf8",timeout:30000,maxBuffer:1024*1024});
    if (build.error) throw build.error;
    assert.equal(build.signal, null, source);
    if (expected.kind === "diagnostic") {
      assert.notEqual(build.status, 0, source);
      assert.ok(build.stderr.includes(expected.category + ":"), source + ": " + build.stderr);
      assert.equal(existsSync(output), false, source + " published rejected artifact");
      results.push({source,sourceSha256:sha(sourceBytes),observed:expected});
    } else {
      assert.equal(build.status, 0, source + ": " + build.stderr);
      const bytes = readFileSync(output);
      const module = new WebAssembly.Module(bytes);
      assert.deepEqual(WebAssembly.Module.imports(module), [], source + " unexpected guest imports");
      const instance = new WebAssembly.Instance(module, {});
      assert.equal(instance.exports.panic_code.value, 0, source);
      if (expected.kind === "value") {
        assert.equal(instance.exports.main(), BigInt(expected.decimal), source);
        assert.equal(instance.exports.panic_code.value, 0, source);
      } else {
        assert.equal(expected.kind, "arithmeticFailure", source);
        assert.ok(Object.hasOwn(codes, expected.category), source);
        assert.throws(() => instance.exports.main(), WebAssembly.RuntimeError, source);
        assert.equal(instance.exports.panic_code.value, codes[expected.category], source);
      }
      results.push({source,sourceSha256:sha(sourceBytes),artifactSha256:sha(bytes),observed:expected});
    }
    console.log("PASS rust " + source + " " + expected.kind);
  }
  // Local observations, not an authenticated CI receipt. A promotion gate
  // must independently bind the compiler build to its exact checkout/tree.
  console.log(JSON.stringify({scope:"local-compiler-wasm-guest-observations",compilerSha256:sha(readFileSync(compiler)),results}));
  console.log("verified " + results.length + " cases through the actual Rust compiler and Wasm guest");
} finally {
  rmSync(work,{recursive:true,force:true});
}
