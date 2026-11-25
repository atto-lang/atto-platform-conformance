import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";

// Shared test-only fixture: pinned issuer bytes and four synthetic incident closures.
import { source, destination, A, T, M, C, destinationId, encoded, securityOwners, reviewer, reviewerPolicy, codeowners, requiredChecks, sourcePolicyWorkflow, rules, incidentPath22, incidentPath77, incidentPath127, incidentPath212, incident22, incident77, incident127, incident212, carrierCodeowners, carrierPolicy, carrierPolicyWorkflow, sourceAuthorizationCommit, carrierAuthorizationCommit, sourcePrHead, carrierPrHead, carrierRules, good, fixture } from "./private-ci-authorization-fixture.mjs";

const base = {
  source,destination,sourceCommit:A,sourceTree:T,approvedDestinations:[destination],
  token: "restricted-test-token"
};
const check = (overrides = {}, records = {}, calls = []) =>
  requirePrivateMirror({...base, fetchImpl: fixture(records, calls), ...overrides});

test("trusted synthetic source and carrier policy fixtures match reviewed immutable Git blob IDs", () => {
  const gitBlobSha=text=>createHash("sha1")
    .update("blob "+Buffer.byteLength(text)+"\0")
    .update(text).digest("hex");
  assert.equal(gitBlobSha(sourcePolicyWorkflow),
    "1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76");
  assert.equal(gitBlobSha(carrierPolicyWorkflow),
    "645f7f8f5ec6d907fb2a1b7ea9f93c8e28f3855a");
});

