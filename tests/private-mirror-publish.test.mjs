import {test} from "node:test";
import assert from "node:assert/strict";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";

const source="ores-truffle-oreslang/oreslang-source.java";
const destination="example-private-org/example-private-carrier";
const A="a".repeat(40),B="b".repeat(40);

function base(fetchImpl){
  return {
    source,
    destination,
    sourceCommit:A,
    destinationBaseCommit:B,
    prefix:"snapshots/checked",
    newBranch:"ci/private-test-proof",
    approvedDestinations:[destination],
    token:"opaque-test-token",
    fetchImpl
  };
}

test("private-source publisher is fail-closed before any external operation", async()=>{
  const calls=[];
  const fetchImpl=async(...args)=>{
    calls.push(args);
    throw Error("network should never be reached");
  };
  await assert.rejects(
    publishPrivateMirror(base(fetchImpl)),
    /PRIVATE_SOURCE_EXPORT_DISABLED/
  );
  assert.deepEqual(calls,[]);
});

test("caller-supplied allowlist cannot authorize private-source transfer", async()=>{
  for(const approvedDestinations of [
    [destination],
    [destination.toUpperCase()],
    ["other-org/other-private-repo"],
    [destination,"other-org/other-private-repo"]
  ]){
    let contacted=false;
    await assert.rejects(
      publishPrivateMirror({...base(async()=>{contacted=true;}),approvedDestinations}),
      /PRIVATE_SOURCE_EXPORT_DISABLED/
    );
    assert.equal(contacted,false);
  }
});

test("fork, cross-org, renamed, and same-name destinations remain quarantined", async()=>{
  for(const destinationValue of [
    "fork-owner/example-private-carrier",
    "different-org/example-private-carrier",
    "example-private-org/renamed-carrier",
    "EXAMPLE-PRIVATE-ORG/EXAMPLE-PRIVATE-CARRIER"
  ]){
    let contacted=false;
    await assert.rejects(
      publishPrivateMirror({...base(async()=>{contacted=true;}),destination:destinationValue}),
      /PRIVATE_SOURCE_EXPORT_DISABLED/
    );
    assert.equal(contacted,false);
  }
});

test("missing or malformed policy inputs do not weaken quarantine", async()=>{
  for(const overrides of [
    {},
    {approvedDestinations:[]},
    {approvedDestinations:undefined},
    {token:undefined},
    {sourceCommit:"not-a-sha"},
    {destinationBaseCommit:"not-a-sha"},
    {newBranch:"main"},
    {prefix:"../src"}
  ]){
    let contacted=false;
    await assert.rejects(
      publishPrivateMirror({...base(async()=>{contacted=true;}),...overrides}),
      /PRIVATE_SOURCE_EXPORT_DISABLED/
    );
    assert.equal(contacted,false);
  }
});
