import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
const dir=fileURLToPath(new URL("../fixtures/value-pipe-tuples-v1/",import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,"contract.json"),"utf8"));
function gitBlob(input){const b=Buffer.from(input);return createHash("sha1").update(Buffer.concat([Buffer.from("blob "+b.length+"\\0".replace("\\0","\0")),b])).digest("hex");}
test("source-only fixture byte identity, NOT guest execution",()=>{
 assert.equal(manifest.schema,"atto.conformance.value-pipe-tuples/v1");
 assert.equal(manifest.negative.length,4);
 assert.equal(manifest.positive.stdout,"39\n");
 for(const fixture of [manifest.positive,...manifest.negative]){
   assert.match(fixture.path,/^(?:negative\/)?[a-z0-9-]+\.atto$/);
   assert.equal(gitBlob(fs.readFileSync(path.join(dir,fixture.path))),fixture.git_blob_sha1);
 }
});
test("positive source uses named stages and tuple lambdas",()=>{
 const source=fs.readFileSync(path.join(dir,manifest.positive.path),"utf8");
 assert.match(source,/\|> validate/);
 assert.match(source,/\|> \|users, x, y\|/);
 assert.match(source,/\|> \|sorted, a, b\|/);
 assert.match(source,/Tuple\[int, int\]/);
});
