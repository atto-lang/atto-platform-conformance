import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const path = u => fileURLToPath(new URL(u,import.meta.url));
const evidence=JSON.parse(readFileSync(path("../evidence/atto-core-identity-stage1-20261107.json"),"utf8"));
const bytes=readFileSync(path("../fixtures/atto-library-source/v1/identity.atto"));
function blob(input){
 return createHash("sha1").update(Buffer.from("blob "+input.length+"\0"))
   .update(input).digest("hex");
}
test("canonical compiler-owned Core identity bytes match exact Git blob",()=>{
 assert.equal(blob(bytes),evidence.git_blob_sha1);
 assert.match(bytes.toString("utf8"),/define module identity as/);
 assert.match(bytes.toString("utf8"),/pub fnc passthrough\(int value\)/);
 const declarations=bytes.toString("utf8").split("\n")
   .filter(line=>!line.trimStart().startsWith("//")).join("\n");
 assert.doesNotMatch(declarations,/\bimport\b|\batto\.alloc\b|\batto\.std\b|\bactor\b/);
});
test("two stage-1 compiler branches refer to one exact canonical source blob",()=>{
 assert.equal(evidence.schema_version,1);
 assert.equal(evidence.backends.length,2);
 assert.equal(new Set(evidence.backends.map(x=>x.repository)).size,2);
 assert.deepEqual(new Set(evidence.backends.map(x=>x.backend)),
    new Set(["net-nativeaot","forge-stage1-native"]));
 for(const backend of evidence.backends){
  assert.match(backend.head,/^[0-9a-f]{40}$/);
  assert.equal(backend.source_blob,blob(bytes));
  assert.equal(backend.compiler_implementation,"AUTHORED_UNEXECUTED");
 }
});
test("stage-1 provenance does not upgrade source evidence to compiler parity",()=>{
 assert.equal(evidence.guest_status,"NOT_EXECUTED");
 assert.equal(evidence.source_evidence_class,"SOURCE_ONLY");
 assert.deepEqual(evidence.not_yet_qualified,["java-graalvm","llvm","wasm"]);
 assert.equal(evidence.full_numeric_module,"NOT_IMPLEMENTED_IN_STAGE1");
 assert.ok(evidence.required_before_parity.includes("independent review"));
});
test("mutating even one canonical source byte invalidates its Git blob",()=>{
 const mutant=Buffer.from(bytes);
 const i=mutant.indexOf(Buffer.from("return value;"));
 assert.notEqual(i,-1);
 mutant[i]=mutant[i]===114?82:114;
 assert.notEqual(blob(mutant),evidence.git_blob_sha1);
});
test("different source syntax must not be mistaken for stage-1 execution",()=>{
 const fake=Buffer.from("pub fnc passthrough(int value): int { return value; }\n");
 assert.notEqual(blob(fake),evidence.git_blob_sha1);
 assert.equal(evidence.required_before_parity.length,4);
});
