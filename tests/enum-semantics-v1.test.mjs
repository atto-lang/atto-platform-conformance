import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,lstatSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const m=JSON.parse(readFileSync(resolve(root,"contracts/enum-semantics-v1.json"),"utf8"));
const backends=["java","llvm","wasm","net","forge"];
test("enum fixture inventory is closed and has no fabricated backend confirmations",()=>{
 assert.equal(m.schemaVersion,1);
 assert.equal(m.scope,"nominal-enum-source-v1");
 assert.equal(m.executableParityCertified,false);
 assert.deepEqual(m.backends,backends);
 assert.equal(m.cases.length,14);
 const ids=new Set(),files=new Set(),rules=new Set(),kinds=new Set();
 for(const c of m.cases){
  assert.match(c.id,/^[a-z0-9-]{1,80}$/);
  assert.equal(ids.has(c.id),false);ids.add(c.id);
  assert.match(c.file,/^[a-z0-9-]{1,80}[.]ores$/);
  assert.equal(files.has(c.file),false);files.add(c.file);
  assert.equal(rules.has(c.rule),false);rules.add(c.rule);
  assert.ok(c.expect==="accept"||c.expect==="reject");kinds.add(c.expect);
  assert.deepEqual(c.backends,backends);
  assert.deepEqual(c.confirmedBackends,[]);
  assert.match(c.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  if(c.expect==="reject"){
   assert.match(c.diagnosticCategory,/^[A-Z][A-Z0-9_]{3,60}$/);
   assert.equal("expectedStdout" in c,false);
  }else{
   assert.equal("diagnosticCategory" in c,false);
   assert.match(c.expectedStdout,/^(?:[0-9]+\n)+$/);
  }
 }
 assert.deepEqual(kinds,new Set(["accept","reject"]));
});
test("enum fixture bytes are Git-blob pinned regular files",()=>{
 for(const c of m.cases){
  const file=resolve(root,"fixtures/enum/v1",c.file);
  const stat=lstatSync(file);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size>0&&stat.size<=1048576);
  const bytes=readFileSync(file);
  const sha=createHash("sha1").update("blob "+bytes.length+String.fromCharCode(0)).update(bytes).digest("hex");
  assert.equal(sha,c.sourceGitBlobSha1,c.file+" drifted");
  assert.ok(bytes.toString("utf8").includes("define enum "));
 }
});
