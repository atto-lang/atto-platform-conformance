import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";

const root=dirname(fileURLToPath(import.meta.url));
function gitBlobSha(bytes) {
  const header=Buffer.concat([Buffer.from("blob "+bytes.length),Buffer.from([0])]);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

test("receiver-arity fixtures are exact, distinct, and cover both declaration orders",()=>{
  const raw=readFileSync(join(root,"manifest.json"));
  const manifest=JSON.parse(raw.toString("utf8"));
  assert.equal(manifest.schema,"oreslang-receiver-arity-v1");
  assert.equal(manifest.status,"normative-target-not-execution-evidence");
  assert.deepEqual(manifest.requiredBackends,["java","llvm","wasm","net","forge"]);
  assert.equal(manifest.cases.length,9);
  const ids=new Set(),paths=new Set();
  const counts={accept:0,reject:0};
  for(const entry of manifest.cases) {
    assert.match(entry.id,/^[a-z][a-z0-9-]+$/);
    assert.match(entry.path,/^fixtures\/[a-z0-9-]+\.ores$/);
    assert.equal(ids.has(entry.id),false,"duplicate case id");
    assert.equal(paths.has(entry.path),false,"duplicate fixture path");
    ids.add(entry.id);paths.add(entry.path);
    const source=readFileSync(join(root,entry.path));
    assert.equal(gitBlobSha(source),entry.gitBlobSha,
      "Git blob changed without updating manifest: "+entry.id);
    assert.ok(source.length>0&&source.length<1048576);
    assert.match(source.toString("utf8"),/^define (?:class|actor) /);
    assert.ok(entry.scope==="class"||entry.scope==="actor");
    if(entry.expect==="accept") {
      counts.accept++;
      assert.equal(entry.expectedInt,42);
      assert.equal(entry.diagnosticClass,undefined);
    }else {
      counts.reject++;
      assert.equal(entry.expect,"reject");
      assert.equal(entry.diagnosticClass,"duplicate-method-slot");
      assert.match(entry.slot,/^x\/[01]$/);
      assert.equal(entry.expectedInt,undefined);
    }
  }
  assert.deepEqual(counts,{accept:4,reject:5});
  for(const arity of [0,1]) for(const order of ["implicit-then-mut","mut-then-implicit"]) {
    assert.ok(ids.has("class-"+(arity===0?"zero":"one")+"-"+order+"-reject"));
  }
});
