import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {proposeCanary} from "../bin/propose-private-ci-canary.mjs";

const DENIED=/PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL/;

test("private canary proposal denies before every metadata request",async()=>{
  let calls=0;
  for(const source of [
    "ores-truffle-oreslang/oreslang-source.java",
    "ores-truffle-oreslang/oreslang-source.llvm",
    "unknown-private/source",
    "unknown-private/carrier"
  ]) {
    await assert.rejects(proposeCanary({
      source,destination:"example-private/carrier",sourceCommit:"a".repeat(40),
      token:"synthetic-test-token",fetchImpl:async()=>{calls++;throw Error("NETWORK_REACHED");}
    }),DENIED);
  }
  assert.equal(calls,0,"private source commit/tree metadata must never be read");
});

test("canary proposer rejects before hostile option getters and proxy traps",async()=>{
  let touched=0;
  const hostile=new Proxy({}, {
    get(){touched++;throw Error("GET_EXECUTED");},
    ownKeys(){touched++;throw Error("OWNKEYS_EXECUTED");},
    getOwnPropertyDescriptor(){touched++;throw Error("DESCRIPTOR_EXECUTED");}
  });
  for(const input of [undefined,null,42,"x",hostile,Object.defineProperty({},"token",{
    get(){touched++;throw Error("TOKEN_GETTER_EXECUTED");}
  })]) await assert.rejects(proposeCanary(input),DENIED);
  assert.equal(touched,0);
});

test("canary CLI fails without printing credentials or source data",()=>{
  const exe=fileURLToPath(new URL("../bin/propose-private-ci-canary.mjs",import.meta.url));
  const result=spawnSync(process.execPath,[exe,"ores-truffle-oreslang/oreslang-source.java","example-private/carrier","a".repeat(40)],{
    encoding:"utf8",timeout:3000,
    env:{PATH:process.env.PATH,GH_TOKEN:"synthetic-test-token"}
  });
  assert.equal(result.status,1);
  assert.equal(result.stdout,"");
  assert.match(result.stderr,DENIED);
  assert.doesNotMatch(result.stderr,/synthetic-test-token/);
});

test("proposer has no direct Git API endpoint or network import",()=>{
  const src=readFileSync(new URL("../bin/propose-private-ci-canary.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(src,/api\.github\.com/);
  assert.doesNotMatch(src,/\/git\/(?:commits|blobs|trees|refs)/);
  assert.match(src,/export async function proposeCanary\(_untrustedOptions\)/);
});
