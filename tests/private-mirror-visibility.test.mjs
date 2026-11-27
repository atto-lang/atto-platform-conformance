import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";

// Lockdown tests are source-free. They must never fetch/transfer private
// source, create Git objects, or certify native compiler execution.
const DENIED = /PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL/;
const source = "synthetic-private/source";
const destination = "synthetic-private/carrier";
const baseline = {
  source, destination, approvedDestinations: [destination],
  token: "synthetic-test-token"
};

async function deniedBeforeNetwork(override = {}) {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    throw Error("NETWORK_MUST_NOT_BE_CALLED");
  };
  await assert.rejects(
    requirePrivateMirror({...baseline, ...override, fetchImpl}),
    DENIED
  );
  assert.equal(calls.length, 0, "GitHub lookup must never occur");
}

test("all ordinary, cross-owner, known-carrier and unknown-relay requests are denied", async()=>{
  const routes = [
    [source,destination],
    [source,source],
    ["SYNTHETIC-PRIVATE/SOURCE",source],
    ["ores-truffle-oreslang/oreslang-source.java","voxletra/private-ci"],
    ["ORES-TRUFFLE-ORESLANG/oreslang-source.llvm","scintilla-run/private-ci"],
    ["zed-pkg-test/java-app","zed-pkg-test/second-copy"],
    ["ores-llm/ores-llm-ml-conformance-tests","ores-llm/carrier-two"],
    ["unknown-test-owner/previous-private-source","unknown-test-owner/new-copy"],
    ["unknown-test-owner/previous-private-source","another-owner/new-copy"],
    ["other-private/relay","other-private/relay"]
  ];
  for(const [from,to] of routes) {
    await deniedBeforeNetwork({source:from,destination:to,approvedDestinations:[to]});
  }
});

test("env-style approvals, token shape and mock metadata cannot unlock lockdown",async()=>{
  for(const options of [
    {approvedDestinations:[]},
    {approvedDestinations:[destination]},
    {approvedDestinations:Array(100).fill(destination)},
    {token:undefined},
    {token:null},
    {token:""},
    {token:"synthetic-test-token"},
    {token:{value:"synthetic-test-token"}},
    {source:null},
    {destination:null},
    {source:"../../invalid"},
    {destination:"a/b?public=false"},
    {source:"x/y",destination:"x/y"}
  ]) await deniedBeforeNetwork(options);
});

test("pathological metadata and hostile mock fetch never execute",async()=>{
  for(const response of [
    {private:true,visibility:"private",fork:false,disabled:false,
      default_branch:"main",id:123},
    {private:true,visibility:"public",id:123},
    {private:false,visibility:"private",id:123},
    {private:true,visibility:"private",fork:true,id:123},
    {private:true,visibility:"private",id:-1}
  ]) {
    let lookedUp=0;
    await assert.rejects(requirePrivateMirror({...baseline,
      fetchImpl:async()=>{lookedUp++;return {status:200,json:async()=>response};}
    }),DENIED);
    assert.equal(lookedUp,0);
  }
});

test("CLI remains disabled even when caller supplies a destination allowlist and token",()=>{
  const exe=fileURLToPath(new URL("../bin/require-private-mirror.mjs",import.meta.url));
  const proc=spawnSync(process.execPath,[exe,source,destination],{
    encoding:"utf8",timeout:3000,
    env:{PATH:process.env.PATH,ORES_APPROVED_PRIVATE_MIRRORS:destination,
      GH_TOKEN:"synthetic-test-token"}
  });
  assert.equal(proc.status,1);
  assert.equal(proc.stdout,"");
  assert.match(proc.stderr,DENIED);
  assert.doesNotMatch(proc.stderr,/synthetic-test-token/);
});

test("disabled admission guard is the first executable operation",()=>{
  const body=readFileSync(new URL("../bin/require-private-mirror.mjs",import.meta.url),"utf8");
  const fn=body.slice(body.indexOf("export async function requirePrivateMirror("));
  assert.match(fn,/\(_untrustedOptions\) \{[\s\S]*?\/\/ Incident containment LOCKDOWN/);
  const denial=fn.indexOf('throw Error("PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL")');
  assert.ok(denial>=0);
  for(const action of ["repoName(source)","repoMetadata(from","fetchImpl(","await repoMetadata("]){
    const i=fn.indexOf(action);
    if(i>=0) assert.ok(denial<i,"lockdown must precede "+action);
  }
});

test("denial happens before malicious option getters and Proxy traps",async()=>{
  let effects=0;
  const hostile=new Proxy({},{
    get(){effects++;throw Error("OPTIONS_GET_TRAP_EXECUTED");},
    ownKeys(){effects++;throw Error("OPTIONS_OWNKEYS_TRAP_EXECUTED");},
    getOwnPropertyDescriptor(){effects++;throw Error("OPTIONS_DESCRIPTOR_TRAP_EXECUTED");},
    getPrototypeOf(){effects++;throw Error("OPTIONS_PROTOTYPE_TRAP_EXECUTED");}
  });
  const getters=Object.defineProperties({},{
    source:{enumerable:true,get(){effects++;throw Error("SOURCE_GETTER_EXECUTED");}},
    fetchImpl:{enumerable:true,get(){effects++;throw Error("FETCH_GETTER_EXECUTED");}},
    token:{enumerable:true,get(){effects++;throw Error("TOKEN_GETTER_EXECUTED");}}
  });
  for(const options of [undefined,null,hostile,getters,42,"malformed"]) {
    await assert.rejects(requirePrivateMirror(options),DENIED);
  }
  assert.equal(effects,0,"zero caller-controlled option reads before lockdown");
});
