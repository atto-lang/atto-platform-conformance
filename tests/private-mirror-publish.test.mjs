import {test} from "node:test";
import assert from "node:assert/strict";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";

const source="ores-truffle-oreslang/oreslang-source.java";
const destination="akrion-sim/akrion-sim-e2e";
const A="a".repeat(40),B="b".repeat(40),C="5e5201f1b1618f87282bf41ce89ca710404cce95",
 D="320dd1875cd1274bf94e9d431cab4e41c0c25a0b",E="e".repeat(40);
const opts={source,destination,sourceCommit:A,destinationBaseCommit:B,
  prefix:"snapshots/checked",newBranch:"ci/private-test-proof",
  approvedDestinations:[destination],token:"opaque-test-token"};
const good=name=>({full_name:name,private:true,visibility:"private",
  archived:false,default_branch:"main",permissions:{push:true}});

function fixture({sourceTree,destinationTree,materializedTree,blobSha=C,refSha=E,meta,errors,
  sourceBlobContent="NDI7Cg==",mainRefSha=B,mainRefChangeOnRead=0,policyBody=null,
  mainRefName="refs/heads/main",mainRefType="commit",sourceCommitResponseSha=A}={}){
  const events=[],seen={source:0,destination:0,main:0};
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
        const bytes=Buffer.from(policyBody===null?destination+"\n":policyBody,"utf8");
        data={path:".github/private-ci-approved-repositories.txt",
          encoding:"base64",content:bytes.toString("base64"),size:bytes.length};
      }
      else if(suffix==="/git/commits/"+A)data={sha:sourceCommitResponseSha,tree:{sha:D}};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data={sha:D,...(sourceTree||{truncated:false,tree:[{type:"blob",path:"main.ores",sha:C,size:4,mode:"100644"}]})};
      else if(suffix==="/git/blobs/"+C)
        data={sha:C,encoding:"base64",content:sourceBlobContent,size:4};
    } else {
      if(suffix==="/git/ref/heads/main"&&method==="GET"){
        seen.main++;
        data={ref:mainRefName,object:{type:mainRefType,
          sha:mainRefChangeOnRead&&seen.main>=mainRefChangeOnRead?D:mainRefSha}};
      }
      else if(suffix==="/git/commits/"+B)data={tree:{sha:E}};
      else if(suffix==="/git/trees/"+E+"?recursive=1")
        data=destinationTree||{truncated:false,tree:[
          {path:"unrelated",type:"tree",mode:"040000",sha:A},
          {path:"unrelated/readme.txt",type:"blob",mode:"100644",sha:C}
        ]};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data=materializedTree||{truncated:false,tree:[
          {path:"unrelated",type:"tree",mode:"040000",sha:A},
          {path:"unrelated/readme.txt",type:"blob",mode:"100644",sha:C},
          {path:"snapshots",type:"tree",mode:"040000",sha:D},
          {path:"snapshots/checked",type:"tree",mode:"040000",sha:E},
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
test("source-main policy denial stops ALL reads of private Git objects",async()=>{
 for(const policyBody of ["# approved destinations: none\n","different-org/private\n"]){
   const {h,promise}=run({policyBody});
   await assert.rejects(promise,/not approved by trusted source main policy/);
   assert.equal(h.events.some(e=>e.path===source+"/git/commits/"+A),false);
   assert.equal(h.events.some(e=>e.path===source+"/git/blobs/"+C),false);
   assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("untrusted destination base cannot be used to introduce workflows or source",async()=>{
 const {h,promise}=run({mainRefSha:D});
 await assert.rejects(promise,/destination base must equal current trusted main HEAD/);
 assert.equal(h.events.some(e=>e.path===source+"/git/commits/"+A),false);
 assert.equal(h.events.some(e=>e.path===source+"/git/blobs/"+C),false);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
});
test("a mislabeled or non-commit main ref cannot attest a trusted base",async()=>{
 for(const scenario of [
   {mainRefName:"refs/heads/feature"},
   {mainRefName:"refs/tags/main"},
   {mainRefType:"tag"},
   {mainRefType:"blob"},
 ]){
   const {h,promise}=run(scenario);
   await assert.rejects(promise,/destination base must equal current trusted main HEAD/);
   assert.equal(h.events.some(e=>e.path===source+"/git/blobs/"+C),false);
   assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("destination main changing before any Git object write or ref fails closed",async()=>{
 // First read authenticates the destination before source bytes are fetched.
 // Next reads must precede blob, tree, commit, and isolated ref creation.
 const expectedWrites=[null,0,1,2,3];
 for(const changeRead of [2,3,4,5]){
   const {h,promise}=run({mainRefChangeOnRead:changeRead});
   await assert.rejects(promise,/destination base must equal current trusted main HEAD/);
   const writes=h.events.filter(e=>e.method==="POST");
   assert.equal(writes.length,expectedWrites[changeRead-1]);
   assert.equal(writes.some(e=>e.path===destination+"/git/refs"),false);
   assert.equal(h.seen.main,changeRead);
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
test("snapshot prefix never places mirrored source into GitHub workflow or root paths",async()=>{
 // A source file named workflows/run.yml would become a runnable workflow
 // under .github/workflows/ if the caller could choose the .github prefix.
 // Reject all non-snapshot roots before even querying GitHub visibility.
 for(const prefix of [
  ".github", ".github/workflows", ".GITHUB/workflows",
  "workflows", "src", "mirror", "snapshot", "snapshots",
  "docs/snapshots", "snapshots/.github/../workflows"
 ]){
  const {h,promise}=run({}, {prefix});
  await assert.rejects(promise,/invalid destination prefix/);
  assert.equal(h.events.length,0,"untrusted prefix must fail before any network access");
 }
 // Approved private mirror fixtures retain one nested inert prefix.
 const {h,promise}=run();
 await promise;
 const tree=h.events.find(x=>x.path===destination+"/git/trees"&&x.method==="POST");
 assert.ok(tree);
 assert.ok(tree.body.tree.every(x=>x.path.startsWith("snapshots/checked/")));
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
test("pinned source commit identity is required before fetching any tree or blob",async()=>{
 const {h,promise}=run({sourceCommitResponseSha:B});
 await assert.rejects(promise,/source commit SHA or pinned tree is invalid/);
 assert.equal(h.events.some(x=>x.path===source+"/git/trees/"+D+"?recursive=1"),false);
 assert.equal(h.events.some(x=>x.path===source+"/git/blobs/"+C),false);
 assert.equal(h.events.filter(x=>x.method==="POST").length,0);
});

test("complete source Git tree must hash to the pinned commit before blob fetch",async()=>{
 const entry={type:"blob",path:"main.ores",sha:C,size:4,mode:"100644"};
 const corrupted=[
  {truncated:false,tree:[{...entry,mode:"100755"}]},
  {truncated:false,tree:[{...entry,path:"renamed.ores"}]},
  {truncated:false,tree:[{...entry,sha:B}]},
  {truncated:false,tree:[entry,{...entry,path:"injected.ores"}]},
  {truncated:false,tree:[]},
  {truncated:false,tree:[{...entry,path:"src/main.ores"}]},
  {sha:B,truncated:false,tree:[entry]},
  {truncated:false,tree:[entry,{path:"src",type:"tree",mode:"040000",sha:B}]}
 ];
 for(const sourceTree of corrupted){
  const {h,promise}=run({sourceTree});
  await assert.rejects(promise,/source tree/);
  assert.equal(h.events.some(x=>x.path===source+"/git/blobs/"+C),false);
  assert.equal(h.events.filter(x=>x.method==="POST").length,0);
 }
});

test("malformed source blob base64 is denied before destination writes",async()=>{
 const malformed=[
  "!!!!", "NDI7", "NDI7Cg==junk", "NDI7Cg===",
  "", Buffer.alloc(16,42).toString("base64"),
  "NDI7Cg==\\u0000"
 ];
 for(const sourceBlobContent of malformed){
  const {h,promise}=run({sourceBlobContent});
  await assert.rejects(promise,/source blob payload is not valid pinned base64/);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
 // An oversized untrusted API response must not cause unbounded allocation
 // when stripping whitespace or any destination blob publication.
 const oversized=run({sourceBlobContent:" ".repeat(4096)+"NDI7Cg=="});
 await assert.rejects(oversized.promise,
   /source blob transport payload exceeds pinned size budget/);
 assert.equal(oversized.h.events.filter(e=>e.method==="POST").length,0);
 // GitHub may line-wrap a valid blob. Canonical normalization is still safe.
 const {h,promise}=run({sourceBlobContent:"NDI7\nCg=="});
 await promise;
 assert.equal(h.events.filter(e=>e.method==="POST").length,4);
 const blob=h.events.find(e=>e.path===destination+"/git/blobs"&&e.method==="POST");
 assert.equal(blob.body.content,"NDI7Cg==","publish canonical bytes only");
});

test("mismatched source blob bytes are refused before any destination write",async()=>{
 // API claims the right source SHA and byte length while serving different
 // valid base64 bytes. Metadata equality is insufficient for pinning.
 const {h,promise}=run({sourceBlobContent:"NDI8Cg=="});
 await assert.rejects(promise,/source blob bytes differ from pinned Git SHA/);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
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

test("materialized snapshot cannot mutate files outside the allowed subtree",async()=>{
 const unrelated={path:"unrelated/readme.txt",type:"blob",mode:"100644",sha:C};
 const valid=[
  {path:"unrelated",type:"tree",mode:"040000",sha:A},
  unrelated,
  {path:"snapshots",type:"tree",mode:"040000",sha:D},
  {path:"snapshots/checked",type:"tree",mode:"040000",sha:E},
  {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C}
 ];
 for(const changed of [
  valid.map(x=>x.path===unrelated.path?{...x,sha:B}:x),
  valid.filter(x=>x.path!==unrelated.path),
  [...valid,{path:".github/workflows/injected.yml",type:"blob",mode:"100644",sha:B}],
  [...valid,unrelated],
  valid.map(x=>x.path==="snapshots/checked"?{...x,type:"blob"}:x)
 ]){
  const {h,promise}=run({materializedTree:{truncated:false,tree:changed}});
  await assert.rejects(promise,/materialized destination|materialized snapshot/);
  assert.equal(h.events.some(e=>e.method==="POST"&&
    [destination+"/git/commits",destination+"/git/refs"].includes(e.path)),false);
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
  await assert.rejects(promise,/case-colliding source tree path|unsafe source tree path/);
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
