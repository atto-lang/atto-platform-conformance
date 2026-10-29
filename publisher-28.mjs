// Immutable transformed 28-case publisher test bundle
// Original source commit 3f36d7c0b2ae35b550662a51302a41c0665d1362
// Original Git blobs ac40ce69b9ae8f547fb2bea5d244e60d35241d27 f10ca15a6deae9a3337f26f1c2fe83eefd84ad8e d05d63420ebafcc39430dfd07ea17865c5b5ff03
// No secrets, compiler source, or working-tree copy included.
import {test} from "node:test";
import assert from "node:assert/strict";
/**
 * PRE-COPY confidentiality admission. Source Git hashes prove byte identity,
 * not permission to publish the bytes. Always validate repository visibility
 * before creating a tree/blob, pushing a ref or uploading an Actions artifact.
 *
 * This verifier does not perform a mirror, fetch source bytes or change GitHub
 * settings. The mirror orchestrator must fail closed if this command fails.
 */

const FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function repoName(value) {
  if (typeof value !== "string" || !FULL_NAME.test(value) ||
      value.length > 220 || value.includes("..")) {
    throw Error("invalid GitHub owner/repository identifier");
  }
  return value;
}

async function repoMetadata(name, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl("https://api.github.com/repos/" + name, {
      method: "GET",
      redirect: "error",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    // Transport diagnostics are untrusted. Never propagate a library error
    // whose message could contain an Authorization header or access token.
    throw Error("GitHub repository visibility lookup failed (" + name + ")");
  }
  if (!response || response.status !== 200) {
    throw Error("GitHub repository visibility is unverifiable (" + name + ")");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error("GitHub repository metadata could not be decoded (" + name + ")");
  }
  if (!result || result.full_name !== name ||
      typeof result.private !== "boolean" ||
      !["public", "internal", "private"].includes(result.visibility)) {
    throw Error("GitHub returned invalid or mismatched repository metadata (" + name + ")");
  }
  return result;
}

async function requirePrivateMirror({
  source, destination, approvedDestinations, token, fetchImpl = fetch
}) {
  // In particular, no discovery endpoint and no source blob operation may
  // be attempted when approval, credentials or names are missing.
  const from = repoName(source);
  const to = repoName(destination);
  if (!Array.isArray(approvedDestinations) ||
      approvedDestinations.length === 0 || approvedDestinations.length > 32 ||
      !approvedDestinations.every(v => typeof v === "string" && FULL_NAME.test(v)) ||
      !approvedDestinations.includes(to)) {
    throw Error("destination is not in the explicit trusted private-mirror allowlist");
  }
  if (typeof token !== "string" || token.trim().length < 1) {
    throw Error("authenticated GitHub repository visibility lookup required");
  }
  if (typeof fetchImpl !== "function") throw Error("GitHub visibility lookup unavailable");

  const sourceRepo = await repoMetadata(from, token, fetchImpl);
  if (sourceRepo.private !== true || sourceRepo.visibility !== "private" ||
      sourceRepo.archived === true) {
    throw Error("private source metadata is not securely established");
  }
  const destinationRepo = await repoMetadata(to, token, fetchImpl);
  if (destinationRepo.private !== true || destinationRepo.visibility !== "private" ||
      destinationRepo.archived === true || destinationRepo.permissions?.push !== true) {
    throw Error("destination must be a writable verified PRIVATE GitHub repository");
  }
  return Object.freeze({status: "PRIVATE_MIRROR_APPROVED", source: from, destination: to});
}


/**
 * The ONLY supported private cross-repository source-copy entrypoint.
 * Do not use a generic push/copy workflow to bypass this gate.
 * This creates immutable source blobs and a NEW ci/private-* branch; it
 * never overwrites an existing ref or writes to the destination main branch.
 */


const OID=/^[a-f0-9]{40}$/;
const PATH=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const BRANCH=/^ci\/private-[A-Za-z0-9][A-Za-z0-9._-]{0,75}$/;
const MAX_BATCH_BLOBS=64;
const CHECKPOINT_SCHEMA="oreslang.private-mirror-checkpoint/1";

function validPath(path) {
  return typeof path==="string" && path.length<=512 && PATH.test(path) &&
    path.split("/").every(x=>x!=="."&&x!==".."&&x.toLowerCase()!==".git"&&
      !x.endsWith(".")&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x));
}
function sha(value) {
  if(typeof value!=="string"||!OID.test(value))throw Error("invalid immutable Git commit or blob SHA");
  return value;
}
async function githubRequest(repo,path,token,{method="GET",body,fetchImpl=fetch}={}) {
  let response;
  try {
    response=await fetchImpl("https://api.github.com/repos/"+repo+path,{
      method,redirect:"error",
      headers:{"Accept":"application/vnd.github+json",
        "Authorization":"Bearer "+token,
        "X-GitHub-Api-Version":"2022-11-28",
        ...(body===undefined?{}:{"Content-Type":"application/json"})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(15000)
    });
  }catch{
    throw Error("GitHub private mirror request failed");
  }
  if(!response||!(response.status>=200&&response.status<300)){
    // In particular, never propagate potentially credential-bearing API text.
    throw Error("GitHub private mirror API rejected "+method+" "+path.split("/").slice(0,3).join("/"));
  }
  try{return await response.json()}catch{throw Error("GitHub private mirror API returned invalid JSON")}
}

async function publishPrivateMirror({
  source,destination,sourceCommit,destinationBaseCommit,prefix,newBranch,
  approvedDestinations,token,fetchImpl=fetch,
  maxBlobsPerRun,checkpoint
}) {
  sha(sourceCommit);sha(destinationBaseCommit);
  if(maxBlobsPerRun!==undefined&&(!Number.isSafeInteger(maxBlobsPerRun)||
      maxBlobsPerRun<1||maxBlobsPerRun>MAX_BATCH_BLOBS))
    throw Error("invalid bounded private mirror batch size");
  if(checkpoint!==undefined&&(
      checkpoint===null||typeof checkpoint!=="object"||Array.isArray(checkpoint)||
      Object.keys(checkpoint).sort().join(",")!==
      "destination,destinationBaseCommit,destinationBaseTree,lastBlobSha,newBranch,nextIndex,prefix,schema,source,sourceCommit,sourceTree,totalBlobs"))
    throw Error("invalid private mirror checkpoint shape");
  if(!validPath(prefix)||!BRANCH.test(newBranch)||newBranch.includes("..")||newBranch.endsWith(".lock"))
    throw Error("invalid destination prefix or isolated CI branch");
  const authorize=()=>requirePrivateMirror({
    source,destination,approvedDestinations,token,fetchImpl
  });
  // FIRST external operation: authorization, before ANY source bytes are fetched
  // and before ANY destination object/ref is created.
  await authorize();
  const srcCommit=await githubRequest(source,"/git/commits/"+sourceCommit,token,{fetchImpl});
  if(!srcCommit?.tree?.sha||!OID.test(srcCommit.tree.sha))throw Error("source commit has no pinned tree");
  const srcTree=await githubRequest(source,"/git/trees/"+srcCommit.tree.sha+"?recursive=1",token,{fetchImpl});
  if(srcTree.truncated!==false||!Array.isArray(srcTree.tree))throw Error("source tree incomplete");
  // GitHub's recursive-tree enumeration order must not change resume indices.
  const files=srcTree.tree.filter(x=>x.type==="blob")
    .sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  // Current Java/LLVM compiler trees have 1,177/1,291 regular files.
  // Raise only the bounded count, not byte, per-file, path or privacy limits.
  const MAX_SOURCE_FILES = 1500;
  if(files.length===0||files.length>MAX_SOURCE_FILES||srcTree.tree.length>3000)
    throw Error("unsupported source tree size");
  let totalBytes=0;
  const paths=new Set();
  for(const file of files){
    if(!validPath(file.path)||!OID.test(file.sha)||
       !["100644","100755"].includes(file.mode)||
       !Number.isSafeInteger(file.size)||file.size<0||file.size>1048576)
      throw Error("unsafe or oversized private source tree entry");
    const folded=file.path.toLowerCase();
    if(paths.has(folded))throw Error("duplicate or cross-platform-colliding source path");
    paths.add(folded);
    totalBytes+=file.size;
    if(totalBytes>41943040)throw Error("private mirror exceeds 40MiB limit");
  }
  // Fail closed on special paths: executable symlinks and gitlinks are not
  // copied; unknown tree objects must not silently disappear.
  // GitHub can store distinct case-folding directories (e.g. Foo/ and foo/)
  // that Windows/macOS checkouts cannot represent unambiguously. Every
  // directory component must have exactly one canonical spelling, not just
  // complete file paths. Never silently lose a Git entry on checkout.
  const directorySpelling=new Map();
  const sourceEntries=new Set();
  for(const item of srcTree.tree){
    if(!["tree","blob"].includes(item.type))
      throw Error("unsupported source tree object");
    if(!validPath(item.path)||!OID.test(item.sha)||
       (item.type==="tree"&&item.mode!=="040000"))
      throw Error("unsafe private source directory entry");
    if(sourceEntries.has(item.path))
      throw Error("duplicate private source tree entry");
    sourceEntries.add(item.path);
    const components=item.path.split("/");
    let ancestor="";
    for(let index=0;index<components.length;index++){
      ancestor+=(index?"/":"")+components[index];
      const folded=ancestor.toLowerCase();
      if(directorySpelling.has(folded)&&directorySpelling.get(folded)!==ancestor)
        throw Error("cross-platform-colliding source directory component");
      directorySpelling.set(folded,ancestor);
    }
  }
  const base=await githubRequest(destination,"/git/commits/"+destinationBaseCommit,token,{fetchImpl});
  if(!OID.test(base?.tree?.sha||""))throw Error("destination base is not an immutable commit");
  // Git's base_tree PATCH-like behavior *preserves* unrelated entries.
  // A pre-existing subtree at the chosen prefix could carry stale source
  // code or injected files into the new snapshot without being overwritten.
  // Demand an empty, isolated destination prefix before writing ANY blobs.
  const baseInventory=await githubRequest(destination,
    "/git/trees/"+base.tree.sha+"?recursive=1",token,{fetchImpl});
  if(baseInventory?.truncated!==false||!Array.isArray(baseInventory.tree))
    throw Error("destination base tree inventory is incomplete");
  for(const item of baseInventory.tree){
    if(typeof item?.path!=="string"||typeof item.type!=="string")
      throw Error("invalid destination base tree entry");
    // Prevent silent overlay on case-insensitive macOS/Windows checkouts.
    const current=item.path.toLowerCase(), wanted=prefix.toLowerCase();
    if(current===wanted||current.startsWith(wanted+"/")||
       (wanted.startsWith(current+"/")&&
        (item.type!=="tree"||!prefix.startsWith(item.path+"/"))))
      throw Error("destination snapshot prefix is not empty or conflicts with existing path");
  }
  const pin={schema:CHECKPOINT_SCHEMA,source,destination,sourceCommit,
    sourceTree:srcCommit.tree.sha,destinationBaseCommit,
    destinationBaseTree:base.tree.sha,prefix,newBranch,totalBlobs:files.length};
  let start=0;
  if(checkpoint!==undefined){
    for(const [key,value] of Object.entries(pin)){
      if(checkpoint[key]!==value)throw Error("stale or modified private mirror checkpoint");
    }
    start=checkpoint.nextIndex;
    if(!Number.isSafeInteger(start)||start<1||start>=files.length||
       checkpoint.lastBlobSha!==files[start-1].sha)
      throw Error("invalid or forged private mirror resume cursor");
    // Prove the last checkpointed Git object really exists at the destination.
    // Earlier objects are independently revalidated by the exact full subtree
    // SHA and manifest walk before any commit/ref can be created.
    const last=files[start-1];
    const staged=await githubRequest(destination,"/git/blobs/"+last.sha,token,{fetchImpl});
    if(staged?.sha!==last.sha||staged.size!==last.size||
       staged.encoding!=="base64"||typeof staged.content!=="string")
      throw Error("missing or tampered checkpointed private mirror blob");
  }
  const batchLimit=maxBlobsPerRun===undefined?files.length:maxBlobsPerRun;
  const end=Math.min(files.length,start+batchLimit);
  const entries=files.map(file=>({path:prefix+"/"+file.path,mode:file.mode,
    type:"blob",sha:file.sha}));
  for(let index=start;index<end;index++){
    const file=files[index];
    const srcBlob=await githubRequest(source,"/git/blobs/"+file.sha,token,{fetchImpl});
    if(srcBlob?.sha!==file.sha||srcBlob.encoding!=="base64"||
       typeof srcBlob.content!=="string"||srcBlob.size!==file.size)
      throw Error("source blob content identity or encoding mismatch");
    // Recheck CURRENT confidentiality before EVERY destination mutation.
    await authorize();
    const pushed=await githubRequest(destination,"/git/blobs",token,{
      method:"POST",body:{content:srcBlob.content,encoding:"base64"},fetchImpl
    });
    if(pushed.sha!==file.sha)throw Error("destination blob SHA differs from source");
  }
  if(end<files.length){
    // A staging receipt never creates a destination commit, ref, artifact or
    // executable checkout. The immutable source manifest is pinned on resume.
    return Object.freeze({status:"PRIVATE_MIRROR_STAGED",
      checkpoint:Object.freeze({...pin,nextIndex:end,lastBlobSha:files[end-1].sha}),
      copiedThisBatch:end-start,remaining:files.length-end});
  }
  await authorize();
  const targetTree=await githubRequest(destination,"/git/trees",token,{
    method:"POST",body:{base_tree:base.tree.sha,tree:entries},fetchImpl
  });
  sha(targetTree.sha);
  // Verify GitHub materialized exactly the requested snapshot, rather than
  // trusting only the tree creation response SHA. Refuse stale, missing or
  // injected files before the tree becomes reachable from a commit or ref.
  const materialized=await githubRequest(destination,
    "/git/trees/"+targetTree.sha+"?recursive=1",token,{fetchImpl});
  if(materialized?.truncated!==false||!Array.isArray(materialized.tree))
    throw Error("materialized destination snapshot cannot be verified");
  // Match the complete Git subtree identity as well as each file. This
  // catches a publisher/tree assembly mismatch independently of our manifest
  // walk, before the source snapshot becomes reachable from any CI ref.
  const prefixRoots=materialized.tree.filter(e=>e?.path===prefix);
  if(prefixRoots.length!==1||prefixRoots[0].type!=="tree"||
     prefixRoots[0].sha!==srcCommit.tree.sha)
    throw Error("materialized snapshot source subtree SHA mismatch");
  const expected=new Map(entries.map(e=>[e.path,e]));
  let verified=0;
  const seenMaterialized=new Set();
  for(const item of materialized.tree){
    if(typeof item?.path!=="string"||typeof item.type!=="string")
      throw Error("invalid materialized snapshot tree entry");
    if(item.path===prefix||!item.path.startsWith(prefix+"/"))continue;
    if(item.type==="tree"){
      if(!entries.some(e=>e.path.startsWith(item.path+"/")))
        throw Error("materialized snapshot contains unexpected empty directory");
      continue;
    }
    const want=expected.get(item.path);
    if(seenMaterialized.has(item.path))
      throw Error("materialized snapshot contains duplicate paths");
    seenMaterialized.add(item.path);
    if(item.type!=="blob"||!want||
       item.sha!==want.sha||item.mode!==want.mode)
      throw Error("materialized snapshot differs from pinned source blobs");
    verified++;
  }
  if(verified!==entries.length)
    throw Error("materialized snapshot omits pinned source blobs");
  await authorize();
  const result=await githubRequest(destination,"/git/commits",token,{
    method:"POST",body:{message:"ci: verified private source snapshot "+sourceCommit,
      tree:targetTree.sha,parents:[destinationBaseCommit]},fetchImpl
  });
  sha(result.sha);
  await authorize();
  const createdRef=await githubRequest(destination,"/git/refs",token,{
    method:"POST",body:{ref:"refs/heads/"+newBranch,sha:result.sha},fetchImpl
  });
  if(createdRef?.ref!=="refs/heads/"+newBranch||createdRef?.object?.sha!==result.sha)
    throw Error("new isolated CI ref confirmation mismatch");
  const verifyRef=await githubRequest(destination,"/git/ref/heads/"+newBranch,
    token,{fetchImpl});
  if(verifyRef?.ref!==createdRef.ref||verifyRef?.object?.sha!==result.sha)
    throw Error("isolated CI ref read-after-write mismatch");
  return Object.freeze({status:"PRIVATE_MIRROR_PUBLISHED",destination,newBranch,
    sourceCommit,sourceTree:srcCommit.tree.sha,commit:result.sha,blobs:files.length});
}





const source="ores-truffle-oreslang/oreslang-source.java";
const destination="akrion-sim/akrion-sim-e2e";
const A="a".repeat(40),B="b".repeat(40),C="c".repeat(40),
 D="d".repeat(40),E="e".repeat(40);
const opts={source,destination,sourceCommit:A,destinationBaseCommit:B,
  prefix:"snapshots/checked",newBranch:"ci/private-test-proof",
  approvedDestinations:[destination],token:"opaque-test-token"};
const good=name=>({full_name:name,private:true,visibility:"private",
  archived:false,permissions:{push:true}});

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
      if(suffix==="/git/commits/"+A)data={tree:{sha:D}};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data=sourceTree||{truncated:false,tree:[{type:"blob",path:"main.ores",sha:C,size:4,mode:"100644"}]};
      else if(suffix==="/git/blobs/"+C)
        data={sha:C,encoding:"base64",content:"NDI7Cg==",size:4};
    } else {
      if(suffix==="/git/commits/"+B)data={tree:{sha:E}};
      else if(suffix==="/git/blobs/"+C)
        data={sha:C,encoding:"base64",content:"NDI7Cg==",size:4};
      else if(suffix==="/git/trees/"+E+"?recursive=1")
        data=destinationTree||{truncated:false,tree:[{path:"unrelated/readme.txt",type:"blob"}]};
      else if(suffix==="/git/trees/"+D+"?recursive=1")
        data=materializedTree||{truncated:false,tree:[
          {path:"snapshots",type:"tree"},
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
  newBranch:opts.newBranch,sourceCommit:A,sourceTree:D,commit:E,blobs:1});
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
  {path:"snapshots/checked",type:"tree",sha:D},
  {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C},
  {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C}
 ]};
 const {h,promise}=run({materializedTree:tree});
 await assert.rejects(promise,/materialized snapshot contains duplicate paths/);
 assert.equal(h.events.some(e=>e.path===destination+"/git/refs"),false);
});


