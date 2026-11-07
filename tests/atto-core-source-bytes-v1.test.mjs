import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const read = relative => readFileSync(fileURLToPath(new URL(relative, import.meta.url)));
const blob = data => createHash("sha1")
  .update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");
const fixture = [
  ["identity", "../fixtures/atto-library-source/v1/identity.atto"],
  ["identity entry", "../fixtures/atto-library-source/v1/identity-entry.atto"],
  ["numeric", "../fixtures/atto-library-source/v1/numeric.atto"],
  ["numeric entry", "../fixtures/atto-library-source/v1/numeric-entry.atto"]
];
test("LF-only checkout policy covers all canonical AttoLang source",()=>{
 const attrs = read("../.gitattributes").toString("utf8");
 assert.match(attrs,/^\*\.atto text eol=lf$/m);
 assert.match(attrs,/^\*\.ores text eol=lf$/m);
});
test("canonical Core resources and examples are valid LF-only UTF-8 byte streams",()=>{
 for(const [label,path] of fixture) {
  const data = read(path);
  assert.ok(data.length>0,label);
  assert.equal(data.includes(0),false,label+" NUL");
  assert.equal(data.includes(13),false,label+" CR");
  assert.equal(data.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])),false,label+" BOM");
  assert.equal(data[data.length-1],10,label+" final LF");
 }
});
test("CRLF substitution invalidates all four exact source Git blobs",()=>{
 for(const [label,path] of fixture) {
  const data = read(path);
  const mutated=Buffer.from(data.toString("utf8").replaceAll("\n","\r\n"),"utf8");
  assert.notEqual(blob(mutated),blob(data),label);
 }
});
test("canonical and entry source IDs agree with both versioned evidence ledgers",()=>{
 const identity=JSON.parse(read("../evidence/atto-core-identity-stage1-20261107.json"));
 const numeric=JSON.parse(read("../evidence/atto-core-numeric-stage2-20261107.json"));
 assert.equal(blob(read(fixture[0][1])),identity.git_blob_sha1);
 assert.equal(blob(read(fixture[1][1])),identity.entry_git_blob_sha1);
 assert.equal(blob(read(fixture[2][1])),numeric.canonical_library.git_blob_sha1);
 assert.equal(blob(read(fixture[3][1])),numeric.canonical_entry.git_blob_sha1);
 for(const ledger of [identity,numeric]) {
  assert.equal(ledger.guest_status,"NOT_EXECUTED");
  assert.equal(ledger.backends.length,2);
 }
});
