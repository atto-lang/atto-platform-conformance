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

const OID=/^[a-f0-9]{40}$/;
const PATH=/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const BRANCH=/^ci\/private-[A-Za-z0-9][A-Za-z0-9._-]{0,75}$/;

// Do not silently rewrite source/destination path components. Git on macOS
// or Windows may otherwise materialize a different path than the pinned tree.
const WINDOWS_DEVICE=/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
function validPath(path) {
  return typeof path==="string" && path.length<=512 && PATH.test(path) &&
    path.split("/").every(x=>x!=="."&&x!==".."&&x.toLowerCase()!==".git"&&
      !x.endsWith(".")&&!WINDOWS_DEVICE.test(x));
}
function sha(value) {
  if(typeof value!=="string"||!OID.test(value))throw Error("invalid immutable Git commit or blob SHA");
  return value;
}
/** Independently verify Git blob bytes; API-reported SHA/size are untrusted. */
export function verifyGitBlob(content, expectedSha, expectedSize) {
  if(typeof content!=="string"||!OID.test(expectedSha)||
     !Number.isSafeInteger(expectedSize)||expectedSize<0||expectedSize>1048576)
    throw Error("unsafe Git source blob identity or size");
  // GitHub's blob API can wrap base64 over lines. No other base64
  // whitespace/alphabet ambiguity is allowed at this security boundary.
  const encoded=content.replace(/[\r\n]/g,"");
  if(encoded.length>1398104||!(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(encoded))
    throw Error("invalid canonical Git source blob encoding");
  const bytes=Buffer.from(encoded,"base64");
  if(bytes.length!==expectedSize||bytes.toString("base64")!==encoded)
    throw Error("Git source blob byte length or base64 identity mismatch");
  const digest=createHash("sha1")
    .update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  if(digest!==expectedSha)
    throw Error("Git source blob content hash does not match pinned tree");
  return encoded;
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
  source,destination,sourceCommit,sourceTree,destinationBaseCommit,prefix,newBranch,
  approvedDestinations,token,fetchImpl=fetch
}) {
  sha(sourceCommit);sha(sourceTree);sha(destinationBaseCommit);
  if(!validPath(prefix)||!BRANCH.test(newBranch)||newBranch.includes("..")||
     newBranch.endsWith(".")||newBranch.toLowerCase().endsWith(".lock"))
    throw Error("invalid destination prefix or isolated CI branch");
  // Do not graft a confidential source snapshot onto an arbitrary or stale
  // destination commit. A protected destination main is required by admission;
  // the caller's immutable base must also equal that protected main HEAD.
  // Recheck before EACH remote mutation to deny base drift after admission.
  const authorize=async()=>{
    await requirePrivateMirror({
      source,destination,sourceCommit,sourceTree,approvedDestinations,token,fetchImpl
    });
    const protectedMain=await githubRequest(destination,"/branches/main",token,{fetchImpl});
    if(protectedMain?.name!=="main"||protectedMain.protected!==true||
       protectedMain?.commit?.sha!==destinationBaseCommit)
      throw Error("destination base commit differs from protected carrier main");
  };
  // FIRST external operation: authorization, before ANY source bytes are fetched
  // and before ANY destination object/ref is created.
  await authorize();
  const srcCommit=await githubRequest(source,"/git/commits/"+sourceCommit,token,{fetchImpl});
  if(srcCommit?.sha !== sourceCommit || srcCommit?.tree?.sha !== sourceTree)
    throw Error("source commit/tree differ from approved immutable snapshot");
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
    const folded=file.path.toLowerCase();
    if(paths.has(folded))throw Error("duplicate or cross-platform-colliding source path");
    paths.add(folded);
    totalBytes+=file.size;
    if(totalBytes>41943040)throw Error("private mirror exceeds 40MiB limit");
  }
  // Reject anomalous Git-tree API responses that claim both a regular file
  // and a directory at the same case-folded pathname. Never read or write
  // private source bytes until the entire manifest is unambiguous.
  for(const folded of paths){
    const segments=folded.split("/");
    for(let i=1;i<segments.length;i++){
      if(paths.has(segments.slice(0,i).join("/")))
        throw Error("file/directory-alias source path");
    }
  }
  // Validate directory objects as well as source blobs. A malformed Git
  // tree may conceal a case-folded file/directory collision or unsafe
  // directory name that would materialize differently on another platform.
  const sourcePaths=new Map();
  for(const entry of srcTree.tree){
    if(!["tree","blob"].includes(entry?.type))
      throw Error("unsupported source tree object");
    if(!validPath(entry.path)||!OID.test(entry.sha)||
       (entry.type==="tree"&&entry.mode!=="040000"))
      throw Error("unsafe Git source tree directory identity");
    const folded=entry.path.toLowerCase();
    if(sourcePaths.has(folded))
      throw Error("duplicate or case-colliding Git source tree entry");
    sourcePaths.set(folded,{path:entry.path,type:entry.type});
  }
  for(const [folded,entry] of sourcePaths){
    const components=folded.split("/");
    const exact=entry.path.split("/");
    for(let i=1;i<components.length;i++){
      const parent=sourcePaths.get(components.slice(0,i).join("/"));
      if(parent&&(parent.type!=="tree"||
         parent.path!==exact.slice(0,i).join("/")))
        throw Error("source tree file/directory alias or inconsistent case");
    }
  }
  const base=await githubRequest(destination,"/git/commits/"+destinationBaseCommit,token,{fetchImpl});
  if(base?.sha!==destinationBaseCommit||!OID.test(base?.tree?.sha||""))
    throw Error("destination base commit/tree differs from protected immutable commit");
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
  const entries=[];
  for(const file of files){
    const srcBlob=await githubRequest(source,"/git/blobs/"+file.sha,token,{fetchImpl});
    if(srcBlob?.sha!==file.sha||srcBlob.encoding!=="base64"||
       typeof srcBlob.content!=="string"||srcBlob.size!==file.size)
      throw Error("source blob content identity or encoding mismatch");
    const verifiedBase64=verifyGitBlob(srcBlob.content,file.sha,file.size);
    // Recheck CURRENT confidentiality before EVERY destination mutation.
    await authorize();
    const pushed=await githubRequest(destination,"/git/blobs",token,{
      method:"POST",body:{content:verifiedBase64,encoding:"base64"},fetchImpl
    });
    if(pushed.sha!==file.sha)throw Error("destination blob SHA differs from source");
    entries.push({path:prefix+"/"+file.path,mode:file.mode,type:"blob",sha:pushed.sha});
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
  const expected=new Map(entries.map(e=>[e.path,e]));
  let verified=0;
  const seenMaterialized=new Set();
  const foldedPrefix=prefix.toLowerCase();
  const seenMaterializedFolded=new Set();
  for(const item of materialized.tree){
    if(typeof item?.path!=="string"||typeof item.type!=="string")
      throw Error("invalid materialized snapshot tree entry");
    const folded=item.path.toLowerCase();
    // The source may be built on macOS/Windows. A server-side tree with
    // another spelling of this prefix must never become executable input,
    // even when the exact-case prefix contains all pinned source blobs.
    if(folded===foldedPrefix){
      if(item.path!==prefix||item.type!=="tree")
        throw Error("materialized snapshot prefix has a case collision");
      continue;
    }
    if(!folded.startsWith(foldedPrefix+"/"))continue;
    if(!item.path.startsWith(prefix+"/"))
      throw Error("materialized snapshot contains case-colliding source paths");
    if(seenMaterializedFolded.has(folded))
      throw Error("materialized snapshot contains case-colliding source paths");
    seenMaterializedFolded.add(folded);
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
  // A returned commit SHA alone does not prove that the accepted Git object
  // really has our verified tree and exactly one approved protected-main
  // parent. Read it back before making the commit reachable via a branch ref.
  const committed=await githubRequest(destination,"/git/commits/"+result.sha,token,{fetchImpl});
  if(committed?.sha!==result.sha||committed?.tree?.sha!==targetTree.sha||
     !Array.isArray(committed.parents)||committed.parents.length!==1||
     committed.parents[0]?.sha!==destinationBaseCommit)
    throw Error("destination committed tree or immutable parent differs from pinned publication");
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
    sourceCommit,commit:result.sha,blobs:files.length});
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    if(process.argv.length!==9)
      throw Error("usage: private-mirror-publish.mjs <source> <sourceSHA> <sourceTREE> <destination> <baseSHA> <prefix> <ci/private-branch>");
    const result=await publishPrivateMirror({
      source:process.argv[2],sourceCommit:process.argv[3],sourceTree:process.argv[4],
      destination:process.argv[5],destinationBaseCommit:process.argv[6],
      prefix:process.argv[7],newBranch:process.argv[8],
      approvedDestinations:(process.env.ORES_APPROVED_PRIVATE_MIRRORS||"").split(",").filter(Boolean),
      token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN
    });
    console.log(JSON.stringify(result));
  }catch{
    console.error("PRIVATE_MIRROR_DENIED: confidential source copy rejected");
    process.exitCode=1;
  }
}