test("bounded Java and LLVM sized trees still require private authorization and exact materialization",async()=>{
 for(const count of [1177,1291]){
  // These are deterministic synthetic Git blob inventories, not actual source
  // copies. Repeated immutable blob SHA is legal for distinct Git tree paths.
  const files=Array.from({length:count},(_,i)=>({
   type:"blob",path:`src/file-${i}.ores`,sha:C,size:4,mode:"100644"
  }));
  const materializedTree={truncated:false,tree:[
   {path:"snapshots",type:"tree"},
   {path:"snapshots/checked",type:"tree",sha:D},
   ...files.map(f=>({path:"snapshots/checked/"+f.path,
      type:"blob",mode:f.mode,sha:f.sha}))
  ]};
  const {h,promise}=run({sourceTree:{truncated:false,tree:files},materializedTree});
  const receipt=await promise;
  assert.equal(receipt.blobs,count);
  assert.equal(h.events.filter(e=>e.path===destination+"/git/blobs"&&e.method==="POST").length,count);
  assert.equal(h.events.filter(e=>e.path===destination+"/git/refs"&&e.method==="POST").length,1);
  assert.ok(h.seen.source>=count+4&&h.seen.destination>=count+4,
    "every write requires renewed private-visibility admission");
 }
});
test("bounded file-count cap refuses oversized trees before copying any source blobs",async()=>{
 const files=Array.from({length:1501},(_,i)=>({
  type:"blob",path:`src/file-${i}.ores`,sha:C,size:4,mode:"100644"
 }));
 const {h,promise}=run({sourceTree:{truncated:false,tree:files}});
 await assert.rejects(promise,/unsupported source tree size/);
 assert.equal(h.events.some(e=>e.path===source+"/git/blobs/"+C),false);
 assert.equal(h.events.filter(e=>e.method==="POST").length,0);
});

