import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const from = p => readFileSync(fileURLToPath(new URL(p, import.meta.url)));
const evidence = JSON.parse(from("../evidence/atto-core-numeric-stage2-20261107.json"));
const library = from("../fixtures/atto-library-source/v1/numeric.atto");
const entry = from("../fixtures/atto-library-source/v1/numeric-entry.atto");
const gitBlob = bytes => createHash("sha1").update(
 Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
test("canonical numeric library and guest source are byte-identical to pinned Git objects",()=>{
 assert.equal(gitBlob(library),evidence.canonical_library.git_blob_sha1);
 assert.equal(gitBlob(entry),evidence.canonical_entry.git_blob_sha1);
 const source=library.toString("utf8");
 for(const fnc of ["min_int","max_int","clamp_int"])
  assert.match(source,new RegExp("pub fnc "+fnc+"\\("));
 assert.match(source,/if lower > upper; do/);
 assert.match(source,/if value < lower; do/);
 assert.match(source,/if value > upper; do/);
 assert.match(entry.toString("utf8"),/numeric\.clamp_int\(50,0,42\)/);
});
test("no two-backend source equivalence claim is promoted to guest evidence",()=>{
 assert.equal(evidence.schema_version,1);
 assert.equal(evidence.backends.length,2);
 assert.equal(evidence.evidence_class,"SOURCE_ONLY");
 assert.equal(evidence.guest_status,"NOT_EXECUTED");
 assert.equal(evidence.independent_review,"NOT_OBSERVED");
 assert.equal(evidence.forge_harness,"HOSTED_CXX_NOT_FREESTANDING");
 assert.equal(evidence.host_imports,"NOT_VERIFIED");
 assert.deepEqual(evidence.not_yet_qualified,["java-graalvm","llvm","wasm"]);
 for (const b of evidence.backends) {
  assert.match(b.head,/^[0-9a-f]{40}$/);
  assert.equal(b.library_blob,gitBlob(library));
  assert.equal(b.entry_blob,gitBlob(entry));
  assert.equal(b.execution,"AUTHORED_UNEXECUTED");
 }
});
test("source mutations never preserve the canonical numeric Git identity",()=>{
 for(const target of [library,entry]){
  for(const position of [0,Math.floor(target.length/2),target.length-1]){
   const mutated=Buffer.from(target);
   mutated[position]^=1;
   assert.notEqual(gitBlob(mutated),gitBlob(target));
  }
 }
});
function reference(op,args){
 const a=args.map(BigInt);
 if(op==="min")return a[0]<a[1]?a[0]:a[1];
 if(op==="max")return a[0]>a[1]?a[0]:a[1];
 if(op==="clamp") {
  if(a[1]>a[2])return a[1];
  if(a[0]<a[1])return a[1];
  if(a[0]>a[2])return a[2];
  return a[0];
 }
 throw new Error("unknown pure source model");
}
test("pure canonical numeric branch model covers boundaries and reversed bounds",()=>{
 const raw=[
 ["min",[40,42],"40"],["min",[42,40],"40"],["min",[42,42],"42"],
 ["min",[-1,1],"-1"],["min",[-900,0],"-900"],
 ["min",["-9223372036854775808","9223372036854775807"],"-9223372036854775808"],
 ["max",[40,42],"42"],["max",[42,40],"42"],["max",[42,42],"42"],
 ["max",[-1,1],"1"],["max",[-900,0],"0"],
 ["max",["-9223372036854775808","9223372036854775807"],"9223372036854775807"],
 ["clamp",[50,0,42],"42"],["clamp",[-10,0,42],"0"],
 ["clamp",[20,0,42],"20"],["clamp",[0,0,42],"0"],["clamp",[42,0,42],"42"],
 ["clamp",[2,10,5],"10"],["clamp",[5,5,5],"5"],
 ["clamp",[0,0,0],"0"],["clamp",[-100,-50,50],"-50"],
 ["clamp",[100,-50,50],"50"],
 ["clamp",["9223372036854775807","-9223372036854775808","9223372036854775807"],"9223372036854775807"],
 ["clamp",["-9223372036854775808","-9223372036854775808","9223372036854775807"],"-9223372036854775808"]
 ];
 for(const [op,args,expected] of raw)
  assert.equal(reference(op,args).toString(),expected,op+" "+args);
 assert.equal(raw.length,24);
});
test("negative namespace spellings cannot be mistaken for compiler-owned numeric source",()=>{
 for (const invalid of [
  "atto.core/numeric/", "atto.core/numeric//", "atto.core/../numeric",
  "atto.core/missing", "atto.alloc/numeric", "atto.std/numeric",
  "atto.runtime.actor/numeric", "./numeric.atto"
 ]) assert.notEqual(invalid,"atto.core/numeric");
});
