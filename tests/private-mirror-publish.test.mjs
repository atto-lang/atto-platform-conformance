import {test} from "node:test";
import assert from "node:assert/strict";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";

const source="ores-truffle-oreslang/oreslang-source.java";
const destination="akrion-sim/akrion-sim-e2e";
const A="a".repeat(40),B="b".repeat(40),C="c".repeat(40),
 D="d".repeat(40),E="e".repeat(40);
const opts={source,destination,sourceCommit:A,destinationBaseCommit:B,
  prefix:"snapshots/checked",newBranch:"ci/private-test-proof",
  approvedDestinations:[destination],token:"opaque-test-token"};
const good=name=>({full_name:name,private:true,visibility:"private",
  archived:false,default_branch:"main",permissions:{push:true}});

function fixture({sourceTree,destinationTree,materializedTree,blobSha=C,refSha=E,meta,errors}={}){
  const events=[],seen={source:0,destination:0};
  const request=async(url,options)=>{
    const method=options.method,path=url.replace(/^https:\/\/api.github.com\/repos\//,"");
    events.push({path,method,body:options.body?JSON.parse(options.body):undefined});
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
      if(suffix==="/contents/.github/private-ci-approved-repositories.txt?ref=main"){
        const bytes=Buffer.from(destination+"\n","utf8");
        data={path:".github/private-ci-approved-repositories.txt",
          encoding:"base64",content:bytes.toString("base64"),size:bytes.length};
      }
      else if(suffix==="/git/commits/"+A)data={tree:{sha:D}};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data=sourceTree||{truncated:false,tree:[{type:"blob",path:"main.ores",sha:C,size:4,mode:"100644"}]};
      else if(suffix==="/git/blobs/"+C)
        data={sha:C,encoding:"base64",content:"NDI7Cg==",size:4};
    } else {
      if(suffix==="/git/commits/"+B)data={tree:{sha:E}};
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
    if(!data)throw Error("unexpected mock request "+path);
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
  assert.equal(error.message.includes("opaque-test-token"),false);
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
 await assert.rejects(promise,/materialized snapshot contains duplicate paths/);
 assert.equal(h.events.some(e=>e.path===destination+"/git/refs"),false);
});
