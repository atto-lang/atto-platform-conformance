import test from "node:test";
import assert from "node:assert/strict";
import {loadHeadSnapshot,validateHeadSnapshot} from "../src/head-snapshot.mjs";
import {loadCandidateInventory,loadCompatibilityCandidate} from "../src/compatibility-release.mjs";
const snapshot=loadHeadSnapshot(),candidate=loadCompatibilityCandidate(),inventory=loadCandidateInventory();
const changed=f=>{const x=structuredClone(snapshot);f(x);return x};
test("56 snapshots correspond to all candidate pins and remain non-promotable",()=>{
 const r=validateHeadSnapshot(snapshot,candidate,inventory);
 assert.equal(r.entries,56);assert.equal(r.exactMain,34);
 assert.equal(r.recordedAncestors,22);assert.equal(r.remotesRecheckedByThisCommand,false);
 assert.equal(r.releaseReady,false);
});
test("unknown or substituted repository ID denied",()=>{
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.repositories[0].repositoryId="999"),candidate,inventory),/identity/);
});
test("reordered repository denied",()=>{
 assert.throws(()=>validateHeadSnapshot(changed(s=>{[s.repositories[0],s.repositories[1]]=[s.repositories[1],s.repositories[0]]}),candidate,inventory),/identity/);
});
test("stale candidate ID denied",()=>{
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.candidateId="unrelated"),candidate,inventory),/invalid provenance/);
});
test("invented compatibility status denied",()=>{
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.compatibility="VERIFIED"),candidate,inventory),/invalid provenance/);
});
test("export allowance denied",()=>{
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.sourceExport="ALLOWED"),candidate,inventory),/invalid provenance/);
});
test("falsified exact pin equality refused",()=>{
 const i=snapshot.repositories.findIndex(x=>x.relation==="ANCESTOR_OF_MAIN");
 assert.ok(i>=0);
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.repositories[i].relation="EXACT_MAIN"),candidate,inventory),/false exact|inconsistent ancestor/);
});
test("falsified ancestor on equal ref refused",()=>{
 const i=snapshot.repositories.findIndex(x=>x.relation==="EXACT_MAIN");
 assert.ok(i>=0);
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.repositories[i].relation="ANCESTOR_OF_MAIN"),candidate,inventory),/false exact/);
});
test("missing entry or extra metadata denied",()=>{
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.repositories.pop()),candidate,inventory),/invalid provenance/);
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.repositories[0].passed=true),candidate,inventory),/unexpected or missing/);
});
test("invalid observed SHA denied",()=>{
 assert.throws(()=>validateHeadSnapshot(changed(s=>s.repositories[0].observedMainSha="HEAD"),candidate,inventory),/identity/);
});
