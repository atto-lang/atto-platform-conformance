#!/usr/bin/env node
/**
 * The ONLY supported private cross-repository source-copy entrypoint.
 * Do not use a generic push/copy workflow to bypass this gate.
 * This creates immutable source blobs and a NEW ci/private-* branch; it
 * never overwrites an existing ref or writes to the destination main branch.
 */
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {requirePrivateMirror} from "./require-private-mirror.mjs";
import {verifySourceTree} from "./verify-source-tree.mjs";

const OID=/^[a-f0-9]{40}$/;
const PATH=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const BRANCH=/^ci\/private-[A-Za-z0-9][A-Za-z0-9._-]{0,75}$/;

function validPath(path) {
  return typeof path==="string" && path.length<=512 && PATH.test(path) &&
    path.split("/").every(x=>x!=="."&&x!==".."&&x.toLowerCase()!==".git");
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
  approvedDestinations,token,fetchImpl=fetch
}) {
  sha(sourceCommit);sha(destinationBaseCommit);
  // Snapshot files must never be placed at the destination repository root.
  // In particular a caller-selected ".github" prefix could copy an
  // untrusted source "workflows/*.yml" into executable GitHub Actions
  // configuration on the temporary branch. Keep ALL mirrors under an
  // isolated, non-executable repository subtree.
  if(!validPath(prefix)||!prefix.startsWith("snapshots/")||
     !BRANCH.test(newBranch)||newBranch.includes("..")||newBranch.endsWith(".lock"))
    throw Error("invalid destination prefix or isolated CI branch");
  const authorize=()=>requirePrivateMirror({
    source,destination,approvedDestinations,token,fetchImpl
  });
  // The caller must not supply an arbitrary destination base tree containing
  // attacker-controlled workflows or stale confidential source. Pin the base
  // to the current, reviewed default-main ref, and recheck it before publish.
  const requireTrustedBase=async()=>{
    const ref=await githubRequest(destination,"/git/ref/heads/main",token,{fetchImpl});
    if(ref?.ref!=="refs/heads/main"||ref?.object?.type!=="commit"||
       ref?.object?.sha!==destinationBaseCommit)
      throw Error("destination base must equal current trusted main HEAD");
  };
  // FIRST external operation: authorization, before ANY source bytes are fetched
  // and before ANY destination object/ref is created.
  await authorize();
  await requireTrustedBase();
  const srcCommit=await githubRequest(source,"/git/commits/"+sourceCommit,token,{fetchImpl});
  if(srcCommit?.sha!==sourceCommit||!OID.test(srcCommit?.tree?.sha||""))
    throw Error("source commit SHA or pinned tree is invalid");
  const srcTree=await githubRequest(source,"/git/trees/"+srcCommit.tree.sha+"?recursive=1",token,{fetchImpl});
  // A GitHub API listing, even with individually pinned blob IDs, does not
  // prove those paths and modes belong to the source commit. Rehash ALL tree
  // objects and the source root before reading or publishing a private blob.
  verifySourceTree(srcCommit.tree.sha,srcTree);
  const files=srcTree.tree.filter(x=>x.type==="blob");
  if(files.length===0||files.length>750||srcTree.tree.length>3000)
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
  for(const file of srcTree.tree){
    if(!["tree","blob"].includes(file.type))
      throw Error("unsupported source tree object");
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
       (wanted.startsWith(current+"/")&&item.type!=="tree"))
      throw Error("destination snapshot prefix is not empty or conflicts with existing path");
  }
  // Validate the complete source-independent part of the destination base.
  // Materializing a verified snapshot MUST NOT silently alter a workflow,
  // configuration or any other file elsewhere in the carrier repository.
  // Parent tree hashes naturally change when a nested snapshot is added.
  const isUnrelated=path=>path!==prefix&&!path.startsWith(prefix+"/")&&
    !prefix.startsWith(path+"/");
  const baseUnrelated=new Map();
  for(const item of baseInventory.tree){
    if(!isUnrelated(item.path))continue;
    if(!["tree","blob","commit"].includes(item.type)||
       typeof item.mode!=="string"||!OID.test(item.sha||"")||
       baseUnrelated.has(item.path))
      throw Error("destination base outside snapshot cannot be attested");
    baseUnrelated.set(item.path,item);
  }
  const entries=[];
  for(const file of files){
    const srcBlob=await githubRequest(source,"/git/blobs/"+file.sha,token,{fetchImpl});
    if(srcBlob?.sha!==file.sha||srcBlob.encoding!=="base64"||
       typeof srcBlob.content!=="string"||srcBlob.size!==file.size)
      throw Error("source blob content identity or encoding mismatch");
    // Bound the RAW API payload before normalizing it: an attacker-controlled
    // response full of whitespace must not allocate an unbounded replacement
    // string. GitHub line-wraps base64, so allow ample newline slack (1/32)
    // beyond the canonical payload while bounding a 1MiB blob near 1.5MiB.
    const canonicalMax=4*Math.ceil(file.size/3);
    if(srcBlob.content.length>canonicalMax+Math.ceil(file.size/32)+256)
      throw Error("source blob transport payload exceeds pinned size budget");
    // Verify the transport representation BEFORE copying private bytes.
    // Node's base64 decoder alone is permissive of malformed/trailing data;
    // require a canonical round-trip and the pinned Git tree's byte length.
    const encoded=srcBlob.content.replace(/\s/g,"");
    if(encoded.length>Math.ceil(file.size/3)*4+4||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
      throw Error("source blob payload is not valid pinned base64");
    const bytes=Buffer.from(encoded,"base64");
    if(bytes.length!==file.size||bytes.toString("base64")!==encoded)
      throw Error("source blob payload is not valid pinned base64");
    // GitHub's response sha is a claim, not independent evidence that the
    // encoded bytes match the pinned source Git object. Calculate the exact
    // Git blob SHA-1 locally BEFORE copying any confidential bytes.
    const actualBlobSha=createHash("sha1")
      .update("blob "+bytes.length+"\0").update(bytes).digest("hex");
    if(actualBlobSha!==file.sha)
      throw Error("source blob bytes differ from pinned Git SHA");
    // Recheck confidentiality and the reviewed destination-main base
    // BEFORE every Git object mutation, including unreferenced blob writes.
    await authorize();
    await requireTrustedBase();
    const pushed=await githubRequest(destination,"/git/blobs",token,{
      method:"POST",body:{content:encoded,encoding:"base64"},fetchImpl
    });
    if(pushed.sha!==file.sha)throw Error("destination blob SHA differs from source");
    entries.push({path:prefix+"/"+file.path,mode:file.mode,type:"blob",sha:pushed.sha});
  }
  await authorize();
  await requireTrustedBase();
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
  const expected=new Map(entries.map(e=>[e.path,e]));
  let verified=0;
  const seenMaterialized=new Set(),seenUnrelated=new Set();
  for(const item of materialized.tree){
    if(typeof item?.path!=="string"||typeof item.type!=="string")
      throw Error("invalid materialized snapshot tree entry");
    if(isUnrelated(item.path)){
      const original=baseUnrelated.get(item.path);
      if(!original||seenUnrelated.has(item.path)||
         item.type!==original.type||item.mode!==original.mode||
         item.sha!==original.sha)
        throw Error("materialized destination changed files outside snapshot");
      seenUnrelated.add(item.path);
      continue;
    }
    if(item.path===prefix||prefix.startsWith(item.path+"/")){
      if(item.type!=="tree")
        throw Error("materialized snapshot parent is not a tree");
      continue;
    }
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
  if(seenUnrelated.size!==baseUnrelated.size)
    throw Error("materialized destination omitted files outside snapshot");
  await authorize();
  await requireTrustedBase();
  const result=await githubRequest(destination,"/git/commits",token,{
    method:"POST",body:{message:"ci: verified private source snapshot "+sourceCommit,
      tree:targetTree.sha,parents:[destinationBaseCommit]},fetchImpl
  });
  sha(result.sha);
  await authorize();
  await requireTrustedBase();
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
    sourceCommit,commit:result.sha,blobs:files.length});
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    if(process.argv.length!==8)
      throw Error("usage: private-mirror-publish.mjs <source> <sourceSHA> <destination> <baseSHA> <prefix> <ci/private-branch>");
    const result=await publishPrivateMirror({
      source:process.argv[2],sourceCommit:process.argv[3],
      destination:process.argv[4],destinationBaseCommit:process.argv[5],
      prefix:process.argv[6],newBranch:process.argv[7],
      approvedDestinations:(process.env.ORES_APPROVED_PRIVATE_MIRRORS||"").split(",").filter(Boolean),
      token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN
    });
    console.log(JSON.stringify(result));
  }catch{
    console.error("PRIVATE_MIRROR_DENIED: confidential source copy rejected");
    process.exitCode=1;
  }
}
