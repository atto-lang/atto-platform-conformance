import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyAttoScalar19CandidateManifest} from "../scripts/verify-atto-scalar19-candidates.mjs";
const file=new URL("../contracts/atto-source-v1/scalar-19-candidates.json",import.meta.url);
function temp(t){
 const folder=mkdtempSync(join(tmpdir(),"atto-5-lanes-"));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const path=join(folder,"candidates.json");
 const raw=readFileSync(file,"utf8");
 writeFileSync(path,raw);
 return {path,manifest:JSON.parse(raw)};
}
function write(f){writeFileSync(f.path,JSON.stringify(f.manifest,null,2)+"\n");}
test("five pinned candidacies cannot certify executable parity",()=>{
 assert.deepEqual(verifyAttoScalar19CandidateManifest(),{
   candidates:5,cases:19,sourceIdentityOnly:true,guestsExecuted:0
 });
});
test("missing Forge candidate denied",t=>{
 const f=temp(t);f.manifest.backend_candidates.pop();write(f);
 assert.throws(()=>verifyAttoScalar19CandidateManifest(f.path),/five independently/);
});
test("Forge cannot be swapped with independent Cranelift",t=>{
 const f=temp(t);f.manifest.backend_candidates[4].repository="ores-truffle-oreslang/oreslang-source.cranelift";write(f);
 assert.throws(()=>verifyAttoScalar19CandidateManifest(f.path),/candidate identity/);
});
test("older backend head cannot masquerade as exact new head",t=>{
 const f=temp(t);f.manifest.backend_candidates[1].head_sha="0".repeat(40);write(f);
 assert.throws(()=>verifyAttoScalar19CandidateManifest(f.path),/candidate identity/);
});
test("status promotion without actual job evidence forbidden",t=>{
 const f=temp(t);f.manifest.backend_candidates[0].status="PASSED";write(f);
 assert.throws(()=>verifyAttoScalar19CandidateManifest(f.path),/candidate identity/);
});
test("common-source manifest substitution forbidden",t=>{
 const f=temp(t);f.manifest.common_source.manifest_blob_sha1="f".repeat(40);write(f);
 assert.throws(()=>verifyAttoScalar19CandidateManifest(f.path),/evidence\/corpus/);
});
test("false certifiedParity flag forbidden",t=>{
 const f=temp(t);f.manifest.certified_parity=true;write(f);
 assert.throws(()=>verifyAttoScalar19CandidateManifest(f.path),/evidence\/corpus/);
});
test("duplicate JSON keys cannot override fail-closed status",t=>{
 const f=temp(t);
 writeFileSync(f.path,readFileSync(f.path,"utf8").replace('"guest_evidence": "NOT_EXECUTED",',
  '"guest_evidence": "PASSED",\n  "guest_evidence": "NOT_EXECUTED",'));
 assert.throws(()=>verifyAttoScalar19CandidateManifest(f.path),/noncanonical or duplicate/);
});