test("materialized subtree Git SHA is required before creating a commit or CI ref",async()=>{
 for(const subtree of [undefined,E]){
  const materializedTree={truncated:false,tree:[
   {path:"snapshots",type:"tree"},
   {path:"snapshots/checked",type:"tree",sha:subtree},
   {path:"snapshots/checked/main.ores",type:"blob",mode:"100644",sha:C}
  ]};
  const {h,promise}=run({materializedTree});
  await assert.rejects(promise,/materialized snapshot source subtree SHA mismatch/);
  assert.equal(h.events.some(e=>e.path===destination+"/git/commits"&&e.method==="POST"),false);
  assert.equal(h.events.some(e=>e.path===destination+"/git/refs"&&e.method==="POST"),false);
 }
});

const threeSourceFiles=Array.from({length:3},(_,i)=>({
 type:"blob",path:"private-"+i+".ores",sha:C,size:4,mode:"100644"
}));
const threeSourceTree={truncated:false,tree:threeSourceFiles};
const threeMaterializedTree={truncated:false,tree:[
 {path:"snapshots",type:"tree"},
 {path:"snapshots/checked",type:"tree",sha:D},
 ...threeSourceFiles.map(f=>({path:"snapshots/checked/"+f.path,
  type:"blob",mode:f.mode,sha:f.sha}))
]};
test("resumable stages keep the branch unreachable until all exact blobs verify",async()=>{
 const h=fixture({sourceTree:threeSourceTree,materializedTree:threeMaterializedTree});
 const first=await publishPrivateMirror({...opts,fetchImpl:h.request,maxBlobsPerRun:2});
 assert.equal(first.status,"PRIVATE_MIRROR_STAGED");
 assert.equal(first.checkpoint.nextIndex,2);
 assert.equal(first.copiedThisBatch,2);
 assert.equal(first.remaining,1);
 assert.equal(first.checkpoint.sourceCommit,A);
 assert.equal(first.checkpoint.sourceTree,D);
 assert.equal(first.checkpoint.destinationBaseTree,E);
 assert.deepEqual(h.events.filter(x=>x.method==="POST").map(x=>x.path),
  [destination+"/git/blobs",destination+"/git/blobs"]);
 const second=await publishPrivateMirror({...opts,fetchImpl:h.request,maxBlobsPerRun:2,
  checkpoint:first.checkpoint});
 assert.equal(second.status,"PRIVATE_MIRROR_PUBLISHED");
 assert.equal(second.blobs,3);
 assert.deepEqual(h.events.filter(x=>x.method==="POST").map(x=>x.path),[
  destination+"/git/blobs",destination+"/git/blobs",
  destination+"/git/blobs",destination+"/git/trees",
  destination+"/git/commits",destination+"/git/refs"
 ]);
 const lastResumeBlob=destination+"/git/blobs/"+C;
 assert.ok(h.events.some(x=>x.method==="GET"&&x.path===lastResumeBlob));
});
test("tampered resume pins and cursor are rejected before ANY new blobs are fetched",async()=>{
 const h=fixture({sourceTree:threeSourceTree,materializedTree:threeMaterializedTree});
 const first=await publishPrivateMirror({...opts,fetchImpl:h.request,maxBlobsPerRun:1});
 const base=first.checkpoint;
 for(const changes of [
  {sourceCommit:B},{sourceTree:E},{destinationBaseTree:D},
  {destination:"other/private"},{prefix:"snapshots/other"},
  {newBranch:"ci/private-replay"},{nextIndex:3},{nextIndex:0},
  {nextIndex:1.5},{lastBlobSha:D},{totalBlobs:20}
 ]){
  const before=h.events.length;
  await assert.rejects(publishPrivateMirror({...opts,fetchImpl:h.request,
   maxBlobsPerRun:1,checkpoint:{...base,...changes}}));
  assert.equal(h.events.filter(x=>x.method==="POST").length,1,
    "tampered cursor must not stage any new source bytes");
  // Legitimate metadata/immutable manifest reads may happen before rejection.
  assert.ok(h.events.length>=before);
 }
});
test("missing checkpointed Git blob fails closed without creating a snapshot ref",async()=>{
 const h=fixture({sourceTree:threeSourceTree,materializedTree:threeMaterializedTree});
 const first=await publishPrivateMirror({...opts,fetchImpl:h.request,maxBlobsPerRun:1});
 const rejectDestinationBlob=async(url,options)=>{
  if(url==="https://api.github.com/repos/"+destination+"/git/blobs/"+C)
    return {status:404,json:async()=>({message:"not found"})};
  return h.request(url,options);
 };
 await assert.rejects(publishPrivateMirror({...opts,fetchImpl:rejectDestinationBlob,
  maxBlobsPerRun:1,checkpoint:first.checkpoint}));
 assert.equal(h.events.filter(x=>x.method==="POST").length,1);
 assert.equal(h.events.some(x=>x.path===destination+"/git/refs"),false);
});
test("privacy revocation between bounded batches fails before a second mutation",async()=>{
 const h=fixture({sourceTree:threeSourceTree,materializedTree:threeMaterializedTree,
  meta:(name,n)=>name===destination&&n>=4?{...good(name),visibility:"public",private:false}:good(name)});
 const first=await publishPrivateMirror({...opts,fetchImpl:h.request,maxBlobsPerRun:1});
 assert.equal(first.status,"PRIVATE_MIRROR_STAGED");
 await assert.rejects(publishPrivateMirror({...opts,fetchImpl:h.request,
  maxBlobsPerRun:1,checkpoint:first.checkpoint}),/writable verified PRIVATE/);
 assert.equal(h.events.filter(x=>x.method==="POST").length,1);
});
test("malformed bounded batch sizes and checkpoint shapes never contact GitHub",async()=>{
 for(const extra of [
  {maxBlobsPerRun:0},{maxBlobsPerRun:65},{maxBlobsPerRun:-1},
  {maxBlobsPerRun:1.1},{maxBlobsPerRun:"5"},
  {checkpoint:null},{checkpoint:[]},{checkpoint:{}}
 ]){
  const h=fixture();
  await assert.rejects(publishPrivateMirror({...opts,fetchImpl:h.request,...extra}));
  assert.equal(h.events.length,0);
 }
});

