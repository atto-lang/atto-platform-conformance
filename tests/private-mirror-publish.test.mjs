import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";
import {source,destination,fixture as authorizedFixture,good as authorizedGood} from "./private-ci-authorization-fixture.mjs";

const A="a".repeat(40),B="c".repeat(40),C="5e5201f1b1618f87282bf41ce89ca710404cce95",
 D="d".repeat(40),E="e".repeat(40),M="f".repeat(40);
const opts={source,destination,sourceCommit:A,sourceTree:D,destinationBaseCommit:B,
  prefix:"snapshots/checked",newBranch:"ci/private-test-proof",
  approvedDestinations:[destination],token:"restricted-test-token"};
const good=authorizedGood;
const encoded=text=>({type:"file",encoding:"base64",sha:createHash("sha1").update("blob "+Buffer.byteLength(text)+"\0").update(text).digest("hex"),
  content:Buffer.from(text).toString("base64")});

function fixture({sourceTree,destinationTree,materializedTree,sourceBlobContent="NDI7Cg==",blobSha=C,refSha=E,meta,errors,mainBranch,baseCommit,createdCommit}={}){
  const events=[],seen={source:0,destination:0};
  const admissionRequest=authorizedFixture();
  const request=async(url,options)=>{
    const method=options.method,path=url.replace(/^https:\/\/api.github.com\/repos\//,"");
    events.push({path,method,body:options.body?JSON.parse(options.body):undefined});
    // Incident, review and policy metadata come from the shared exact-pinned
    // synthetic admission fixture; publisher-specific Git objects below remain mock-only.
    if(path.startsWith("ores-truffle-oreslang/oreslang-platform-conformance/issues/"))
      return admissionRequest(url,options);
    if(path===destination+"/branches/main"&&typeof mainBranch==="function"){
      const authorized=await admissionRequest(url,options);
      return {status:200,json:async()=>mainBranch(await authorized.json())};
    }
    const src=path===source||path.startsWith(source+"/"),name=src?source:destination;
    if(path===name){
      seen[src?"source":"destination"]++;
      const custom=meta?.(name,seen[src?"source":"destination"]);
      return{status:200,json:async()=>custom||good(name)};
    }
    const suffix=path.slice(name.length);
    if(errors?.[suffix])return{status:403,json:async()=>({message:"Bearer opaque-test-token"})};
    let data;
    if(src){
      if(suffix==="/git/commits/"+A)data={sha:A,tree:{sha:D}};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data=sourceTree||{truncated:false,tree:[{type:"blob",path:"main.ores",sha:C,size:4,mode:"100644"}]};
      else if(suffix==="/git/blobs/"+C)
        data={sha:C,encoding:"base64",content:sourceBlobContent,size:4};
    } else {
      if(suffix==="/git/commits/"+B)data=baseCommit||{sha:B,tree:{sha:E}};
      else if(suffix==="/git/commits/"+E)data=createdCommit||{sha:E,tree:{sha:D},parents:[{sha:B}]};
      else if(suffix==="/git/trees/"+E+"?recursive=1")
        data=destinationTree||{truncated:false,tree:[{path:"unrelated/readme.txt",type:"blob"}]};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data=materializedTree||{truncated:false,tree:[
          {path:"snapshots",type:"tree"},
          {path:"snapshots/checked",type:"tree"},
          {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C}
        ]};
      else if(suffix==="/git/blobs"&&method==="POST")
        data={sha:blobSha};
      else if(suffix==="/git/trees"&&method==="POST")
        data={sha:D};
      else if(suffix==="/git/commits"&&method==="POST")
        data={sha:E};
      else if(suffix==="/git/refs"&&method==="POST")
        data={ref:options.body?JSON.parse(options.body).ref:undefined,object:{sha:refSha}};
      else if(suffix==="/git/ref/heads/"+opts.newBranch&&method==="GET")
        data={ref:"refs/heads/"+opts.newBranch,object:{sha:refSha}};
    }
    if(!data)return admissionRequest(url,options);
    return{status:method==="POST"?201:200,json:async()=>data};
  };
  return{request,events,seen};
}
const run=(t={},overrides={})=>{
 const h=fixture(t);
 return {h,promise:publishPrivateMirror({...opts,fetchImpl:h.request,...overrides})};
};
test("real destination Git-object publisher guards every write and only creates a new CI ref",async()=>{
 const {h,promise}=run();
 const receipt=await promise;
 assert.deepEqual(receipt,{status:"PRIVATE_MIRROR_PUBLISHED",destination,
  newBranch:opts.newBranch,sourceCommit:A,commit:E,blobs:1});
 const writes=h.events.filter(x=>x.method==="POST");
 assert.deepEqual(writes.map(x=>x.path),[
  destination+"/git/blobs",destination+"/git/trees",
  destination+"/git/commits",destination+"/git/refs"]);
 const ref=writes.at(-1).body.ref;
 assert.equal(ref,"refs/heads/ci/private-test-proof");
 assert.deepEqual(writes[1].body.tree,[{
  path:"snapshots/checked/main.ores",mode:"100644",type:"blob",sha:C}]);
 assert.ok(h.seen.source>=5&&h.seen.destination>=5,"reverify before every write");
 assert.ok(h.events.some(e=>e.path===destination+"/git/ref/heads/"+opts.newBranch),
   "verify CI ref persisted with pinned SHA");
});
test("destination base commit must equal protected carrier main before source blob reads",async()=>{
 for(const destBase of ["b".repeat(40),"f".repeat(40)]){
  const {h,promise}=run({}, {destinationBaseCommit:destBase});
  await assert.rejects(promise,/destination base commit differs from protected carrier main/);
  assert.equal(h.events.some(e=>e.path.includes("/git/blobs/")),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("destination main drift before first private object write denies publication",async()=>{
 // An admission probe passes the approved base, then a later recheck sees
 // a different commit. All requests are mock-only and never export source.
 let mainReads=0;
 const {h,promise}=run({mainBranch:(original)=>{
   mainReads++;
   return mainReads>=4?{...original,commit:{sha:"f".repeat(40)}}:original;
 }});
 await assert.rejects(promise,/destination base commit differs from protected carrier main|source-main policy content|carrier policy/);
 assert.ok(mainReads>=4);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
});
test("carrier main drift after one blob write prevents tree, commit and ref publication",async()=>{
 let mainReads=0;
 const {h,promise}=run({mainBranch:(original)=>{
   mainReads++;
   return mainReads>=7?{...original,commit:{sha:"f".repeat(40)}}:original;
 }});
 await assert.rejects(promise);
 assert.ok(mainReads>=7);
 const posts=h.events.filter(e=>e.method==="POST").map(e=>e.path);
 assert.deepEqual(posts,[destination+"/git/blobs"],
   "a dangling blob may be written, but no tree, commit or ref may be published");
});
test("trailing-dot and mixed-case lock suffix branch refs fail before contacting GitHub",async()=>{
 for(const newBranch of ["ci/private-probe.","ci/private-probe.LOCK","ci/private-probe.Lock"]){
  const {h,promise}=run({}, {newBranch});
  await assert.rejects(promise,/invalid destination prefix or isolated CI branch/);
  assert.equal(h.events.length,0);
 }
});
test("destination base commit response must attest the exact protected main commit",async()=>{
 for(const baseCommit of [
  {sha:"f".repeat(40),tree:{sha:E}},
  {sha:B,tree:{sha:"untrusted"}}
 ]){
  const {h,promise}=run({baseCommit});
  await assert.rejects(promise,/destination base commit\/tree differs from protected immutable commit/);
  assert.equal(h.events.some(e=>e.path.includes("/git/blobs/")),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("new immutable commit must read back exact tree and approved parent before ref publication",async()=>{
 for(const createdCommit of [
  {sha:"f".repeat(40),tree:{sha:D},parents:[{sha:B}]},
  {sha:E,tree:{sha:"f".repeat(40)},parents:[{sha:B}]},
  {sha:E,tree:{sha:D},parents:[]},
  {sha:E,tree:{sha:D},parents:[{sha:"f".repeat(40)}]},
  {sha:E,tree:{sha:D},parents:[{sha:B},{sha:B}]}
 ]){
  const {h,promise}=run({createdCommit});
  await assert.rejects(promise,/destination committed tree or immutable parent differs/);
  const posts=h.events.filter(e=>e.method==="POST").map(e=>e.path);
  assert.deepEqual(posts,[destination+"/git/blobs",destination+"/git/trees",destination+"/git/commits"]);
  assert.equal(h.events.some(e=>e.path===destination+"/git/refs"),false);
 }
});
test("public destinations fail BEFORE fetching private source or writing anything",async()=>{
 const {h,promise}=run({meta:(name)=>name===destination?{...good(name),private:false,visibility:"public"}:good(name)});
 await assert.rejects(promise,/writable verified PRIVATE/);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 assert.equal(h.events.some(e=>e.path.includes("/git/")),false);
});
test("missing approvals and unsafe ref/path reject without contacting GitHub",async()=>{
 for(const override of [
  {approvedDestinations:[]},{token:undefined},
  {newBranch:"main"},{newBranch:"ci/my-public-copy"},
  {prefix:"../src"},{prefix:"src/../../other"},
  {sourceCommit:"not-a-sha"}
 ]){
  const {h,promise}=run({},override);
  await assert.rejects(promise);
  assert.equal(h.events.length,0);
 }
});
test("untrusted source tree types and truncated trees never cause destination writes",async()=>{
 for(const tree of [
  {truncated:true,tree:[]},
  {truncated:false,tree:[{type:"blob",path:"../secret",sha:C,size:4,mode:"100644"}]},
  {truncated:false,tree:[{type:"blob",path:"a",sha:C,size:4,mode:"120000"}]},
  {truncated:false,tree:[{type:"blob",path:"a",sha:C,size:1048577,mode:"100644"}]},
  {truncated:false,tree:[{type:"commit",path:"gitlink",sha:C,size:4,mode:"160000"}]},
  {truncated:false,tree:[]}
 ]){
  const {h,promise}=run({sourceTree:tree});
  await assert.rejects(promise);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("source-to-destination blob mismatch halts without publishing tree/ref",async()=>{
 const {h,promise}=run({blobSha:D});
 await assert.rejects(promise,/destination blob SHA differs/);
 assert.deepEqual(h.events.filter(x=>x.method==="POST").map(x=>x.path),
   [destination+"/git/blobs"]);
});
test("loss of private visibility after source fetch blocks the FIRST write",async()=>{
 const {h,promise}=run({meta:(name,n)=>{
  if(name===destination&&n>=2)return{...good(name),private:false,visibility:"public"};
  return good(name);
 }});
 await assert.rejects(promise,/writable verified PRIVATE/);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
});
test("loss of private visibility before publishing branch prevents ref creation",async()=>{
 const {h,promise}=run({meta:(name,n)=>{
  if(name===destination&&n>=5)return{...good(name),private:false,visibility:"public"};
  return good(name);
 }});
 await assert.rejects(promise,/writable verified PRIVATE/);
 assert.equal(h.events.some(e=>e.path===destination+"/git/refs"),false);
});
test("GitHub API errors redact response body and bearer tokens",async()=>{
 const {h,promise}=run({errors:{"/git/blobs":true}});
 await assert.rejects(promise,error=>{
  assert.equal(error.message.includes("restricted-test-token"),false);
  return true;
 });
 assert.equal(h.events.some(e=>e.path===destination+"/git/refs"),false);
});

test("pre-existing destination files under snapshot prefix are rejected before any source blob publication",async()=>{
 for(const existing of [
   {path:"snapshots/checked",type:"tree"},
   {path:"snapshots/checked/old-source.ores",type:"blob"},
   {path:"snapshots",type:"blob"}
 ]){
   const {h,promise}=run({destinationTree:{truncated:false,tree:[existing]}});
   await assert.rejects(promise,/destination snapshot prefix/);
   assert.equal(h.events.some(e=>e.path===source+"/git/blobs/"+C),false);
   assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("incomplete destination base tree cannot be treated as empty",async()=>{
 for(const inventory of [
  {truncated:true,tree:[]},
  {truncated:false,tree:null},
  {truncated:false,tree:[null]}
 ]){
   const {h,promise}=run({destinationTree:inventory});
   await assert.rejects(promise,/destination base tree inventory|invalid destination base tree/);
   assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("publication confirms GitHub-created ref SHA and separately reads it back",async()=>{
 const {h,promise}=run({refSha:D});
 await assert.rejects(promise,/new isolated CI ref confirmation mismatch/);
 assert.equal(h.events.some(e=>e.path===destination+"/git/refs"),true);
 assert.equal(h.events.some(e=>e.path===destination+"/git/ref/heads/"+opts.newBranch),false);
});
test("unsafe branch dot paths and lock-file suffixes are rejected before API access",async()=>{
 for(const newBranch of ["ci/private-foo..bar","ci/private-foo.lock"]){
  const {h,promise}=run({}, {newBranch});
  await assert.rejects(promise,/isolated CI branch/);
  assert.equal(h.events.length,0);
 }
});

test("materialized snapshot must contain exactly pinned blobs before a commit or ref",async()=>{
 for(const tree of [
  {truncated:true,tree:[]},
  {truncated:false,tree:[]},
  {truncated:false,tree:[{path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:D}]},
  {truncated:false,tree:[
    {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C},
    {path:"snapshots/checked/injected.ores",type:"blob",mode:"100644",sha:D}
  ]},
  {truncated:false,tree:[
    {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C},
    {path:"snapshots/checked/stale",type:"tree"}
  ]},
  {truncated:false,tree:[{path:"snapshots/checked/main.ores",type:"blob",mode:"100755",sha:C}]}
 ]){
  const {h,promise}=run({materializedTree:tree});
  await assert.rejects(promise,/materialized destination snapshot|materialized snapshot/);
  assert.equal(h.events.some(x=>x.path===destination+"/git/commits"&&x.method==="POST"),false);
  assert.equal(h.events.some(x=>x.path===destination+"/git/refs"&&x.method==="POST"),false);
 }
});

test("materialized tree denies case-aliased source before publishing CI commit/ref",async()=>{
 const goodFile={path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C};
 for(const injection of [
   {path:"SNAPSHOTS/CHECKED/injected.ores",type:"blob",mode:"100644",sha:D},
   {path:"snapshots/checked/MAIN.ores",type:"blob",mode:"100644",sha:C},
   {path:"Snapshots/Checked",type:"tree"},
   {path:"snapshots/checked",type:"blob",mode:"100644",sha:C}
 ]){
   const tree={truncated:false,tree:[
     {path:"snapshots",type:"tree"},
     {path:"snapshots/checked",type:"tree"},
     goodFile,injection
   ]};
   const {h,promise}=run({materializedTree:tree});
   await assert.rejects(promise,/materialized snapshot/);
   assert.equal(h.events.some(e=>e.path===destination+"/git/commits"&&e.method==="POST"),false);
   assert.equal(h.events.some(e=>e.path===destination+"/git/refs"&&e.method==="POST"),false);
 }
});

test("case-insensitive destination prefix collisions fail before source is copied",async()=>{
 for(const entry of [
  {path:"SNAPSHOTS/CHECKED/old.ores",type:"blob"},
  {path:"Snapshots/Checked",type:"tree"},
  {path:"SNAPSHOTS",type:"blob"}
 ]){
  const {h,promise}=run({destinationTree:{truncated:false,tree:[entry]}});
  await assert.rejects(promise,/destination snapshot prefix/);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("case-insensitive colliding source paths and .GIT segments are rejected",async()=>{
 for(const tree of [
  {truncated:false,tree:[
    {type:"blob",path:"Main.ores",sha:C,size:4,mode:"100644"},
    {type:"blob",path:"main.ores",sha:C,size:4,mode:"100644"}
  ]},
  {truncated:false,tree:[{type:"blob",path:"src/.GIT/config",sha:C,size:4,mode:"100644"}]}
 ]){
  const {h,promise}=run({sourceTree:tree});
  await assert.rejects(promise,/colliding source path|unsafe or oversized/);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("duplicate entries in materialized tree cannot disguise omitted source blobs",async()=>{
 const tree={truncated:false,tree:[
  {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C},
  {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C}
 ]};
 const {h,promise}=run({materializedTree:tree});
 await assert.rejects(promise,/materialized snapshot contains case-colliding source paths/);
 assert.equal(h.events.some(e=>e.path===destination+"/git/refs"),false);
});

test("publisher denies before source blobs/writes without protected review proof",async()=>{
 const {h,promise}=run({errors:{["/branches/main/protection"]:true}});
 await assert.rejects(promise);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 assert.equal(h.events.some(e=>e.path.includes("/git/blobs/")),false);
});
test("publisher refuses missing sourceTree before any API access",async()=>{
 const {h,promise}=run({}, {sourceTree:undefined});
 await assert.rejects(promise,/invalid immutable/);
 assert.equal(h.events.length,0);
});

test("Git API-reported SHA cannot launder altered source blob bytes",async()=>{
 const forged=run({sourceBlobContent:Buffer.from("evil").toString("base64")});
 await assert.rejects(forged.promise,/content hash does not match/);
 assert.equal(forged.h.events.filter(e=>e.method==="POST").length,0,
   "tampered source bytes must never be copied to any destination object");
 const malformed=run({sourceBlobContent:"NDI7!g=="});
 await assert.rejects(malformed.promise,/invalid canonical Git source blob encoding/);
 assert.equal(malformed.h.events.filter(e=>e.method==="POST").length,0);
 const noncanonical=run({sourceBlobContent:"NDI7Cg==="});
 await assert.rejects(noncanonical.promise,/invalid canonical Git source blob encoding/);
 assert.equal(noncanonical.h.events.filter(e=>e.method==="POST").length,0);
});
test("GitHub line-wrapped canonical source blob remains independently valid",async()=>{
 const {h,promise}=run({sourceBlobContent:"NDI7\\nCg==".replace("\\n","\n")});
 const result=await promise;
 assert.equal(result.status,"PRIVATE_MIRROR_PUBLISHED");
 const posted=h.events.find(e=>e.path===destination+"/git/blobs"&&e.method==="POST");
 assert.equal(posted.body.content,"NDI7Cg==",
   "publish only normalized SHA-verified base64 bytes");
});

test("portable source path guard rejects Windows device names before mutation", async () => {
  for (const path of ["CON", "AUX.ores", "NUL.JSON", "COM1.txt", "LPT9", "foo."]) {
    const {h,promise}=run({sourceTree:{truncated:false,tree:[
      {type:"blob",path,sha:C,size:4,mode:"100644"}
    ]}});
    await assert.rejects(promise,/unsafe or oversized private source tree entry/);
    assert.equal(h.events.filter(x=>x.method==="POST").length,0);
  }
});

test("file-directory aliases are refused before source byte reads or destination writes", async () => {
  for (const names of [["cache","cache/child.ores"],["cache/child.ores","cache"],["Cache","cache/child.ores"]]) {
    const sourceTree={truncated:false,tree:names.map(path=>
      ({type:"blob",path,sha:C,size:4,mode:"100644"}))};
    const {h,promise}=run({sourceTree});
    await assert.rejects(promise,/file\/directory-alias source path/);
    assert.equal(h.events.filter(x=>x.method==="POST").length,0);
    assert.equal(h.events.some(x=>x.path===source+"/git/blobs/"+C),false);
  }
});
test("portable destination prefix cannot be a reserved Windows path", async () => {
  for (const prefix of ["CON", "run/COM1.txt", "reports/AUX.ores", "cache/dir."]) {
    const {h,promise}=run({}, {prefix});
    await assert.rejects(promise,/invalid destination prefix/);
    assert.equal(h.events.length,0);
  }
});

test("unsafe source tree directory entries deny before blob reads or destination mutations",async()=>{
 for(const entry of [
  {type:"tree",path:"CON",mode:"040000",sha:E},
  {type:"tree",path:"src/.",mode:"040000",sha:E},
  {type:"tree",path:"src",mode:"100644",sha:E},
  {type:"tree",path:"src",mode:"040000",sha:"invalid"},
  {type:"tree",path:"SRC",mode:"040000",sha:E}
 ]){
  const base={type:"blob",path:entry.path==="SRC"?"src":"main.ores",sha:C,size:4,mode:"100644"};
  const {h,promise}=run({sourceTree:{truncated:false,tree:[entry,base]}});
  await assert.rejects(promise,/unsafe Git source tree directory identity|duplicate or case-colliding Git source tree entry/);
  assert.equal(h.events.some(e=>e.path.includes("/git/blobs/")),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("case-inconsistent explicit tree parent and blob child deny before copying private bytes",async()=>{
 for(const paths of [
  [{type:"tree",path:"SRC",mode:"040000",sha:E},{type:"blob",path:"src/main.ores",mode:"100644",size:4,sha:C}],
  [{type:"tree",path:"src",mode:"040000",sha:E},{type:"tree",path:"SRC",mode:"040000",sha:D},{type:"blob",path:"src/main.ores",mode:"100644",size:4,sha:C}]
 ]){
  const {h,promise}=run({sourceTree:{truncated:false,tree:paths}});
  await assert.rejects(promise,/source tree file\/directory alias or inconsistent case|duplicate or case-colliding Git source tree entry/);
  assert.equal(h.events.some(e=>e.path.includes("/git/blobs/")),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("properly nested Git tree entries retain exact-case private source support in synthetic tests",async()=>{
 const sourceTree={truncated:false,tree:[
  {type:"tree",path:"src",mode:"040000",sha:E},
  {type:"blob",path:"src/main.ores",mode:"100644",size:4,sha:C}
 ]};
 const materializedTree={truncated:false,tree:[
  {path:"snapshots",type:"tree"},
  {path:"snapshots/checked",type:"tree"},
  {path:"snapshots/checked/src",type:"tree"},
  {path:"snapshots/checked/src/main.ores",type:"blob",mode:"100644",sha:C}
 ]};
 const {promise}=run({sourceTree,materializedTree});
 const receipt=await promise;
 assert.equal(receipt.blobs,1);
});