test("accepts only explicitly approved and GitHub-verified writable private destination", async () => {
  const calls = [];
  assert.deepEqual(await check({}, {}, calls), {
    status:"PRIVATE_MIRROR_APPROVED",source,destination,
    sourceCommit:A,sourceTree:T,destinationId
  });
  assert.ok(calls.length >= 30);
  // Four independent exposure incidents are checked before source metadata.
  for(const [index,number] of [22,77,127,212].entries())
    assert.equal(calls[index].url.endsWith("/issues/"+number),true);
  assert.equal(calls[4].url.endsWith("/" + source), true);
  assert.equal(calls[5].url.endsWith("/" + destination), true);
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
    assert.equal(calls.length, 5, "cannot inspect target after all four incidents + source rejection");
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
      assert.match(error.message, /lookup failed|metadata could not be decoded|policy lookup failed|not decodable/);
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
  await assert.rejects(check({},records,calls),/protected source main|codeowner|unavailable|review\/admin\/no-bypass protection mismatch/);
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
test("security CODEOWNERS must end with exact org-team ownership for every export policy file",async()=>{
 const path=source+"/contents/.github/CODEOWNERS?ref="+M;
 for(const text of [
  [
   "/.github/CODEOWNERS "+securityOwners,
   "/.github/private-ci-approved-repositories.txt "+securityOwners,
   "/.github/private-ci-approved-source-snapshots.txt "+securityOwners,
   "/.github/private-ci-required-checks.json "+securityOwners
  ].join("\n")+"\n",
  codeowners+"* @someone-else\n",
  codeowners.replaceAll(securityOwners,"@individual"),
  codeowners.replace(
    "/.github/private-ci-required-checks.json "+securityOwners,
    "/.github/private-ci-required-checks.json @ores-truffle-oreslang/other-team")
 ]){
  await assert.rejects(check({}, {[path]:encoded(text)}),/security CODEOWNERS/);
 }
});

test("additional required checks are allowed only when every check is app-bound and approved checks remain present",async()=>{
 const key=source+"/branches/main/protection";
 const baseline=rules();
 const extra={...baseline,required_status_checks:{strict:true,contexts:[],checks:[
  {context:"private-ci-policy",app_id:15368},{context:"security-lint",app_id:15368}
 ]}};
 assert.deepEqual((await check({}, {[key]:extra})).destinationId,destinationId);
 const unbound={...baseline,required_status_checks:{strict:true,contexts:[],checks:[
  {context:"private-ci-policy",app_id:15368},{context:"security-lint",app_id:null}
 ]}};
 await assert.rejects(check({}, {[key]:unbound}),/required check identity invalid/);
});

test("the existing independently reviewed ORESoftware owner remains an accepted exact security owner",async()=>{
 const path=source+"/contents/.github/CODEOWNERS?ref="+M;
 // Additional earlier ownership declarations must not displace the exact
 // terminal security rules checked for the approved owner.
 const text="/src/ @different-dev-team\n"+codeowners;
 assert.deepEqual((await check({}, {[path]:encoded(text)})).destinationId,destinationId);
});

test("required-check policy must exactly bind context to GitHub App ID",async()=>{
 const path=source+"/contents/.github/private-ci-required-checks.json?ref="+M;
 for(const text of [
  JSON.stringify({schema:1,checks:[]}),
  JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:0}]}),
  JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:15368},{context:"private-ci-policy",appId:15368}]}),
  JSON.stringify({schema:1,checks:[{context:"private-ci-policy",appId:9999}]})
 ]){
  await assert.rejects(check({}, {[path]:encoded(text+"\n")}),
    /required-check policy|context\/app identity/);
 }
});
test("strict app-bound required CI and reviewer bypass protection are mandatory",async()=>{
 const key=source+"/branches/main/protection";
 const baseline=rules();
 for(const [bad,pattern] of [
  [{...baseline,required_status_checks:undefined},/strict app-bound required checks missing/],
  [{...baseline,required_status_checks:{strict:false,contexts:[],checks:[{context:"private-ci-policy",app_id:15368}]}},/strict app-bound required checks missing/],
  [{...baseline,required_status_checks:{strict:true,contexts:["legacy"],checks:[{context:"private-ci-policy",app_id:15368}]}},/strict app-bound required checks missing/],
  [{...baseline,required_status_checks:{strict:true,contexts:[],checks:[]}},/private-ci-policy check\/app binding missing/],
  [{...baseline,required_status_checks:{strict:true,contexts:[],checks:[{context:"private-ci-policy",app_id:9999}]}},/private-ci-policy check\/app binding missing/],
  [{...baseline,required_pull_request_reviews:{...baseline.required_pull_request_reviews,
    bypass_pull_request_allowances:{users:[{login:"owner"}],teams:[],apps:[]}}},/review\/admin\/no-bypass protection mismatch/],
  [{...baseline,required_pull_request_reviews:{...baseline.required_pull_request_reviews,
    bypass_pull_request_allowances:undefined}},/review\/admin\/no-bypass protection mismatch/]
 ]){
   await assert.rejects(check({}, {[key]:bad}),pattern);
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


test("all four P0 incidents must be exactly completed before source metadata is inspected",async()=>{
  for(const [path,incident,prior] of [
    [incidentPath22,incident22,0],
    [incidentPath77,incident77,1],
    [incidentPath127,incident127,2],
    [incidentPath212,incident212,3]
  ]){
    for(const bad of [
      {...incident,state:"open",state_reason:null,closed_at:null},
      {...incident,state_reason:"not_planned"},
      {...incident,title:"renamed incident"},
      {...incident,repository_url:"https://api.github.com/repos/other/repo"},
      {...incident,closed_at:"not-a-timestamp"}
    ]){
      const calls=[];
      await assert.rejects(check({}, {[path]:bad}, calls),/incident is not completed/);
      assert.equal(calls.length,prior+1);
      assert.equal(calls.some(x=>x.url.endsWith("/"+source)),false);
    }
  }
});

test("destination carrier main, review policy, CODEOWNERS and issuer-bound check are mandatory",async()=>{
  const branch=destination+"/branches/main";
  const protection=destination+"/branches/main/protection";
  const owners=destination+"/contents/.github/CODEOWNERS?ref="+C;
  const policy=destination+"/contents/.github/private-ci-carrier-policy.json?ref="+C;
  for(const [records,pattern] of [
    [{[branch]:{name:"main",protected:false,commit:{sha:C}}},/protected carrier main/],
    [{[protection]:{...carrierRules(),enforce_admins:{enabled:false}}},/protection mismatch/],
    [{[protection]:{...carrierRules(),required_status_checks:{strict:true,contexts:[],checks:[{context:"carrier-policy",app_id:9999}]}}},/carrier-policy check\/app binding/],
    [{[protection]:{...carrierRules(),required_status_checks:{strict:true,contexts:["legacy"],checks:[{context:"carrier-policy",app_id:15368}]}}},/strict app-bound carrier/],
    [{[owners]:encoded(carrierCodeowners+"* @someone-else\n")},/carrier security CODEOWNERS/],
    [{[policy]:encoded(JSON.stringify({schema:1,carrier:{context:"carrier-policy",appId:9999}})+"\n")},/carrier policy identity/]
  ]){
    await assert.rejects(check({},records),pattern);
  }
});

test("carrier protected-main drift during admission denies",async()=>{
  let reads=0;
  const fallback=fixture();
  const fetchImpl=async(url,options)=>{
    if(url.endsWith("/"+destination+"/branches/main")){
      reads++;
      return {status:200,json:async()=>({name:"main",protected:true,
        commit:{sha:reads===1?C:"e".repeat(40)}})};
    }
    return fallback(url,options);
  };
  await assert.rejects(check({fetchImpl}),/carrier policy changed during admission/);
});


test("policy JSON rejects duplicate and escaped-equivalent keys end to end",async()=>{
  const checksPath=source+"/contents/.github/private-ci-required-checks.json?ref="+M;
  const carrierPath=destination+"/contents/.github/private-ci-carrier-policy.json?ref="+C;
  for(const text of [
    '{"schema":1,"schema":2,"checks":[{"context":"private-ci-policy","appId":15368}]}',
    '{"schema":1,"\\u0073chema":2,"checks":[{"context":"private-ci-policy","appId":15368}]}',
    '{"schema":1,"checks":[{"context":"private-ci-policy","context":"other","appId":15368}]}'
  ]) await assert.rejects(check({}, {[checksPath]:encoded(text)}),/duplicate object key|ambiguous or invalid/);
  for(const text of [
    '{"schema":1,"schema":2,"carrier":{"context":"carrier-policy","appId":15368}}',
    '{"schema":1,"carrier":{"context":"carrier-policy","context":"other","appId":15368}}'
  ]) await assert.rejects(check({}, {[carrierPath]:encoded(text)}),/duplicate object key|ambiguous or invalid/);
});

test("policy bytes and exact line grammar reject BOM NUL and surrounding whitespace",async()=>{
  const destPath=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
  const checksPath=source+"/contents/.github/private-ci-required-checks.json?ref="+M;
  const ownersPath=destination+"/contents/.github/CODEOWNERS?ref="+C;
  await assert.rejects(check({}, {[destPath]:encoded(" "+destination+" "+destinationId+"\n")}),/ambiguous surrounding whitespace/);
  await assert.rejects(check({}, {[ownersPath]:encoded(carrierCodeowners.replace("/.github/CODEOWNERS @ORESoftware","/.github/CODEOWNERS @ORESoftware "))}),/ambiguous surrounding whitespace/);
  for(const text of [String.fromCharCode(0xfeff)+requiredChecks, requiredChecks+String.fromCharCode(0)]){
    await assert.rejects(check({}, {[checksPath]:encoded(text)}),/forbidden BOM\/NUL/);
  }
});

test("boolean schema values cannot satisfy carrier or source policy schemas",async()=>{
  const checksPath=source+"/contents/.github/private-ci-required-checks.json?ref="+M;
  const carrierPath=destination+"/contents/.github/private-ci-carrier-policy.json?ref="+C;
  await assert.rejects(check({}, {[checksPath]:encoded(JSON.stringify({schema:true,checks:[{context:"private-ci-policy",appId:15368}]}))}),/schema/);
  await assert.rejects(check({}, {[carrierPath]:encoded(JSON.stringify({schema:true,carrier:{context:"carrier-policy",appId:15368}}))}),/carrier policy identity/);
});


test("source and carrier canary activation require exact-head independent approvals",async()=>{
  const srcReviews=source+"/pulls/501/reviews?per_page=100";
  const carReviews=destination+"/pulls/701/reviews?per_page=100";
  for(const [path,head] of [[srcReviews,sourcePrHead],[carReviews,carrierPrHead]]){
    for(const reviews of [
      [],
      [{id:1,state:"COMMENTED",commit_id:head,submitted_at:"2026-10-18T13:59:00Z",user:reviewer}],
      [{id:1,state:"APPROVED",commit_id:"5".repeat(40),submitted_at:"2026-10-18T13:59:00Z",user:reviewer}],
      [{id:1,state:"APPROVED",commit_id:head,submitted_at:"2026-10-18T13:58:00Z",user:reviewer},
       {id:2,state:"CHANGES_REQUESTED",commit_id:head,submitted_at:"2026-10-18T13:59:00Z",user:reviewer}]
    ]) await assert.rejects(check({}, {[path]:reviews}),/independent reviewer has not approved/);
  }
});

test("authorization files must be activated together in one reviewed commit",async()=>{
  const path=source+"/commits?sha="+M+"&path=.github%2Fprivate-ci-independent-reviewer.json&per_page=1";
  await assert.rejects(check({}, {[path]:[{sha:"6".repeat(40)}]}),/not activated in one reviewed commit/);
  const carrierPath=destination+"/commits?sha="+C+"&path=.github%2Fprivate-ci-approved-source-snapshots.txt&per_page=1";
  await assert.rejects(check({}, {[carrierPath]:[{sha:"7".repeat(40)}]}),/not activated in one reviewed commit/);
});

test("independent reviewer must be live, distinct from PR author, and identical on both sides",async()=>{
  const srcPermission=source+"/collaborators/"+reviewer.login+"/permission";
  await assert.rejects(check({}, {[srcPermission]:{permission:"read",user:reviewer}}),/live repository permission/);
  const srcPull=source+"/commits/"+sourceAuthorizationCommit+"/pulls?per_page=20";
  await assert.rejects(check({}, {[srcPull]:[{
    number:501,state:"closed",merged_at:"2026-10-18T14:00:00Z",
    base:{ref:"main",repo:{full_name:source}},
    head:{sha:sourcePrHead,repo:{full_name:source}},user:{id:reviewer.id}
  }]}),/cannot be the authorization PR author/);
  const carrierReviewerPath=destination+"/contents/.github/private-ci-independent-reviewer.json?ref="+C;
  const otherReviewer={login:"someone-else",id:300000002};
  const other=JSON.stringify({schema:2,enabled:true,minimumPermission:"write",
    disallowedReviewerIds:[11139560,2148448],reviewer:otherReviewer})+"\n";
  const carReviews=destination+"/pulls/701/reviews?per_page=100";
  const carPermission=destination+"/collaborators/"+otherReviewer.login+"/permission";
  await assert.rejects(check({}, {
    [carrierReviewerPath]:encoded(other),
    [carReviews]:[{
      id:9004,state:"APPROVED",commit_id:carrierPrHead,
      submitted_at:"2026-10-18T13:59:00Z",user:otherReviewer
    }],
    [carPermission]:{permission:"write",user:otherReviewer}
  }),/source and carrier independent reviewer policies do not match/);
});

test("source and carrier status workflows are pinned to independently reviewed Git blobs",async()=>{
  const src=source+"/contents/.github/workflows/private-ci-policy.yml?ref="+M;
  const car=destination+"/contents/.github/workflows/private-ci-carrier-admission.yml?ref="+C;
  await assert.rejects(check({}, {[src]:encoded(sourcePolicyWorkflow+"\n# mutation\n")}),/source policy workflow differs/);
  await assert.rejects(check({}, {[car]:encoded(carrierPolicyWorkflow+"\n# mutation\n")}),/carrier policy workflow differs/);
});


test("protected ledgers permit exactly one active canary",async()=>{
  const destPath=source+"/contents/.github/private-ci-approved-repositories.txt?ref="+M;
  const snapPath=source+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+M;
  const carrierSnap=destination+"/contents/.github/private-ci-approved-source-snapshots.txt?ref="+C;
  await assert.rejects(check({}, {[destPath]:encoded(
    destination+" "+destinationId+"\nother/private 5678\n")}),/exactly one active canary/);
  await assert.rejects(check({}, {[snapPath]:encoded(
    A+" "+T+" "+destinationId+"\n"+"e".repeat(40)+" "+"f".repeat(40)+" 5678\n")}),/exactly one active canary/);
  await assert.rejects(check({}, {[carrierSnap]:encoded(
    A+" "+T+" "+destinationId+"\n"+"e".repeat(40)+" "+"f".repeat(40)+" 5678\n")}),/exactly one active canary/);
});

test("full PR association page is treated as ambiguous",async()=>{
  const path=source+"/commits/"+sourceAuthorizationCommit+"/pulls?per_page=20";
  const rows=Array.from({length:20},(_,i)=>({
    number:500+i,state:"closed",merged_at:"2026-10-18T14:00:00Z",
    base:{ref:"main",repo:{full_name:source}},
    head:{sha:sourcePrHead,repo:{full_name:source}},user:{id:400000001+i}
  }));
  await assert.rejects(check({}, {[path]:rows}),/lookup is ambiguous/);
});

test("authorization PR base repository identity is pinned",async()=>{
  const srcPull=source+"/commits/"+sourceAuthorizationCommit+"/pulls?per_page=20";
  await assert.rejects(check({}, {[srcPull]:[{
    number:501,state:"closed",merged_at:"2026-10-18T14:00:00Z",
    base:{ref:"main",repo:{full_name:"other/repo"}},
    head:{sha:sourcePrHead,repo:{full_name:source}},user:{id:400000001}
  }]}),/not bound to one merged main pull request/);
});
