import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";

const cli = fileURLToPath(new URL("../bin/require-private-mirror.mjs", import.meta.url));
const source = "synthetic-source/repo", destination = "synthetic-private/repo";
const base = {source, destination, approvedDestinations:[destination], token:"FAKE_METADATA_TEST_TOKEN"};

const cases = [
  ["valid-looking private repository metadata", {}],
  ["missing source", {source:undefined}],
  ["missing destination", {destination:undefined}],
  ["missing approval list", {approvedDestinations:[]}],
  ["operator allowlist", {approvedDestinations:[destination]}],
  ["forced allowlist", {approvedDestinations:["*",destination]}],
  ["missing token", {token:undefined}],
  ["untrusted token", {token:"test"}],
  ["synthetic public source", {source:"example/public"}],
  ["synthetic internal destination", {destination:"example/internal"}],
  ["claimed private visibility", {sourceMetadata:{private:true},destinationMetadata:{private:true}}],
  ["claimed incident closure", {incidentsClosed:[22,77]}],
  ["claimed policy receipt", {policy:{enabled:true,signature:"synthetic"}}],
  ["fresh Actions minutes", {actionsMinutesRemaining:1000}],
];

for (const [description,change] of cases) {
  test(`legacy metadata verifier denies ${description} before IO`, async () => {
    let requests = 0;
    const fetchImpl = () => { requests++; throw Error("FETCH_CALLED"); };
    await assert.rejects(requirePrivateMirror({...base,...change,fetchImpl}), /PRIVATE_MIRROR_SUSPENDED/);
    assert.equal(requests,0);
  });
}

test("poisoned input getters are never read", async () => {
  let accessed = 0;
  const input = new Proxy({}, {get() {accessed++;throw Error("POISON");}});
  await assert.rejects(requirePrivateMirror(input), /PRIVATE_MIRROR_SUSPENDED/);
  assert.equal(accessed,0);
});

test("undefined and null arguments fail with an incident hold", async () => {
  await assert.rejects(requirePrivateMirror(), /PRIVATE_MIRROR_SUSPENDED/);
  await assert.rejects(requirePrivateMirror(null), /PRIVATE_MIRROR_SUSPENDED/);
});

test("metadata preflight CLI is denied without credential exposure", () => {
  const result = spawnSync(process.execPath,[cli,source,destination],{
    encoding:"utf8",timeout:5000,env:{...process.env,
      GH_TOKEN:base.token,ORES_APPROVED_PRIVATE_MIRRORS:destination}});
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,/PRIVATE_MIRROR_SUSPENDED/);
  assert.doesNotMatch(result.stdout+result.stderr,/FAKE_METADATA_TEST_TOKEN|PRIVATE_MIRROR_APPROVED/);
});

test("metadata preflight CLI denies missing arguments", () => {
  const result = spawnSync(process.execPath,[cli],{encoding:"utf8",timeout:5000});
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,/PRIVATE_MIRROR_SUSPENDED/);
});

test("imported metadata verifier does not run any network requests", () => {
  const url = new URL("../bin/require-private-mirror.mjs", import.meta.url).href;
  const script = `globalThis.fetch=()=>{throw Error("FETCH_CALLED")}; import(${JSON.stringify(url)}).then(()=>console.log("IMPORT_OK"));`;
  const result = spawnSync(process.execPath,["--input-type=module","-e",script],{encoding:"utf8",timeout:5000});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout.trim(),"IMPORT_OK");
  assert.equal(result.stderr,"");
});
