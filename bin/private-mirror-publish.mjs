#!/usr/bin/env node
/**
 * The ONLY supported private cross-repository source-copy entrypoint.
 * Do not use a generic push/copy workflow to bypass this gate.
 * This creates immutable source blobs and a NEW ci/private-* branch; it
 * never overwrites an existing ref or writes to the destination main branch.
 */
import {pathToFileURL} from "node:url";
import {requirePrivateMirror} from "./require-private-mirror.mjs";

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

export async function publishPrivateMirror({
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

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    if(![8,9,10].includes(process.argv.length))
      throw Error("usage: private-mirror-publish.mjs <source> <sourceSHA> <destination> <baseSHA> <prefix> <ci/private-branch> [batchSize [checkpointJSON]]");
    const result=await publishPrivateMirror({
      source:process.argv[2],sourceCommit:process.argv[3],
      destination:process.argv[4],destinationBaseCommit:process.argv[5],
      prefix:process.argv[6],newBranch:process.argv[7],
      maxBlobsPerRun:process.argv[8]===undefined?undefined:Number(process.argv[8]),
      checkpoint:process.argv[9]===undefined?undefined:JSON.parse(process.argv[9]),
      approvedDestinations:(process.env.ORES_APPROVED_PRIVATE_MIRRORS||"").split(",").filter(Boolean),
      token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN
    });
    console.log(JSON.stringify(result));
  }catch{
    console.error("PRIVATE_MIRROR_DENIED: confidential source copy rejected");
    process.exitCode=1;
  }
}
