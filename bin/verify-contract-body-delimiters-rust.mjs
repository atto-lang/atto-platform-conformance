#!/usr/bin/env node
// Rust/Wasm adapter. This is a parity gate, not a syntax model.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
const compiler = resolve(process.argv[2] || "");
assert.ok(process.argv[2] && existsSync(compiler), "usage: verify-contract-body-delimiters-rust.mjs <attoc>");
const manifest = JSON.parse(readFileSync(new URL("../lib/contract-body-delimiter-corpus-v1.json", import.meta.url), "utf8"));
assert.equal(manifest.schema, "atto.contract-body-delimiters.v1");
assert.equal(new Set(manifest.cases.map(c=>c.id)).size, manifest.cases.length);
const digest = b => createHash("sha256").update(b).digest("hex");
console.log("COMPILER_SHA256", digest(readFileSync(compiler)));
const dir = mkdtempSync(join(tmpdir(), "atto-contract-"));
let passed=0, failed=0;
function run(c) {
  assert.match(c.id, /^[a-z0-9-]+$/);
  const input=join(dir,c.id+".atto"), output=join(dir,c.id+".wasm");
  writeFileSync(input,c.source);
  assert.ok(!existsSync(output));
  const r=spawnSync(compiler,[input,"-o",output],{cwd:dir,encoding:"utf8",timeout:30000,maxBuffer:2**20});
  if(r.error || r.signal || r.status===null) throw Error("compiler infrastructure failure: "+(r.error||r.signal));
  const diagnostic=r.stdout+"\n"+r.stderr;
  if(c.stage==="execute") {
    assert.equal(r.status,0,diagnostic);
    assert.ok(existsSync(output),"missing guest");
    const bytes=readFileSync(output), module=new WebAssembly.Module(bytes);
    assert.deepEqual(WebAssembly.Module.imports(module),[]);
    const instance=new WebAssembly.Instance(module,{});
    assert.equal(typeof instance.exports.main,"function");
    const actual=instance.exports.main();
    assert.ok(typeof actual==="bigint" ? actual===BigInt(c.expected.value) : actual===c.expected.value,"wrong guest result");
    if(instance.exports.panic_code) assert.equal(instance.exports.panic_code.value,0);
    return digest(bytes);
  }
  assert.equal(c.stage,"reject");
  assert.notEqual(r.status,0,"unexpected acceptance");
  assert.ok(!existsSync(output),"rejected source emitted an artifact");
  // Do not treat a profile-level unsupported diagnostic as proof of the intended denial.
  assert.ok(!/E_UNSUPPORTED|not supported|unsupported/i.test(diagnostic), diagnostic);
  const pattern=c.expected.category==="syntax" ? /E_SYNTAX|E_EOF|E_PARSE|E_LEX/ : /E_(?:PRECONDITION|CONTRACT_PRECONDITION|REFINEMENT_PRECONDITION)/;
  assert.match(diagnostic,pattern);
  return "artifact-free";
}
try {
  // A real compiler must first accept an ordinary known-good guest.
  run({id:"control",stage:"execute",source:"pub fnc main() -> int { return 42; }",expected:{value:42}});
  console.log("CONTROL_PASS");
  for(const c of manifest.cases) {
    try {const receipt=run(c);passed++;console.log("PASS",c.id,digest(c.source),receipt);}
    catch(e) {failed++;console.error("FAIL",c.id,digest(c.source),String(e).slice(0,1500));}
  }
  console.log("CONTRACT_PARITY",passed,failed,manifest.cases.length);
  if(failed) process.exitCode=1;
} finally {rmSync(dir,{recursive:true,force:true});}
