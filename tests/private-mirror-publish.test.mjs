import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";

// This is intentionally a denial-only contract. Legacy simulated Git object
// writes were never proof of independent transfer approval or native CI.
const DENIED=/PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL/;
const source="synthetic-private/source";
const destination="synthetic-private/carrier";
const A="a".repeat(40),B="b".repeat(40);
const base={source,destination,sourceCommit:A,destinationBaseCommit:B,
  prefix:"snapshots/checked",newBranch:"ci/private-test-proof",
  approvedDestinations:[destination],token:"synthetic-test-token"};

async function deniedWithoutGitHub(modifications={}) {
  const actions=[];
  const fetchImpl=async(url,options)=>{
    actions.push({url,method:options?.method});
    throw Error("GITHUB_NETWORK_MUST_NOT_EXECUTE");
  };
  await assert.rejects(publishPrivateMirror({...base,...modifications,fetchImpl}),DENIED);
  assert.deepEqual(actions,[], "must not read private source or write Git objects");
}

test("publisher cannot create source blobs, trees, commits or refs for any owner",async()=>{
  for(const [from,to] of [
    [source,destination],
    ["ores-truffle-oreslang/oreslang-source.java","voxletra/carrier"],
    ["ORES-TRUFFLE-ORESLANG/oreslang-source.llvm","ORES-TRUFFLE-ORESLANG/private-ci"],
    ["zed-pkg-test/java-app","zed-pkg-test/java-app"],
    ["ores-llm/ores-llm-ml-conformance-tests","ores-llm/fresh-carrier"],
    ["unknown-relay/old-source-copy","unknown-relay/new-source-copy"],
    ["unknown-relay/old-source-copy","other-relay/new-source-copy"],
    [source,source]
  ]) await deniedWithoutGitHub({source:from,destination:to,approvedDestinations:[to]});
});

test("caller-controlled approvals and credentials cannot enable private mirror",async()=>{
  for(const modifications of [
    {approvedDestinations:[]},
    {approvedDestinations:[destination]},
    {approvedDestinations:[destination.toUpperCase()]},
    {approvedDestinations:Array(100).fill(destination)},
    {approvedDestinations:null},
    {token:undefined},
    {token:""},
    {token:"different-opaque-test-token"},
    {sourceCommit:"bad"},
    {destinationBaseCommit:"bad"},
    {newBranch:"main"},
    {newBranch:"ci/private-invalid"},
    {prefix:"../secret"},
    {prefix:"/tmp/absolute"},
    {source:"../../escape",destination:"x/y"}
  ]) await deniedWithoutGitHub(modifications);
});

test("attempted API mock bypass never makes a single private-source GET or POST",async()=>{
  let calls=0;
  const fakeSuccess=async()=>{
    calls++;
    return {status:200,json:async()=>({
      id:90001,full_name:destination,private:true,visibility:"private",
      fork:false,disabled:false,archived:false,default_branch:"main",
      permissions:{push:true}
    })};
  };
  await assert.rejects(publishPrivateMirror({...base,fetchImpl:fakeSuccess}),DENIED);
  assert.equal(calls,0);
});

test("publisher's own first executable statement denies before parsing or authorizing",()=>{
  const src=readFileSync(new URL("../bin/private-mirror-publish.mjs",import.meta.url),"utf8");
  const fn=src.slice(src.indexOf("export async function publishPrivateMirror("));
  assert.match(fn,/\}\) \{\s*\/\/ Defense in depth/);
  const lockdown=fn.indexOf('throw Error("PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL")');
  assert.ok(lockdown>=0,"lockdown must not be removed");
  for(const action of [
    "sha(sourceCommit);sha(destinationBaseCommit);",
    "await authorize();",
    "const srcCommit=await githubRequest(",
    'method:"POST"'
  ]) {
    const index=fn.indexOf(action);
    assert.ok(index<0||lockdown<index,"publisher lockdown must precede "+action);
  }
});

test("the lower-level authorization function is also locked down",()=>{
  const body=readFileSync(new URL("../bin/require-private-mirror.mjs",import.meta.url),"utf8");
  assert.match(body,/PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL/);
});
