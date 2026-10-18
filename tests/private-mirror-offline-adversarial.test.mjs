import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";

const A="a".repeat(40), B="b".repeat(40);
const opts={
  source:"synthetic/source", destination:"synthetic/carrier",
  sourceCommit:A, destinationBaseCommit:B, prefix:"snapshots/synthetic",
  newBranch:"ci/private-synthetic", approvedDestinations:["synthetic/carrier"],
  token:"DUMMY_SECRET_VALUE",
};
const variations=[
  undefined, null, {}, opts, {...opts,sourceCommit:null},
  {...opts,destinationBaseCommit:null}, {...opts,approvedDestinations:[]},
  {...opts,approvedDestinations:["*"]}, {...opts,policyApproved:true},
  {...opts,overrideIncidentHold:true}, {...opts,actionsMinutesRemaining:100000},
  {...opts,destination:"public-org/carrier"}, {...opts,newBranch:"main"},
  {...opts,prefix:"../../private"}, {...opts,token:null},
  {...opts,authorizationReceipt:{signed:true}},
  {...opts,incidentsClosed:[22,77]},
  {...opts,sourceTree:{truncated:false,tree:[{path:"main.ores"}]}},
];

for(let i=0;i<variations.length;i++){
  for(const [name,fn] of [["publisher",publishPrivateMirror],
                          ["preflight",requirePrivateMirror]]){
    test(name+" rejects synthetic variation "+i+" without GitHub IO",async()=>{
      let calls=0;
      const value=variations[i];
      const request=value && {...value,fetchImpl(){
        calls++; throw Error("NETWORK_CALLED");
      }};
      await assert.rejects(fn(request),/PRIVATE_MIRROR_SUSPENDED/);
      assert.equal(calls,0);
    });
  }
}
for(const [name,fn] of [["publisher",publishPrivateMirror],
                        ["preflight",requirePrivateMirror]]){
  test(name+" rejects poisoned getters without property access",async()=>{
    let probes=0;
    const input=new Proxy({}, {
      get(){probes++;throw Error("GETTER_EXECUTED");},
      ownKeys(){probes++;throw Error("OWNKEYS_EXECUTED");},
    });
    await assert.rejects(fn(input),/PRIVATE_MIRROR_SUSPENDED/);
    assert.equal(probes,0);
  });
  test(name+" never performs a global fetch",async()=>{
    const original=globalThis.fetch;
    let calls=0;
    globalThis.fetch=()=>{calls++;throw Error("FETCH_CALLED");};
    try{
      await assert.rejects(fn(opts),/PRIVATE_MIRROR_SUSPENDED/);
      assert.equal(calls,0);
    }finally{globalThis.fetch=original;}
  });
  test(name+" CLI denies even with synthetic allowlist and token",()=>{
    const script=name==="publisher"?"../bin/private-mirror-publish.mjs":
      "../bin/require-private-mirror.mjs";
    const cli=fileURLToPath(new URL(script,import.meta.url));
    const result=spawnSync(process.execPath,
      [cli,"synthetic/source",A,"synthetic/carrier",B],{
        env:{...process.env,GH_TOKEN:"DUMMY_SECRET_VALUE",
          ORES_APPROVED_PRIVATE_MIRRORS:"synthetic/carrier"},
        encoding:"utf8",timeout:5000,
      });
    assert.equal(result.status,1,result.error?.message);
    assert.match(result.stderr,/PRIVATE_MIRROR_SUSPENDED/);
    assert.doesNotMatch(result.stdout+result.stderr,
      /DUMMY_SECRET_VALUE|PRIVATE_MIRROR_APPROVED|PRIVATE_MIRROR_PUBLISHED/);
  });
}
