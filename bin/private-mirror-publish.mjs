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

function validPath(path) {
  return typeof path==="string" && path.length<=512 && PATH.test(path) &&
    path.split("/").every(x=>x!=="."&&x!==".."&&x!==".git");
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
  if(!validPath(prefix)||!BRANCH.test(newBranch))throw Error("invalid destination prefix or isolated CI branch");
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
    if(paths.has(file.path))throw Error("duplicate source path");
    paths.add(file.path);
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
  const entries=[];
  for(const file of files){
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
    entries.push({path:prefix+"/"+file.path,mode:file.mode,type:"blob",sha:pushed.sha});
  }
  await authorize();
  const targetTree=await githubRequest(destination,"/git/trees",token,{
    method:"POST",body:{base_tree:base.tree.sha,tree:entries},fetchImpl
  });
  sha(targetTree.sha);
  await authorize();
  const result=await githubRequest(destination,"/git/commits",token,{
    method:"POST",body:{message:"ci: verified private source snapshot "+sourceCommit,
      tree:targetTree.sha,parents:[destinationBaseCommit]},fetchImpl
  });
  sha(result.sha);
  await authorize();
  await githubRequest(destination,"/git/refs",token,{
    method:"POST",body:{ref:"refs/heads/"+newBranch,sha:result.sha},fetchImpl
  });
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
