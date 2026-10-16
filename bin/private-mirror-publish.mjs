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


// Ref creation is atomic, but discover an existing target BEFORE accessing any
// confidential source bytes. A late collision would otherwise leave private
// blobs copied into the carrier without any useful CI branch.
async function requireAbsentSnapshotRef(repo,branch,token,fetchImpl=fetch) {
  let response;
  try {
    response=await fetchImpl("https://api.github.com/repos/"+repo+
      "/git/ref/heads/"+branch,{
      method:"GET",redirect:"error",
      headers:{"Accept":"application/vnd.github+json",
        "Authorization":"Bearer "+token,
        "X-GitHub-Api-Version":"2022-11-28"},
      signal:AbortSignal.timeout(10000)
    });
  }catch{
    throw Error("cannot verify destination CI ref absence");
  }
  if(response?.status===404)return;
  if(response?.status===200)
    throw Error("destination CI branch already exists");
  // 401, 403, 429, 5xx, redirects and malformed responses deny.
  throw Error("cannot verify destination CI ref absence");
}

export async function publishPrivateMirror({
  source,destination,sourceCommit,approvedSourceCommit,approvedSourceTreeSha,
  destinationBaseCommit,approvedDestinationBaseCommit,
  approvedDestinationBaseTreeSha,prefix,newBranch,
  runnerProbeRunId,approvedRunnerProbeCommit,approvedRunnerProbeWorkflow,
  approvedRunnerProbeWorkflowBlobSha,
  approvedDestinations,sourceRepositoryId,destinationRepositoryId,
  token,fetchImpl=fetch
}) {
  sha(sourceCommit);sha(destinationBaseCommit);
  sha(approvedDestinationBaseCommit);sha(approvedDestinationBaseTreeSha);
  if(destinationBaseCommit!==approvedDestinationBaseCommit)
    throw Error("destination base commit differs from independently reviewed policy pin");
  // The reviewed policy must pin BOTH the intended source commit and tree.
  // Reject caller-chosen revisions before metadata reads, much less blob copying.
  sha(approvedSourceCommit);sha(approvedSourceTreeSha);
  if(sourceCommit!==approvedSourceCommit)
    throw Error("source commit differs from independently reviewed policy pin");
  sha(approvedRunnerProbeCommit);sha(approvedRunnerProbeWorkflowBlobSha);
  if(!Number.isSafeInteger(runnerProbeRunId)||runnerProbeRunId<=0||
      typeof approvedRunnerProbeWorkflow!=="string"||
      !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(approvedRunnerProbeWorkflow))
    throw Error("reviewed source-free runner probe run and workflow are required");
  if(!validPath(prefix)||prefix.split("/").some(x=>x.toLowerCase()===".github")||
     !BRANCH.test(newBranch)||newBranch.includes("..")||newBranch.endsWith(".lock"))
    throw Error("invalid destination prefix or isolated CI branch");
  const authorize=()=>requirePrivateMirror({
    source,destination,approvedDestinations,sourceRepositoryId,
    destinationRepositoryId,token,fetchImpl
  });
  // FIRST external operation: authorization, before ANY source bytes are fetched
  // and before ANY destination object/ref is created.
  await authorize();
  await requireAbsentSnapshotRef(destination,newBranch,token,fetchImpl);
  // Prove the chosen PRIVATE carrier can actually execute a source-free job
  // BEFORE reading/copying any confidential Git objects. This is not billing
  // attestation; only a recent independently pinned successful runner probe.
  const capacityRun=await githubRequest(destination,"/actions/runs/"+runnerProbeRunId,token,{fetchImpl});
  const created=Date.parse(capacityRun?.created_at||"");
  if(capacityRun?.id!==runnerProbeRunId||capacityRun?.status!=="completed"||
     capacityRun?.conclusion!=="success"||
     !["push","workflow_dispatch"].includes(capacityRun?.event)||
     capacityRun?.head_sha!==approvedRunnerProbeCommit||
     capacityRun?.path!==approvedRunnerProbeWorkflow||
     capacityRun?.repository?.id!==destinationRepositoryId||
     capacityRun?.head_repository?.id!==destinationRepositoryId||
     !Number.isFinite(created)||created>Date.now()+300000||
     Date.now()-created>86400000)
    throw Error("destination source-free runner capacity probe not verified");
  const capacityJobs=await githubRequest(destination,
    "/actions/runs/"+runnerProbeRunId+"/jobs?per_page=100",token,{fetchImpl});
  const probeJob=capacityJobs?.jobs?.[0];
  // A reviewed source-FREE capacity workflow is deliberately one shell step.
  // The actual GitHub-hosted Ubuntu runner API surrounds it with two managed
  // steps. Reject ANY additional steps: "capacity" is not permission to run
  // arbitrary scripts, checkout source, or pass a substituted workflow.
  const expectedSteps=["Set up job",
    "Prove runner allocation and shell execution","Complete job"];
  const proofSteps=probeJob?.steps;
  const exactStepSequence=Array.isArray(proofSteps)&&
    proofSteps.length===expectedSteps.length&&
    proofSteps.every((step,i)=>step?.name===expectedSteps[i]&&
      step.status==="completed"&&step.conclusion==="success");
  if(capacityJobs?.total_count!==1||!Array.isArray(capacityJobs.jobs)||
     capacityJobs.jobs.length!==1||probeJob?.name!=="capacity"||
     probeJob?.status!=="completed"||probeJob?.conclusion!=="success"||
     probeJob?.run_id!==runnerProbeRunId||
     !Number.isSafeInteger(probeJob?.runner_id)||probeJob.runner_id<=0||
     typeof probeJob?.runner_name!=="string"||
     probeJob.runner_name.length===0||
     !exactStepSequence)
    throw Error("destination runner probe has no independently executed success step");
  // Bind the observed successful run to the independently reviewed workflow
  // *contents*, not merely a matching workflow filename or step name.
  // Commit/tree APIs operate on the destination only; do this before reading
  // any private source Git objects or creating any destination objects.
  const probeCommit=await githubRequest(destination,
    "/git/commits/"+approvedRunnerProbeCommit,token,{fetchImpl});
  if(!OID.test(probeCommit?.tree?.sha||""))
    throw Error("approved runner-probe commit has no Git tree");
  const probeTree=await githubRequest(destination,
    "/git/trees/"+probeCommit.tree.sha+"?recursive=1",token,{fetchImpl});
  if(probeTree?.truncated!==false||!Array.isArray(probeTree.tree))
    throw Error("reviewed runner-probe workflow tree incomplete");
  const workflowMatches=probeTree.tree.filter(x=>x?.path===approvedRunnerProbeWorkflow);
  if(workflowMatches.length!==1||workflowMatches[0].type!=="blob"||
     workflowMatches[0].mode!=="100644"||
     workflowMatches[0].sha!==approvedRunnerProbeWorkflowBlobSha)
    throw Error("runner probe workflow content differs from reviewed Git blob");
  await authorize();
  const base=await githubRequest(destination,"/git/commits/"+destinationBaseCommit,token,{fetchImpl});
  if(!OID.test(base?.tree?.sha||""))throw Error("destination base is not an immutable commit");
  if(base.tree.sha!==approvedDestinationBaseTreeSha)
    throw Error("destination base tree differs from independently reviewed policy pin");
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
  await authorize();
  const srcCommit=await githubRequest(source,"/git/commits/"+sourceCommit,token,{fetchImpl});
  if(!srcCommit?.tree?.sha||!OID.test(srcCommit.tree.sha))throw Error("source commit has no pinned tree");
  if(srcCommit.tree.sha!==approvedSourceTreeSha)
    throw Error("source commit tree differs from independently reviewed policy pin");
  const srcTree=await githubRequest(source,"/git/trees/"+srcCommit.tree.sha+"?recursive=1",token,{fetchImpl});
  if(srcTree.truncated!==false||!Array.isArray(srcTree.tree))throw Error("source tree incomplete");
  const files=srcTree.tree.filter(x=>x.type==="blob");
  if(files.length===0||files.length>750||srcTree.tree.length>3000)
    throw Error("unsupported source tree size");
  // Validate the ENTIRE recursive tree, including directories, before reading
  // any source blob or creating unreachable blobs in the destination.
  // Directory names can contain unsafe segments/case aliases even if their
  // child blobs look individually valid to a lenient API client.
  const seenEntries=new Map();
  for(const entry of srcTree.tree){
    if(!entry||!validPath(entry.path)||!OID.test(entry.sha)||
       !(entry.type==="tree"&&entry.mode==="040000"||
         entry.type==="blob"&&["100644","100755"].includes(entry.mode)))
      throw Error("unsafe source Git tree entry");
    const folded=entry.path.toLowerCase();
    if(seenEntries.has(folded))
      throw Error("duplicate or cross-platform-colliding source path");
    seenEntries.set(folded,entry.path);
  }
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
  // The complete, nested Git tree (including modes and names) must equal
  // the pinned source commit's tree before it is reachable through a ref.
  const nestedSource=materialized.tree.filter(e=>e?.path===prefix);
  if(nestedSource.length!==1||nestedSource[0].type!=="tree"||
      nestedSource[0].sha!==srcCommit.tree.sha)
    throw Error("materialized snapshot source subtree SHA does not equal pinned source Git tree");

  // A matching nested source subtree is not sufficient: a malformed or
  // substituted target tree could delete, replace or inject unrelated
  // destination files. Preserve the FULL reviewed base tree outside the
  // snapshot prefix. Prefix ancestors change tree OIDs by design, so compare
  // their type/mode but compare all other paths byte-for-byte by Git identity.
  const outsideBase=new Map(baseInventory.tree.filter(item=>
    !prefix.startsWith(item.path+"/") &&
    item.path!==prefix && !item.path.startsWith(prefix+"/"))
    .map(item=>[item.path,item]));
  const outsideSeen=new Set();
  for(const item of materialized.tree){
    if(typeof item?.path!=="string")continue;
    if(item.path===prefix||item.path.startsWith(prefix+"/"))continue;
    if(prefix.startsWith(item.path+"/")){
      if(item.type!=="tree"||item.mode!=="040000")
        throw Error("destination snapshot ancestor type or mode changed");
      continue;
    }
    const original=outsideBase.get(item.path);
    if(!original||outsideSeen.has(item.path)||
       item.type!==original.type||item.mode!==original.mode||
       item.sha!==original.sha)
      throw Error("destination base entries changed outside snapshot prefix");
    outsideSeen.add(item.path);
  }
  if(outsideSeen.size!==outsideBase.size)
    throw Error("destination base entries omitted outside snapshot prefix");
  // The recursive Git-tree response must also contain every ancestor leading
  // to the verified source subtree. Do not trust a forged partial tree listing
  // that happens to contain the final nested SHA and unrelated base entries.
  const segments=prefix.split("/");
  for(let count=1;count<segments.length;count++){
    const path=segments.slice(0,count).join("/");
    const matches=materialized.tree.filter(item=>item?.path===path);
    if(matches.length!==1||matches[0].type!=="tree"||
       matches[0].mode!=="040000")
      throw Error("destination snapshot path ancestor missing or changed");
  }
  await authorize();
  const result=await githubRequest(destination,"/git/commits",token,{
    method:"POST",body:{message:"ci: verified private source snapshot "+sourceCommit,
      tree:targetTree.sha,parents:[destinationBaseCommit]},fetchImpl
  });
  sha(result.sha);
  await authorize();
  await requireAbsentSnapshotRef(destination,newBranch,token,fetchImpl);
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
      token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN,
      sourceRepositoryId:Number(process.env.ORES_APPROVED_PRIVATE_SOURCE_REPO_ID),
      destinationRepositoryId:Number(process.env.ORES_APPROVED_PRIVATE_DESTINATION_REPO_ID),
      approvedDestinationBaseCommit:process.env.ORES_APPROVED_DESTINATION_BASE_COMMIT,
      approvedDestinationBaseTreeSha:process.env.ORES_APPROVED_DESTINATION_BASE_TREE_SHA,
      approvedSourceCommit:process.env.ORES_APPROVED_PRIVATE_SOURCE_COMMIT,
      approvedSourceTreeSha:process.env.ORES_APPROVED_PRIVATE_SOURCE_TREE_SHA,
      runnerProbeRunId:Number(process.env.ORES_APPROVED_RUNNER_PROBE_RUN_ID),
      approvedRunnerProbeCommit:process.env.ORES_APPROVED_RUNNER_PROBE_COMMIT,
      approvedRunnerProbeWorkflow:process.env.ORES_APPROVED_RUNNER_PROBE_WORKFLOW,
      approvedRunnerProbeWorkflowBlobSha:process.env.ORES_APPROVED_RUNNER_PROBE_WORKFLOW_BLOB_SHA
    });
    console.log(JSON.stringify(result));
  }catch{
    console.error("PRIVATE_MIRROR_DENIED: confidential source copy rejected");
    process.exitCode=1;
  }
}
