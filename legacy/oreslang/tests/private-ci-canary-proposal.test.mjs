import {test} from "node:test";
import assert from "node:assert/strict";
import {proposeCanary} from "../bin/propose-private-ci-canary.mjs";

const source="ores-truffle-oreslang/oreslang-source.forge";
const destination="example-private/carrier";
const sourceCommit="a".repeat(40);
const sourceTree="b".repeat(40);
const sourceId=1419703674;
const destinationId=424242;

function fixture(overrides={},calls=[]){
  return async (url,options)=>{
    calls.push({url,options});
    assert.equal(options.method,"GET");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers.Authorization,"Bearer test-token");
    const table={
      ["https://api.github.com/repos/"+source]:{
        full_name:source,private:true,visibility:"private",archived:false,disabled:false,id:sourceId
      },
      ["https://api.github.com/repos/"+destination]:{
        full_name:destination,private:true,visibility:"private",archived:false,disabled:false,
        id:destinationId,permissions:{push:true}
      },
      ["https://api.github.com/repos/"+source+"/git/commits/"+sourceCommit]:{
        sha:sourceCommit,tree:{sha:sourceTree}
      },
      ["https://api.github.com/repos/"+source+"/compare/"+sourceCommit+"...main"]:{
        status:"ahead"
      }
    };
    const value=overrides[url]??table[url];
    if(value?.statusCode) return {status:value.statusCode,json:async()=>value.body};
    return {status:200,json:async()=>value};
  };
}
const run=(overrides={},calls=[])=>proposeCanary({
  source,destination,sourceCommit,token:"test-token",fetchImpl:fixture(overrides,calls)
});

test("produces exact proposal lines without writing anything",async()=>{
  const calls=[];
  const result=await run({},calls);
  assert.deepEqual(result,{
    status:"PRIVATE_CI_CANARY_PROPOSAL_ONLY",
    source,sourceRepositoryId:sourceId,sourceCommit,sourceTree,
    destination,destinationId,
    policyLines:{
      destination:destination+" "+destinationId,
      snapshot:sourceCommit+" "+sourceTree+" "+destinationId,
      carrierSnapshot:sourceCommit+" "+sourceTree+" "+destinationId
    },
    reviewProtocol:{
      sourceReviewerPolicy:".github/private-ci-independent-reviewer.json",
      carrierReviewerPolicy:".github/private-ci-independent-reviewer.json",
      sourceAuthorizationPaths:[
        ".github/private-ci-approved-repositories.txt",
        ".github/private-ci-approved-source-snapshots.txt",
        ".github/private-ci-independent-reviewer.json"
      ],
      carrierAuthorizationPaths:[
        ".github/private-ci-approved-source-snapshots.txt",
        ".github/private-ci-independent-reviewer.json"
      ],
      requirements:[
        "activate the same non-operator reviewer identity on source and carrier",
        "change each side's authorization paths together in one commit",
        "obtain that reviewer's APPROVED review on the exact final PR head for both source and carrier",
        "reviewer must retain configured write-or-better permission in both repositories",
        "keep exactly one active canary and preserve pinned policy workflow blobs"
      ]
    },
    warning:"Proposal only: after bootstrap passes, apply source and carrier lines in separate protected CODEOWNERS-reviewed PRs and obtain exact-head approval from the same configured independent reviewer."
  });
  assert.equal(calls.length,4);
  assert.equal(calls.every(x=>x.options.method==="GET"),true);
});

test("rejects public, internal, archived, disabled or unwritable destination",async()=>{
  const url="https://api.github.com/repos/"+destination;
  const base={full_name:destination,private:true,visibility:"private",archived:false,disabled:false,id:destinationId,permissions:{push:true}};
  for(const bad of [
    {...base,private:false,visibility:"public"},
    {...base,visibility:"internal"},
    {...base,archived:true},
    {...base,disabled:true},
    {...base,permissions:{push:false}},
    {...base,permissions:undefined}
  ]){
    await assert.rejects(run({[url]:bad}),/writable verified private/);
  }
});

test("rejects malformed or mismatched source metadata",async()=>{
  const url="https://api.github.com/repos/"+source;
  const base={full_name:source,private:true,visibility:"private",archived:false,disabled:false,id:sourceId};
  for(const bad of [
    {...base,full_name:"someone/else"},
    {...base,private:false,visibility:"public"},
    {...base,visibility:"internal"},
    {...base,archived:true},
    {...base,disabled:true},
    {...base,id:0}
  ]){
    await assert.rejects(run({[url]:bad}),/source repository identity\/privacy/);
  }
});

test("requires exact source commit and verified root tree",async()=>{
  const url="https://api.github.com/repos/"+source+"/git/commits/"+sourceCommit;
  await assert.rejects(proposeCanary({
    source,destination,sourceCommit:"bad",token:"test-token",fetchImpl:fixture()
  }),/exact source commit/);
  await assert.rejects(run({[url]:{sha:sourceCommit,tree:{sha:"bad"}}}),/commit\/root-tree/);
  await assert.rejects(run({[url]:{sha:"c".repeat(40),tree:{sha:sourceTree}}}),/commit\/root-tree/);
});

test("detached or unrelated source commit cannot become a proposal",async()=>{
  const url="https://api.github.com/repos/"+source+"/compare/"+sourceCommit+"...main";
  for(const status of ["behind","diverged"]){
    await assert.rejects(run({[url]:{status}}),/not an ancestor/);
  }
});

test("identical source main is accepted as a proposal candidate",async()=>{
  const url="https://api.github.com/repos/"+source+"/compare/"+sourceCommit+"...main";
  const result=await run({[url]:{status:"identical"}});
  assert.equal(result.sourceTree,sourceTree);
});

test("missing approval inputs fail before network access",async()=>{
  for(const change of [
    {source:"other/repo"},
    {destination:"bad path"},
    {sourceCommit:"x"},
    {token:""}
  ]){
    let calls=0;
    await assert.rejects(proposeCanary({
      source,destination,sourceCommit,token:"test-token",
      fetchImpl:async()=>{calls++;},
      ...change
    }),/PRIVATE_CI_CANARY_DENIED/);
    assert.equal(calls,0);
  }
});

test("transport failures redact token-bearing client messages",async()=>{
  await assert.rejects(proposeCanary({
    source,destination,sourceCommit,token:"test-token",
    fetchImpl:async()=>{throw Error("Authorization: Bearer test-token");}
  }),err=>{
    assert.equal(err.message.includes("test-token"),false);
    assert.match(err.message,/GitHub lookup failed/);
    return true;
  });
});

test("GitHub metadata failures fail closed",async()=>{
  const url="https://api.github.com/repos/"+destination;
  await assert.rejects(run({[url]:{statusCode:403,body:{message:"forbidden"}}}),/metadata unavailable/);
});