test("case-colliding source directories reject BEFORE any private blob write",async()=>{
 const sourceTree={truncated:false,tree:[
  {path:"Foo",type:"tree",mode:"040000",sha:D},
  {path:"foo",type:"tree",mode:"040000",sha:D},
  {path:"Foo/one.ores",type:"blob",mode:"100644",sha:C,size:4},
  {path:"foo/two.ores",type:"blob",mode:"100644",sha:C,size:4}
 ]};
 const h=fixture({sourceTree});
 await assert.rejects(
   publishPrivateMirror({...opts,fetchImpl:h.request,maxBlobsPerRun:1}),
   /cross-platform-colliding source directory component/);
 assert.equal(h.events.filter(x=>x.method==="POST").length,0);
});
test("Windows-reserved filenames and trailing-dot paths reject before source bytes",async()=>{
 for(const path of ["CON","nul.ores","LPT1.txt","AUX.md","dir/file.","dir/COM9.ores"]){
  const h=fixture({sourceTree:{truncated:false,tree:[
   {path,type:"blob",mode:"100644",sha:C,size:4}]}});
  await assert.rejects(publishPrivateMirror({...opts,fetchImpl:h.request}),
   /unsafe or oversized private source tree entry/);
  assert.equal(h.events.filter(x=>x.method==="POST").length,0,path);
  assert.equal(h.events.some(x=>x.path===source+"/git/blobs/"+C),false,path);
 }
});
test("case-mismatched destination ancestor cannot silently alias source prefix",async()=>{
 const h=fixture({destinationTree:{truncated:false,tree:[
  {path:"Snapshots",type:"tree",sha:D,mode:"040000"},
  {path:"unrelated/readme.txt",type:"blob"}
 ]}});
 await assert.rejects(publishPrivateMirror({...opts,fetchImpl:h.request}),
  /destination snapshot prefix is not empty or conflicts/);
 assert.equal(h.events.filter(x=>x.method==="POST").length,0);
});
test("source directory SHA and mode must be valid before any publication",async()=>{
 for(const bad of [{path:"lib",type:"tree",mode:"100644",sha:D},
                   {path:"lib",type:"tree",mode:"040000",sha:"not-a-sha"},
                   {path:"tmp.",type:"tree",mode:"040000",sha:D}]){
  const h=fixture({sourceTree:{truncated:false,tree:[
   bad,{path:"main.ores",type:"blob",mode:"100644",sha:C,size:4}]}});
  await assert.rejects(publishPrivateMirror({...opts,fetchImpl:h.request}),
   /unsafe private source directory entry/);
  assert.equal(h.events.filter(x=>x.method==="POST").length,0);
 }
});
