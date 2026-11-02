import {test} from "node:test";
import assert from "node:assert/strict";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";

const source = "synthetic-private/source";
const destination = "synthetic-private/carrier";
const good = name => ({
  id: name === source ? 111001 : 222002,
  full_name: name, private: true, visibility: "private",
  fork: false, disabled: false, default_branch: "main",
  archived: false, permissions: {push: true}
});
function fixture(records = {}, calls = []) {
  return async (url, options) => {
    calls.push({url, options});
    assert.match(url, /^https:\/\/api\.github\.com\/repos\//);
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer restricted-test-token");
    const name = url.slice("https://api.github.com/repos/".length);
    const result = records[name] ?? good(name);
    return {status: result?.status ?? 200, json: async () => result?.data ?? result};
  };
}
const base = {
  source, destination, approvedDestinations: [destination],
  token: "restricted-test-token"
};
const check = (overrides = {}, records = {}, calls = []) =>
  requirePrivateMirror({...base, fetchImpl: fixture(records, calls), ...overrides});

test("unresolved Oreslang cross-org incident hold rejects BEFORE credential, metadata or source access", async () => {
  for (const sourceName of [
    "ores-truffle-oreslang/oreslang-source.java",
    "OREs-TRUFFLE-oreslang/oreslang-source.java"
  ]) {
    const calls = [];
    await assert.rejects(check({
      source: sourceName,
      destination: "akrion-sim/akrion-sim-e2e",
      approvedDestinations: ["akrion-sim/akrion-sim-e2e"]
    }, {}, calls), /incident dispositions #22 and #77/);
    assert.equal(calls.length, 0, "no GitHub API request may precede containment");
  }
});

test("cross-org relay and mixed-case owner aliases are denied before any metadata or source read", async () => {
  for (const {source, destination} of [
    {source: "akrion-sim/existing-source-relay", destination: "voxletra/another-private-carrier"},
    {source: "synthetic-private/source", destination: "OTHER-PRIVATE/carrier"},
    {source: "Synthetic-Private/source", destination: "other-private/carrier"}
  ]) {
    const calls = [];
    await assert.rejects(check({
      source, destination, approvedDestinations: [destination]
    }, {}, calls), /incident dispositions #22 and #77/);
    assert.equal(calls.length, 0, "relay or owner alias must never access private API");
  }
});

test("Oreslang same-org private carrier is also suspended during the incident hold", async () => {
  for (const [source, destination] of [
    ["ores-truffle-oreslang/oreslang-source.java", "ores-truffle-oreslang/alternate-ci-private"],
    ["ORES-TRUFFLE-ORESLANG/oreslang-source.llvm", "ores-truffle-oreslang/private-runner-carrier"]
  ]) {
    const calls = [];
    await assert.rejects(check({
      source, destination, approvedDestinations:[destination]
    }, {}, calls), /incident dispositions #22 and #77/);
    assert.equal(calls.length, 0, "no private-source metadata should be fetched");
  }
});

test("Oreslang source self-mirror is denied before metadata or object requests", async () => {
  for (const repository of [
    "ores-truffle-oreslang/oreslang-source.java",
    "ORES-TRUFFLE-ORESLANG/oreslang-source.llvm"
  ]) {
    const calls = [];
    await assert.rejects(check({
      source: repository, destination: repository,
      approvedDestinations: [repository]
    }, {}, calls), /incident dispositions #22 and #77/);
    assert.equal(calls.length, 0, "self-repository mirroring must never acquire source bytes");
  }
});

test("accepts only explicitly approved and GitHub-verified writable private destination", async () => {
  const calls = [];
  assert.deepEqual(await check({}, {}, calls), {
    status: "PRIVATE_MIRROR_APPROVED", source, destination
  });
  assert.equal(calls.length, 2);
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

test("forked, disabled, changed-default-branch and invalid immutable IDs are denied",async()=>{
  const unsafe=[
    {fork:true},{disabled:true},{default_branch:"other"},
    {fork:undefined},{disabled:undefined},{default_branch:undefined},
    {id:0},{id:-1},{id:"222002"},{id:null},{id:1.25},
    {id:Number.MAX_SAFE_INTEGER+1}
  ];
  for(const patch of unsafe){
    for(const name of [source,destination]){
      const calls=[];
      const value={...good(name),...patch};
      await assert.rejects(check({}, {[name]:value}, calls),
        /invalid or mismatched repository metadata/);
      assert.equal(calls.length,name===source?1:2);
    }
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

test("incident hold handles mixed-case owner and repository aliases before contacting GitHub",async()=>{
 for(const [from,to] of [
  ["OrEs-TrUfFlE-OrEsLaNg/oreslang-source.java","ores-truffle-oreslang/other-private"],
  ["ores-truffle-oreslang/ORESLANG-SOURCE.LLVM","ores-truffle-oreslang/oreslang-source.llvm"],
  ["ORES-TRUFFLE-ORESLANG/oreslang-source.java","OREs-Truffle-OresLang/oreslang-source.java"],
  ["ores-truffle-oreslang/oreslang-source.java","PRIVATE-CARRIER/source-copy"]
 ]){
  const calls=[];
  await assert.rejects(check({source:from,destination:to,
   approvedDestinations:[to]}, {}, calls),/incident dispositions #22 and #77/);
  assert.equal(calls.length,0,"incident hold must precede GitHub HTTP");
 }
});

test("cross-owner relay hold precedes missing token, empty allowlist and throwing transport",async()=>{
 const from="scintilla-run-test/private-oreslang-relay",to="other-ci-org/private-copy";
 for(const override of [
  {token:undefined},{approvedDestinations:[]},
  {token:"",approvedDestinations:[to]},
  {fetchImpl:async()=>{throw Error("unexpected fetch");}}
 ]){
  const calls=[];
  await assert.rejects(check({source:from,destination:to,
   approvedDestinations:[to],...override}, {}, calls),/incident dispositions #22 and #77/);
  assert.equal(calls.length,0);
 }
});

test("destination identifier injection and ambiguous allowlist aliases are rejected before HTTP",async()=>{
 for(const bad of ["org/repo/extra","org/repo%2Fother","org/repo?x=1",
                    "org/repo#tag","org/..","org\\\\repo","org/repo\nX-Token: abc"]){
  const calls=[];
  await assert.rejects(check({destination:bad}, {}, calls),/invalid GitHub/);
  assert.equal(calls.length,0);
 }
 const calls=[];
 await assert.rejects(check({approvedDestinations:[destination.toUpperCase()]}, {}, calls),
   /allowlist/);
 assert.equal(calls.length,0,"approval aliases must not silently expand authorization");
});

test("source full_name mismatch and invalid private flag stop before destination lookup",async()=>{
 for(const sourceMeta of [
  {...good(source),full_name:"synthetic-private/another-source"},
  {...good(source),private:"true"},
  {...good(source),visibility:"public"}
 ]){
  const calls=[];
  await assert.rejects(check({}, {[source]:sourceMeta}, calls),
    /invalid or mismatched|private source metadata/);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url.endsWith("/"+source),true);
 }
});

test("rate limits, redirects and server errors cannot produce private-destination approval",async()=>{
 for(const status of [301,302,307,429,500,503]){
  const calls=[];
  await assert.rejects(check({}, {[destination]:{status}},calls),/unverifiable/);
  assert.equal(calls.length,2);
  assert.equal(calls.some(x=>x.options.redirect!=="error"),false);
 }
});

test("known private Oreslang carrier owners cannot relay within the same organization", async()=>{
  const quarantined=[
    "zed-pkg-test", "scintilla-run-test", "ores-dummy-org-oreslang-stack",
    "agent-pontifex-test", "led-dynamo", "claimgraph-test",
    "honeypot-r-us-test", "ores-llm"
  ];
  for(const owner of quarantined) for(const variant of [owner,owner.toUpperCase()]){
    const calls=[];
    const source=variant+"/previous-source-copy";
    const destination=variant+"/another-source-copy";
    await assert.rejects(check({source,destination,
      approvedDestinations:[destination]}, {}, calls),
      /incident dispositions #22 and #77/);
    assert.equal(calls.length,0,"incident quarantine must precede any API or source access");
  }
});
test("known incident carrier owners cannot receive same-owner private relays",async()=>{
  for(const owner of ["Ores-LLM","ZED-PKG-TEST","HONEYPOT-R-US-TEST"]){
    const calls=[];
    const source=owner+"/carrier";
    const destination=owner+"/carrier-next";
    await assert.rejects(check({source,destination,
      approvedDestinations:[destination]}, {}, calls),
      /incident dispositions #22 and #77/);
    assert.equal(calls.length,0);
  }
});
// Positive visibility fixtures in this suite are synthetic guard unit tests.
// They do not authorize real source transfer or resolve any incident.
