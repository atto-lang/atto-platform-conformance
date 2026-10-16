import {test} from "node:test";
import assert from "node:assert/strict";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";

const source="ores-truffle-oreslang/oreslang-source.java";
const destination="akrion-sim/akrion-sim-e2e";
const A="a".repeat(40),B="b".repeat(40),C="c".repeat(40),
 D="d".repeat(40),E="e".repeat(40),G="9".repeat(40),H="8".repeat(40);
const opts={source,destination,sourceCommit:A,approvedSourceCommit:A,
  approvedSourceTreeSha:D,destinationBaseCommit:B,
  approvedDestinationBaseCommit:B,approvedDestinationBaseTreeSha:E,
  runnerProbeRunId:1234567,approvedRunnerProbeCommit:"f".repeat(40),
  approvedRunnerProbeWorkflow:".github/workflows/runner-capacity-probe.yml",
  approvedRunnerProbeWorkflowBlobSha:G,
  prefix:"snapshots/checked",newBranch:"ci/private-test-proof",
  approvedDestinations:[destination],token:"opaque-test-token",
  sourceRepositoryId:1400792274,destinationRepositoryId:1321164328};
const good=name=>({full_name:name,id:name===source?1400792274:1321164328,
  private:true,visibility:"private",
  archived:false,permissions:{push:true}});

