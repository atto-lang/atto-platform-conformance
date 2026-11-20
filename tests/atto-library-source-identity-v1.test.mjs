import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {validateAttoLibrarySources,checkLocalAttoLibrarySnapshot,
  compareClaimedBackendBlobs,gitBlobId} from "../lib/atto-library-source-identity-v1.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const manifest=JSON.parse(readFileSync(resolve(root,"contracts/atto-library-source-v1.json"),"utf8"));
const obs=()=>manifest.backendBindings.map((b,index)=>({
 backend:b.backend,repository:b.repository,path:b.path,head:(index+1).toString(16).repeat(40),
 tree:(index+6).toString(16).repeat(40),gitBlob:manifest.coreNumeric.gitBlob,
 classification:"GITHUB_SOURCE_BLOB_CLAIM_ONLY"
}));

test("local canonical .atto numeric Git blob is pinned (source-only)",()=>{
 assert.equal(validateAttoLibrarySources(manifest),true);
 assert.deepEqual(checkLocalAttoLibrarySnapshot(manifest,root),{
  classification:"LOCAL_SOURCE_SNAPSHOT_ONLY",gitBlob:manifest.coreNumeric.gitBlob,
  guestExecution:"NOT_EXECUTED"});
 const bytes=readFileSync(resolve(root,manifest.coreNumeric.snapshot));
 assert.equal(gitBlobId(bytes),manifest.coreNumeric.gitBlob);
 const changed=Buffer.from(bytes);changed[0]^=1;
 assert.notEqual(gitBlobId(changed),manifest.coreNumeric.gitBlob);
 assert.throws(()=>gitBlobId("not raw bytes"),/byte Buffer/);
});

test("five claimed backend blobs never become guest execution evidence",()=>{
 const result=compareClaimedBackendBlobs(manifest,obs());
 assert.equal(result.classification,"UNVERIFIED_FIVE_BACKEND_SOURCE_CLAIMS");
 assert.equal(result.backends,5);
 assert.equal(result.guestExecution,"NOT_EXECUTED");
});

test("tampering with claimed origin, IDs or evidence fails closed",()=>{
 const cases=[
  x=>x[0].gitBlob="f".repeat(40),
  x=>x[0].path="../untrusted/numeric.atto",
  x=>x[0].head="short",
  x=>x[0].tree="bogus",
  x=>x[0].classification="GUEST_PASS",
  x=>x[0].runnerId=1,
  x=>x[0].backend="forge",
  x=>x[0].repository="attacker/private",
 ];
 for(const mutate of cases){const x=obs();mutate(x);assert.throws(
   ()=>compareClaimedBackendBlobs(manifest,x));}
 assert.throws(()=>compareClaimedBackendBlobs(manifest,obs().slice(1)));
});
test("source manifest cannot silently promote a backend or relax binding",()=>{
 const modifications=[
  m=>m.evidence.guestExecution="PASS",
  m=>m.evidence.compilerBinary="PASS",
  m=>m.coreNumeric.gitBlob="f".repeat(40),
  m=>m.backendBindings[0].path="src/main/resources/dev/oreslang/core/numeric.ores",
  m=>m.backendBindings[3].stage="EXECUTED",
  m=>m.allocCandidates[0].status="FIVE_BACKEND_PASS",
  m=>m.canonicalSuffix=".ores"
 ];
 for(const change of modifications){
   const m=structuredClone(manifest);change(m);
   assert.throws(()=>validateAttoLibrarySources(m));
 }
});
