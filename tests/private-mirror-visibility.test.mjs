import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";

const source = "ores-truffle-oreslang/oreslang-source.java";
const A="a".repeat(40),T="d".repeat(40),M="b".repeat(40),destinationId=1234;
const encoded=text=>({type:"file",encoding:"base64",sha:createHash("sha1").update("blob "+Buffer.byteLength(text)+"\0").update(text).digest("hex"),
  content:Buffer.from(text).toString("base64")});
const rules=()=>({enforce_admins:{enabled:true},
  required_status_checks:{strict:true,contexts:["native-tests"]},
  required_pull_request_reviews:{require_code_owner_reviews:true,
    dismiss_stale_reviews:true,required_approving_review_count:1,
    bypass_pull_request_allowances:{users:[],teams:[],apps:[]}}});
const destination = "akrion-sim/akrion-sim-e2e";
const good = name => ({
  full_name: name, private: true, visibility: "private",
  archived:false,disabled:false,id:name===source?1400792274:destinationId,
  permissions:{push:true}
});
function fixture(records = {}, calls = []) {
  return async (url, options) => {
    calls.push({url, options});
    assert.match(url, /^https:\/\/api\.github\.com\/repos\//);
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer restricted-test-token");
    const name = url.slice("https://api.github.com/repos/".length);
    const defaults={
      [source+"/branches/main"]:{name:"main",protected:true,commit:{sha:M}},
      [source+"/branches/main/protection"]:rules(),
      [source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M]:
        encoded(destination+" "+destinationId+"\n"),
      [source+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+M]:
        encoded(A+" "+T+" "+destinationId+"\n"),
      [source+"/git/commits/"+A]:{sha:A,tree:{sha:T}}
    };
    const result=records[name]??defaults[name]??good(name);
    return {status: result?.status ?? 200, json: async () => result?.data ?? result};
  };
}
const base = {
  source,destination,sourceCommit:A,sourceTree:T,approvedDestinations:[destination],
  token: "restricted-test-token"
};
const check = (overrides = {}, records = {}, calls = []) =>
  requirePrivateMirror({...base, fetchImpl: fixture(records, calls), ...overrides});

test("accepts only explicitly approved and GitHub-verified writable private destination", async () => {
  const calls = [];
  assert.deepEqual(await check({}, {}, calls), {
    status:"PRIVATE_MIRROR_APPROVED",source,destination,
    sourceCommit:A,sourceTree:T,destinationId
  });
  assert.equal(calls.length, 8);
  assert.equal(calls[0].url.endsWith("/" + source), true);
  assert.equal(calls[1].url.endsWith("/" + destination), true);
});

test("rejects public, internal, contradictory, archived and unwritable destinations", async () => {
  for (const metadata of [
    {...good(destination), private: false, visibility: "public"},
    {...good(destination), private: true, visibility: "internal"},
    {...good(destination), private: true, visibility: "public"},
    {...good(destination), archived: true},
    {...good(destination), permissions: {push: false}},
    {...good(destination), permissions: undefined}
  ]) {
    await assert.rejects(check({}, {[destination]: metadata}), /writable verified PRIVATE/);
  }
});

test("rejects wrong or public source metadata even when destination is private", async () => {
  for (const metadata of [
    {...good(source), private: false, visibility: "public"},
    {...good(source), visibility: "internal"},
    {...good(source), archived: true}
  ]) {
    const calls = [];
    await assert.rejects(check({}, {[source]: metadata}, calls), /private source metadata/);
    assert.equal(calls.length, 1, "cannot even inspect target after source rejection");
  }
});

test("unknown, unauthorized and missing metadata fail closed", async () => {
  for (const metadata of [
    {status: 403}, {status: 404}, {status: 401},
    {status: 200, data: {private: true, visibility: "private"}},
    {status: 200, data: {full_name: destination, private: "true", visibility: "private"}},
    {status: 200, data: {full_name: "someone-else/private", private: true, visibility: "private"}}
  ]) {
    await assert.rejects(check({}, {[destination]: metadata}), /unverifiable|invalid or mismatched/);
  }
});

test("missing explicit destination approval is rejected before any network request", async () => {
  for (const approvedDestinations of [undefined, [], ["other/repo"], [destination, "../evil"], Array(40).fill(destination)]) {
    const calls = [];
    await assert.rejects(check({approvedDestinations}, {}, calls), /allowlist/);
    assert.equal(calls.length, 0);
  }
});

test("missing credentials fail closed before any network request", async () => {
  for (const token of [undefined, "", " "]) {
    const calls = [];
    await assert.rejects(check({token}, {}, calls), /authenticated GitHub/);
    assert.equal(calls.length, 0);
  }
});

test("rejects malformed repository names and URL injection before making requests", async () => {
  for (const sourceValue of [
    "../other/repo", "org/repo?private=true", "org/repo#frag",
    "org/repo/extra", "org\\repo", "", "org/..", "org/repo\nHeader: injection"
  ]) {
    const calls = [];
    await assert.rejects(check({source: sourceValue}, {}, calls), /invalid GitHub/);
    assert.equal(calls.length, 0);
  }
});

test("transport, timeout, JSON and redirect failures never become approval", async () => {
  for (const fetchImpl of [
    async () => { throw Error("network error"); },
    async () => { throw Error("redirect not allowed"); },
    async () => ({status: 200, json: async () => { throw Error("invalid JSON"); }}),
    async () => null
  ]) {
    await assert.rejects(check({fetchImpl}));
  }
});

test("no permissive fallback exists if caller fails to supply a fetch implementation", async () => {
  await assert.rejects(check({fetchImpl: null}), /visibility lookup unavailable/);
});

test("transport and JSON parse errors redact credentials even if client errors include them", async () => {
  const secret = "restricted-test-token";
  for (const fetchImpl of [
    async () => { throw Error("bad Authorization: Bearer " + secret); },
    async () => ({status: 200, json: async () => {
      throw Error("request Authorization Bearer " + secret);
    }})
  ]) {
    await assert.rejects(check({fetchImpl}), error => {
      assert.equal(error.message.includes(secret), false, "token leaked in error");
      assert.match(error.message, /visibility lookup failed|metadata could not be decoded/);
      return true;
    });
  }
});

test("unprotected source or missing enforceable codeowner review rejects",async()=>{
 const branch={name:"main",protected:false,commit:{sha:M}};
 const review={...rules(),required_pull_request_reviews:{
   ...rules().required_pull_request_reviews,require_code_owner_reviews:false}};
 for(const records of [
  {[source+"/branches/main"]:branch},
  {[source+"/branches/main/protection"]:review},
  {[source+"/branches/main/protection"]:{status:403}}
 ]) {
  const calls=[];
  await assert.rejects(check({},records,calls),/protected source main|codeowner|unavailable/);
  assert.equal(calls.filter(x=>x.options.method!=="GET").length,0);
 }
});
test("reviewed policy must pin destination numeric ID and immutable source snapshot",async()=>{
 const a=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
 const b=source+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+M;
 for(const records of [
  {[a]:encoded("# empty\n")},
  {[a]:encoded(destination+" 9999\n")},
  {[b]:encoded("# empty\n")},
  {[b]:encoded(A+" "+"e".repeat(40)+" "+destinationId+"\n")},
  {[b]:encoded(A+" "+T+" "+destinationId+"\n"+A+" "+T+" "+destinationId+"\n")}
 ]) await assert.rejects(check({},records),/approval/);
});
test("untrusted source ID, missing source pins, and mismatched Git tree deny",async()=>{
 for(const change of [{sourceTree:undefined},{sourceCommit:undefined},{sourceCommit:"x".repeat(40)}]){
  const calls=[];
  await assert.rejects(check(change,{},calls),/exact pinned/);
  assert.equal(calls.length,0);
 }
 await assert.rejects(check({},{[source]:{...good(source),id:7}}),/immutable source/);
 await assert.rejects(check({},{[source+"/git/commits/"+A]:{
  sha:A,tree:{sha:"e".repeat(40)}}}),/commit.tree mismatch/);
});
test("protected-main revision change while reading policy denies",async()=>{
 let visits=0;
 const fallback=fixture();
 const mock=async(url,options)=>{
  if(url.endsWith("/"+source+"/branches/main")){
   ++visits;
   return {status:200,json:async()=>({name:"main",protected:true,
     commit:{sha:visits===1?M:"e".repeat(40)}})};
  }
  return fallback(url,options);
 };
 await assert.rejects(check({fetchImpl:mock}),/changed during source admission/);
});

test("source policy Git blob digest must match the reviewed bytes",async()=>{
 const policy=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
 const forged={...encoded(destination+" "+destinationId+"\n"),sha:"f".repeat(40)};
 await assert.rejects(check({}, {[policy]:forged}),/policy blob digest mismatch/);
});
test("strict nonempty required CI and reviewer bypass protection are mandatory",async()=>{
 const key=source+"/branches/main/protection";
 const baseline=rules();
 for(const bad of [
  {...baseline,required_status_checks:undefined},
  {...baseline,required_status_checks:{strict:false,contexts:["native-tests"]}},
  {...baseline,required_status_checks:{strict:true,contexts:[]}},
  {...baseline,required_status_checks:{strict:true,contexts:[null]}},
  {...baseline,required_pull_request_reviews:{...baseline.required_pull_request_reviews,
    bypass_pull_request_allowances:{users:[{login:"owner"}],teams:[],apps:[]}}},
  {...baseline,required_pull_request_reviews:{...baseline.required_pull_request_reviews,
    bypass_pull_request_allowances:undefined}}
 ]){
   await assert.rejects(check({}, {[key]:bad}),/codeowner review proof/);
 }
});
test("duplicate destination names or numeric ids and ambiguous snapshots deny",async()=>{
 const dest=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
 const snaps=source+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+M;
 for(const policy of [
  destination+" "+destinationId+"\n"+destination+" 5678\n",
  destination+" "+destinationId+"\n"+"alternate/repo "+destinationId+"\n"
 ]){
  await assert.rejects(check({}, {[dest]:encoded(policy)}),/duplicate reviewed/);
 }
 await assert.rejects(check({}, {[snaps]:encoded(
   A+" "+T+" "+destinationId+"\n"+
   "e".repeat(40)+" "+"f".repeat(40)+" "+destinationId+"\n"
 )}),/duplicate reviewed/);
});
test("noncanonical base64 and invalid policy UTF8 must deny",async()=>{
 const policy=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
 const normal=encoded(destination+" "+destinationId+"\n");
 for(const data of [
   {...normal,content:normal.content.slice(0,-1)},
   {...normal,content:"_invalid"},
   {...normal,encoding:"utf-8"}
 ]){
  await assert.rejects(check({}, {[policy]:data}),/policy content/);
 }
});