function fixture({sourceTree,destinationTree,materializedTree,blobSha=C,refSha=E,
  capacityRun,capacityJobs,capacityProbeTree,capacityProbeCommit,meta,errors}={}){
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
      if(suffix==="/git/commits/"+A)data={tree:{sha:D}};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data=sourceTree||{truncated:false,tree:[{type:"blob",path:"main.ores",sha:C,size:4,mode:"100644"}]};
      else if(suffix==="/git/blobs/"+C)
        data={sha:C,encoding:"base64",content:"NDI7Cg==",size:4};
    } else {
      if(suffix==="/actions/runs/"+opts.runnerProbeRunId)data=capacityRun||{
        id:opts.runnerProbeRunId,status:"completed",conclusion:"success",event:"push",
        head_sha:opts.approvedRunnerProbeCommit,path:opts.approvedRunnerProbeWorkflow,
        repository:{id:opts.destinationRepositoryId},
        head_repository:{id:opts.destinationRepositoryId},
        created_at:new Date().toISOString()
      };
      else if(suffix==="/actions/runs/"+opts.runnerProbeRunId+"/jobs?per_page=100")
        data=capacityJobs||{total_count:1,jobs:[{name:"capacity",
          status:"completed",conclusion:"success",runner_name:"GitHub Actions 1",
          runner_id:1000057681,run_id:opts.runnerProbeRunId,
          steps:[
            {name:"Set up job",status:"completed",conclusion:"success"},
            {name:"Prove runner allocation and shell execution",status:"completed",conclusion:"success"},
            {name:"Complete job",status:"completed",conclusion:"success"}
          ]}]};
      else if(suffix==="/git/commits/"+opts.approvedRunnerProbeCommit)
        data=capacityProbeCommit||{tree:{sha:H}};
      else if(suffix==="/git/trees/"+H+"?recursive=1")
        data=capacityProbeTree||{truncated:false,tree:[{
          path:opts.approvedRunnerProbeWorkflow,mode:"100644",type:"blob",sha:G
        }]};
      else if(suffix==="/git/commits/"+B)data={tree:{sha:E}};
      else if(suffix==="/git/trees/"+E+"?recursive=1")
        data=destinationTree||{truncated:false,tree:[
          {path:"unrelated",type:"tree",mode:"040000",sha:B},
          {path:"unrelated/readme.txt",type:"blob",mode:"100644",sha:C}
        ]};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data=materializedTree||{truncated:false,tree:[
          {path:"unrelated",type:"tree",mode:"040000",sha:B},
          {path:"unrelated/readme.txt",type:"blob",mode:"100644",sha:C},
          {path:"snapshots",type:"tree",mode:"040000"},
          {path:"snapshots/checked",type:"tree",sha:D},
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
  {prefix:".github/workflows/private"},{prefix:"snapshot/.GITHUB/workflows"},
  {sourceCommit:"not-a-sha"},
  {approvedSourceCommit:undefined},{approvedSourceTreeSha:undefined},
  {approvedSourceCommit:B},{approvedSourceCommit:"invalid"},
  {approvedSourceTreeSha:"not-a-tree"},
  {approvedDestinationBaseCommit:undefined},
  {approvedDestinationBaseTreeSha:undefined},
  {approvedDestinationBaseCommit:A},
  {approvedDestinationBaseTreeSha:"not-a-tree"},
  {runnerProbeRunId:undefined},{runnerProbeRunId:0},
  {approvedRunnerProbeCommit:undefined},{approvedRunnerProbeWorkflow:"unreviewed.yml"},
  {approvedRunnerProbeWorkflowBlobSha:undefined},
  {approvedRunnerProbeWorkflowBlobSha:"not-a-sha"},
  {sourceRepositoryId:undefined},{destinationRepositoryId:undefined},
  {sourceRepositoryId:0},{destinationRepositoryId:1400792274}
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
  await assert.rejects(promise,/colliding source path|unsafe or oversized|unsafe source Git tree entry/);
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

test("unreviewed or swapped numeric repository IDs reject before fetching source bytes",async()=>{
 for(const meta of [
  (name)=>({...good(name),id:name===source?42:1321164328}),
  (name)=>({...good(name),id:name===destination?43:1400792274})
 ]){
  const {h,promise}=run({meta});
  await assert.rejects(promise,/metadata|private source|writable verified PRIVATE/);
  assert.equal(h.events.some(e=>e.path.includes("/git/")),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("repository ID retargeting mid-publication denies subsequent Git writes",async()=>{
 const {h,promise}=run({meta:(name,n)=>({
  ...good(name),
  id:name===destination&&n>=2?999999:good(name).id
 })});
 await assert.rejects(promise,/writable verified PRIVATE/);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
});

test("whole published nested Git tree must match the exact pinned source tree",async()=>{
 const materializedTree={truncated:false,tree:[
  {path:"snapshots",type:"tree"},
  {path:"snapshots/checked",type:"tree",sha:E},
  {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C}
 ]};
 const {h,promise}=run({materializedTree});
 await assert.rejects(promise,/materialized snapshot source subtree SHA/);
 assert.equal(h.events.some(e=>e.path===destination+"/git/commits"&&e.method==="POST"),false);
 assert.equal(h.events.some(e=>e.path===destination+"/git/refs"&&e.method==="POST"),false);
});

test("source Git tree changed since reviewed policy denies before fetching any source blobs",async()=>{
 const h=fixture();
 const intercept=async(url,opt)=>{
  if(url.endsWith(source+"/git/commits/"+A))
   return {status:200,json:async()=>({tree:{sha:E}})};
  return h.request(url,opt);
 };
 await assert.rejects(publishPrivateMirror({...opts,fetchImpl:intercept}),
   /source commit tree differs from independently reviewed policy pin/);
 assert.equal(h.events.some(e=>e.path===source+"/git/blobs/"+C),false);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
});
test("source SHA and tree pin are independent policy inputs",async()=>{
 for(const change of [
  {sourceCommit:B},
  {approvedSourceCommit:B},
  {approvedSourceTreeSha:E}
 ]){
  const {h,promise}=run({},change);
  await assert.rejects(promise);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
  if(change.sourceCommit||change.approvedSourceCommit)assert.equal(h.events.length,0);
 }
});

test("no private source bytes are read when runner probe failed or recorded zero steps",async()=>{
 const probe={id:opts.runnerProbeRunId,status:"completed",conclusion:"failure",
    head_sha:opts.approvedRunnerProbeCommit,path:opts.approvedRunnerProbeWorkflow,
    repository:{id:opts.destinationRepositoryId},
    head_repository:{id:opts.destinationRepositoryId},created_at:new Date().toISOString()};
 const failures=[
  {capacityRun:probe},
  {capacityRun:{...probe,conclusion:"success"},capacityJobs:{total_count:1,jobs:[
   {name:"capacity",conclusion:"failure",runner_name:"",steps:[]}]}}
 ];
 for(const input of failures){
  const {h,promise}=run(input);
  await assert.rejects(promise,/runner capacity probe|runner probe has no/);
  assert.equal(h.events.some(e=>e.path===source+"/git/commits/"+A),false);
  assert.equal(h.events.some(e=>e.path===source+"/git/blobs/"+C),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("stale, incorrect source-free workflow and wrong destination repository ID deny before source read",async()=>{
 const successful={id:opts.runnerProbeRunId,status:"completed",conclusion:"success",event:"push",
  head_sha:opts.approvedRunnerProbeCommit,path:opts.approvedRunnerProbeWorkflow,
  repository:{id:opts.destinationRepositoryId},
  head_repository:{id:opts.destinationRepositoryId},created_at:new Date().toISOString()};
 for(const modified of [
  {created_at:"2020-01-01T00:00:00Z"},
  {created_at:"not-a-date"},
  {head_sha:A},
  {path:".github/workflows/unreviewed.yml"},
  {event:"pull_request"},
  {event:"schedule"},
  {repository:{id:9999}},
  {head_repository:{id:9999}},
  {id:0}
 ]){
  const {h,promise}=run({capacityRun:{...successful,...modified}});
  await assert.rejects(promise,/destination source-free runner capacity probe not verified/);
  assert.equal(h.events.some(e=>e.path.startsWith(source+"/git/")),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("incomplete, fake, multiple or job-with-no-real-step runner evidence cannot authorize private copy",async()=>{
 const goodJob={name:"capacity",status:"completed",conclusion:"success",
    runner_name:"GitHub Actions 1",runner_id:1000057681,
    run_id:opts.runnerProbeRunId,
    steps:[{name:"Prove runner allocation and shell execution",status:"completed",conclusion:"success"}]};
 for(const jobs of [
  {total_count:0,jobs:[]},
  {total_count:2,jobs:[goodJob,goodJob]},
  {total_count:1,jobs:[{...goodJob,steps:[]}]},
  {total_count:1,jobs:[{...goodJob,runner_name:""}]},
  {total_count:1,jobs:[{...goodJob,steps:[{...goodJob.steps[0],conclusion:"skipped"}]}]},
  {total_count:1,jobs:[{...goodJob,steps:[{...goodJob.steps[0],name:"Fake skipped"}]}]},
  {total_count:1,jobs:[{...goodJob,status:"queued"}]},
  {total_count:1,jobs:[{...goodJob,run_id:opts.runnerProbeRunId+1}]},
  {total_count:1,jobs:[{...goodJob,run_id:undefined}]},
  {total_count:1,jobs:[{...goodJob,runner_id:0}]},
  {total_count:1,jobs:[{...goodJob,runner_id:undefined}]},
  {total_count:1,jobs:[{...goodJob,steps:[{...goodJob.steps[0],status:"in_progress"}]}]},
  {total_count:1,jobs:[{...goodJob,steps:[goodJob.steps[0],goodJob.steps[0]]}]}
 ]){
  const {h,promise}=run({capacityJobs:jobs});
  await assert.rejects(promise,/runner probe has no independently executed success step/);
  assert.equal(h.events.filter(e=>e.path.startsWith(source+"/git/")).length,0);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});

test("unapproved destination commit rejects before API and mismatched destination base tree before source reads",async()=>{
 const {h,promise}=run({}, {destinationBaseCommit:A});
 await assert.rejects(promise,/destination base commit differs from independently reviewed policy pin/);
 assert.equal(h.events.length,0);
 const second=fixture();
 const fetchImpl=async(url,options)=>{
  if(url.endsWith(destination+"/git/commits/"+B))
   return {status:200,json:async()=>({tree:{sha:A}})};
  return second.request(url,options);
 };
 await assert.rejects(publishPrivateMirror({...opts,fetchImpl}),
    /destination base tree differs from independently reviewed policy pin/);
 assert.equal(second.events.some(e=>e.path.startsWith(source+"/git/")),false);
 assert.equal(second.events.filter(e=>e.method==="POST").length,0);
});
test("destination prefix collision is rejected before reading confidential source commit",async()=>{
 const {h,promise}=run({destinationTree:{truncated:false,tree:[
  {path:"snapshots/checked/injected.ores",type:"blob"}
 ]}});
 await assert.rejects(promise,/destination snapshot prefix/);
 assert.equal(h.events.some(e=>e.path.startsWith(source+"/git/")),false);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
});

test("capacity proof cannot hide extra executable, checkout or skipped steps",async()=>{
 const steps=[
  {name:"Set up job",status:"completed",conclusion:"success"},
  {name:"Prove runner allocation and shell execution",status:"completed",conclusion:"success"},
  {name:"Complete job",status:"completed",conclusion:"success"}
 ];
 const injected=[
  {name:"Run actions/checkout@v4",status:"completed",conclusion:"success"},
  {name:"Unreviewed shell",status:"completed",conclusion:"success"},
  {name:"Print env",status:"completed",conclusion:"skipped"}
 ];
 for(const extra of injected){
  for(const position of [0,1,3]){
   const attempted=[...steps];
   attempted.splice(position,0,extra);
   const {h,promise}=run({capacityJobs:{total_count:1,jobs:[{
    name:"capacity",status:"completed",conclusion:"success",
    run_id:opts.runnerProbeRunId,runner_id:1000057681,
    runner_name:"GitHub Actions 1000057681",steps:attempted
   }]}});
   await assert.rejects(promise,/runner probe has no independently executed success step/);
   assert.equal(h.events.some(e=>e.path.startsWith(source+"/git/")),false);
   assert.equal(h.events.filter(e=>e.method==="POST").length,0);
  }
 }
});
test("capacity step verification requires GitHub-managed step order and success",async()=>{
 const ok=[
  {name:"Set up job",status:"completed",conclusion:"success"},
  {name:"Prove runner allocation and shell execution",status:"completed",conclusion:"success"},
  {name:"Complete job",status:"completed",conclusion:"success"}
 ];
 for(const steps of [
  [ok[1],ok[0],ok[2]],
  [ok[0],ok[2],ok[1]],
  [ok[0],{...ok[1],status:"queued"},ok[2]],
  [ok[0],ok[1],{...ok[2],conclusion:"failure"}],
 ]){
  const {h,promise}=run({capacityJobs:{total_count:1,jobs:[{
    name:"capacity",status:"completed",conclusion:"success",
    run_id:opts.runnerProbeRunId,runner_id:1000057681,
    runner_name:"GitHub Actions 1000057681",steps
  }]}});
  await assert.rejects(promise,/runner probe has no independently executed success step/);
  assert.equal(h.events.some(e=>e.path.startsWith(source+"/git/")),false);
 }
});

test("source-free workflow Git blob must match reviewed immutable workflow contents",async()=>{
 const baseline={path:opts.approvedRunnerProbeWorkflow,mode:"100644",type:"blob",sha:G};
 for(const tree of [
  {truncated:true,tree:[baseline]},
  {truncated:false,tree:[]},
  {truncated:false,tree:[{...baseline,sha:C}]},
  {truncated:false,tree:[{...baseline,mode:"100755"}]},
  {truncated:false,tree:[{...baseline,type:"tree"}]},
  {truncated:false,tree:[baseline,baseline]},
  {truncated:false,tree:[{...baseline,path:".github/workflows/other.yml"}]}
 ]){
  const {h,promise}=run({capacityProbeTree:tree});
  await assert.rejects(promise,/runner-probe workflow tree incomplete|runner probe workflow content differs/);
  assert.equal(h.events.some(e=>e.path.startsWith(source+"/git/")),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("probe commit without an exact Git tree rejects before source read",async()=>{
 for(const capacityProbeCommit of [{}, {tree:{sha:"bogus"}}, {tree:{sha:null}}]){
  const {h,promise}=run({capacityProbeCommit});
  await assert.rejects(promise,/approved runner-probe commit has no Git tree/);
  assert.equal(h.events.some(e=>e.path.startsWith(source+"/git/")),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("unreviewed runner-probe blob policy pin rejects before external API requests",async()=>{
 for(const value of [undefined,null,"",0,"a".repeat(41)]){
  const {h,promise}=run({}, {approvedRunnerProbeWorkflowBlobSha:value});
  await assert.rejects(promise,/invalid immutable Git commit or blob SHA/);
  assert.equal(h.events.length,0);
 }
});

test("malformed directory Git trees deny before confidential blob fetch or destination writes",async()=>{
 const ordinary={type:"blob",path:"src/main.ores",sha:C,size:4,mode:"100644"};
 const badTrees=[
  {type:"tree",path:"src/../escape",sha:D,mode:"040000"},
  {type:"tree",path:"src/.GIT",sha:D,mode:"040000"},
  {type:"tree",path:"src/symlink",sha:D,mode:"120000"},
  {type:"tree",path:"src/missing-oid",sha:"invalid",mode:"040000"},
  {type:"tree",path:"src/vendor",sha:D,mode:"160000"},
  {type:"commit",path:"src/vendor",sha:D,mode:"160000"},
  {type:"tree",path:"src/vendor",sha:D,mode:"100644"},
  {type:"tree",path:"src\\backslash",sha:D,mode:"040000"},
  {type:"tree",path:"src",sha:D,mode:"040000"},
  {type:"tree",path:"SRC",sha:D,mode:"040000"}
 ];
 for(const bad of badTrees){
  const prior={type:"tree",path:"src",sha:E,mode:"040000"};
  const entries=(bad.path==="src"||bad.path==="SRC")?[prior,bad,ordinary]:[prior,ordinary,bad];
  const {h,promise}=run({sourceTree:{truncated:false,tree:entries}});
  await assert.rejects(promise,/unsafe source Git tree entry|duplicate or cross-platform-colliding source path/);
  assert.equal(h.events.some(e=>e.path===source+"/git/blobs/"+C),false);
  assert.equal(h.events.filter(e=>e.method==="POST").length,0);
 }
});
test("valid nested source tree directories preserve exact-mode happy path",async()=>{
 const src={truncated:false,tree:[
  {type:"tree",path:"src",sha:E,mode:"040000"},
  {type:"blob",path:"src/main.ores",sha:C,size:4,mode:"100644"}]};
 const materialized={truncated:false,tree:[
  {path:"unrelated",type:"tree",mode:"040000",sha:B},
  {path:"unrelated/readme.txt",type:"blob",mode:"100644",sha:C},
  {path:"snapshots",type:"tree",mode:"040000"},
  {path:"snapshots/checked",type:"tree",sha:D},
  {path:"snapshots/checked/src",type:"tree",sha:E},
  {path:"snapshots/checked/src/main.ores",type:"blob",sha:C,mode:"100644"}
 ]};
 const {h,promise}=run({sourceTree:src,materializedTree:materialized});
 const result=await promise;
 assert.equal(result.status,"PRIVATE_MIRROR_PUBLISHED");
 assert.ok(h.events.some(e=>e.method==="POST"&&e.path===destination+"/git/refs"));
});

test("outside-prefix destination base must remain byte-identical at publication",async()=>{
 const standard=[
  {path:"unrelated",type:"tree",mode:"040000",sha:B},
  {path:"unrelated/readme.txt",type:"blob",mode:"100644",sha:C},
  {path:"snapshots",type:"tree",mode:"040000"},
  {path:"snapshots/checked",type:"tree",sha:D},
  {path:"snapshots/checked/main.ores",type:"blob",sha:C,mode:"100644"}
 ];
 for(const variant of [
   standard.filter(x=>x.path!=="unrelated/readme.txt"),
   standard.map(x=>x.path==="unrelated/readme.txt"?{...x,sha:A}:x),
   standard.concat({path:"unrelated/injected.txt",type:"blob",mode:"100644",sha:C}),
   standard.concat({path:"extra-repo-file.txt",type:"blob",mode:"100644",sha:C}),
   standard.map(x=>x.path==="snapshots"?{...x,type:"blob",mode:"100644"}:x)
 ]){
  const {h,promise}=run({materializedTree:{truncated:false,tree:variant}});
  await assert.rejects(promise,/destination base entries|destination snapshot ancestor/);
  assert.equal(h.events.some(e=>e.method==="POST"&&e.path===destination+"/git/commits"),false);
  assert.equal(h.events.some(e=>e.method==="POST"&&e.path===destination+"/git/refs"),false);
 }
});
