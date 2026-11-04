import assert from "node:assert/strict";
import {readFileSync,readdirSync,lstatSync} from "node:fs";
import {createHash} from "node:crypto";
import {resolve} from "node:path";

// Host-only contract checks. Neither these assertions nor a Git blob hash prove guest execution.
export const ENUM_BACKENDS=Object.freeze(["java","llvm","wasm","net","forge"]);
export const ENUM_CASE_COUNT=36;

export function validateEnumManifest(m) {
 assert.deepEqual(Object.keys(m).sort(),["backends","cases","executableParityCertified","schemaVersion","scope"].sort());
 assert.equal(m.schemaVersion,1);
 assert.equal(m.scope,"nominal-enum-source-v1");
 assert.equal(m.executableParityCertified,false);
 assert.deepEqual(m.backends,ENUM_BACKENDS);
 assert.ok(Array.isArray(m.cases));
 assert.equal(m.cases.length,ENUM_CASE_COUNT);
 const ids=new Set(),files=new Set(),rules=new Set(),hashes=new Set(),kinds=new Set();
 for(const c of m.cases) {
  assert.ok(c!==null&&typeof c==="object"&&!Array.isArray(c));
  assert.match(c.id,/^[a-z0-9-]{1,80}$/);
  assert.equal(c.file,c.id+".ores","fixture filename must be tied to manifest identity");
  assert.equal(ids.has(c.id),false,"duplicate id: "+c.id);ids.add(c.id);
  assert.equal(files.has(c.file),false,"duplicate file: "+c.file);files.add(c.file);
  assert.match(c.rule,/^[a-z0-9-]{1,100}$/);
  assert.equal(rules.has(c.rule),false,"duplicate rule: "+c.rule);rules.add(c.rule);
  assert.ok(c.expect==="accept"||c.expect==="reject");kinds.add(c.expect);
  assert.deepEqual(c.backends,ENUM_BACKENDS);
  assert.deepEqual(c.confirmedBackends,[],"authentic compiler evidence is required before certification");
  assert.match(c.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  assert.equal(hashes.has(c.sourceGitBlobSha1),false,"fixture blobs must be distinct");
  hashes.add(c.sourceGitBlobSha1);
  const keys=["backends","confirmedBackends","expect","file","id","rule","sourceGitBlobSha1"];
  if(c.expect==="reject") {
   assert.match(c.diagnosticCategory,/^[A-Z][A-Z0-9_]{3,60}$/);
   keys.push("diagnosticCategory");
  } else {
   assert.match(c.expectedStdout,/^(?:-?[0-9]+\n)+$/);
   keys.push("expectedStdout");
  }
  assert.deepEqual(Object.keys(c).sort(),keys.sort(),"unknown or missing case fields");
 }
 assert.deepEqual(kinds,new Set(["accept","reject"]));
}

export function validateEnumFiles(root,m) {
 validateEnumManifest(m);
 const dir=resolve(root,"fixtures/enum/v1");
 assert.deepEqual(readdirSync(dir).sort(),m.cases.map(c=>c.file).sort(),
  "every fixture must be inventoried, no extras or hidden files");
 for(const c of m.cases) {
  const file=resolve(dir,c.file),stat=lstatSync(file);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size>0&&stat.size<=1048576);
  const bytes=readFileSync(file),content=bytes.toString("utf8");
  assert.ok(Buffer.from(content,"utf8").equals(bytes),"fixture is not canonical UTF-8");
  const sha=createHash("sha1").update("blob "+bytes.length+String.fromCharCode(0))
   .update(bytes).digest("hex");
  assert.equal(sha,c.sourceGitBlobSha1,c.file+" drifted");
  if(!["option-partial-bool","option-result-partitions","option-partial-int","result-partial-bool","unreachable-after-bool-partition"].includes(c.id))
   assert.ok(content.includes("define enum "),"missing user enum declaration: "+c.id);
 }
}
