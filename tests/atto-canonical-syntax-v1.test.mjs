import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {BACKENDS,CASE_IDS,validateAttoSyntaxManifest} from "../lib/atto-canonical-syntax-v1.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const baseline=JSON.parse(readFileSync(resolve(root,"contracts/atto-canonical-syntax-v1.json"),"utf8"));
test("24 pinned guest candidates, zero backend certifications",()=>{
 assert.equal(CASE_IDS.length,24);
 assert.deepEqual(baseline.backends,BACKENDS);
 assert.deepEqual(validateAttoSyntaxManifest(baseline,root),[]);
});
test("manifest mutations fail closed",()=>{
 const mutations=[
  m=>m.status="PASS",
  m=>m.executableParityCertified=true,
  m=>m.backendEvidence.java="PASS",
  m=>m.backends.pop(),
  m=>m.cases[0].confirmedBackends.push("java"),
  m=>m.cases[0].expectedExitCode=0,
  m=>m.cases[12].noGuestArtifactOnReject=false,
  m=>m.cases[12].diagnosticCategory="",
  m=>m.cases.pop(),
  m=>m.cases.reverse(),
  m=>m.cases[0].id="../escape",
  m=>m.cases[0].file="../escape.atto",
  m=>m.cases[0].sourceGitBlobSha1="0".repeat(40),
  m=>m.cases[0].unexpected="PASS"
 ];
 for(const mutate of mutations){const m=structuredClone(baseline);mutate(m);assert.ok(validateAttoSyntaxManifest(m,root).length)}
});
test("malformed manifest and negative artifact gates",()=>{
 for(const x of [null,[],{},false])assert.ok(validateAttoSyntaxManifest(x,root).length);
 for(const c of baseline.cases.filter(c=>c.expect==="reject")){assert.equal(c.noGuestArtifactOnReject,true);assert.match(c.diagnosticCategory,/^[A-Z][A-Z0-9_]+$/)}
});
