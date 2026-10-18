import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMlSourceLock} from '../src/ml-source-lock.mjs';
const repos=["oreslang-autograd", "oreslang-ml", "oreslang-tensor"];
const edgeList=[["oreslang-autograd", "oreslang-tensor"],["oreslang-ml", "oreslang-autograd"]];
const files={};
for (const [r,n] of [["oreslang-autograd",6],["oreslang-ml",4],["oreslang-tensor",4]])
 for (let i=0;i<n;i++) files[r+"/src/file_"+i+".ores"] = String(i).repeat(40);
const lock={schemaVersion:1,kind:"PINNED_SOURCE_BLOBS_NOT_GUEST",organization:"ores-truffle-oreslang",
 expectedSourceFiles:14,expectedImports:52,requiredCrossRepositoryEdges:edgeList,
 sourceBlobs:files,sourceExportAuthorized:false,guestExecution:false,releaseReady:false};
const registry={repositories:repos.map(name=>({name,upstreams:name==="oreslang-ml"?["oreslang-tensor","oreslang-autograd"]:
 name==="oreslang-autograd"?["oreslang-tensor"]:[]}))};
const copy=x=>structuredClone(x);
test("static planned graph cannot promote a guest run",()=>{const v=validateMlSourceLock(lock,registry);assert.equal(v.files,14);assert.equal(v.importDeclarations,52);assert.equal(v.guestExecuted,false);});
test("reject guest promotion",()=>assert.throws(()=>validateMlSourceLock({...lock,guestExecution:true},registry),/false source/));
test("reject source-export permission",()=>assert.throws(()=>validateMlSourceLock({...lock,sourceExportAuthorized:true},registry),/false source/));
test("reject missing owner edge",()=>{const r=copy(registry);r.repositories.find(x=>x.name==="oreslang-ml").upstreams=[];assert.throws(()=>validateMlSourceLock(lock,r),/owning edge/);});
test("reject unexpected fourth provider edge",()=>{const l=copy(lock);l.requiredCrossRepositoryEdges.push(["oreslang-tensor","oreslang-ml"]);assert.throws(()=>validateMlSourceLock(l,registry),/topology/);});
test("reject missing Git file",()=>{const l=copy(lock);delete l.sourceBlobs[Object.keys(l.sourceBlobs)[0]];assert.throws(()=>validateMlSourceLock(l,registry),/incomplete/);});
test("reject path traversal",()=>{const l=copy(lock);const [k,v]=Object.entries(l.sourceBlobs)[0];delete l.sourceBlobs[k];l.sourceBlobs["oreslang-autograd/src/../../private.ores"]=v;assert.throws(()=>validateMlSourceLock(l,registry),/untrusted/);});
test("reject malformed blob identifier",()=>{const l=copy(lock);l.sourceBlobs[Object.keys(l.sourceBlobs)[0]]="HEAD";assert.throws(()=>validateMlSourceLock(l,registry),/untrusted/);});
test("reject extra unknown metadata",()=>assert.throws(()=>validateMlSourceLock({...lock,verified:true},registry),/false source/));
test("reject numeric schema confusion",()=>assert.throws(()=>validateMlSourceLock({...lock,schemaVersion:true},registry),/false source/));
test("reject missing producer",()=>{const r=copy(registry);r.repositories.pop();assert.throws(()=>validateMlSourceLock(lock,r),/owning edge/);});
