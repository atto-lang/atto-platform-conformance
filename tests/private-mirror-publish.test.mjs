import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {publishPrivateMirror} from "../bin/private-mirror-publish.mjs";

const cli = fileURLToPath(new URL("../bin/private-mirror-publish.mjs", import.meta.url));
const source = "synthetic-source/org";
const destination = "synthetic-test/carrier";
const A = "a".repeat(40), B = "b".repeat(40);
const base = {source, destination, sourceCommit:A, destinationBaseCommit:B,
  prefix:"snapshots/test", newBranch:"ci/private-synthetic-test",
  approvedDestinations:[destination], token:"NEVER_LOG_THIS_SYNTHETIC_SECRET"};

const scenarios = [
  ["valid-looking approved request", {}],
  ["empty request", null],
  ["no request", undefined],
  ["missing token", {token:undefined}],
  ["operator allowlist", {approvedDestinations:[destination]}],
  ["operator force flag", {force:true}],
  ["claimed signed approval", {policyApproved:true, signedApproval:true}],
  ["claimed independently reviewed receipt", {authorizationReceipt:{status:"approved"}}],
  ["changed destination", {destination:"other-private/carrier"}],
  ["public destination", {destination:"public-org/carrier"}],
  ["unsafe path", {prefix:"../../secret"}],
  ["main branch", {newBranch:"main"}],
  ["exact SHA", {sourceCommit:A}],
  ["no SHA", {sourceCommit:null}],
  ["empty allowlist", {approvedDestinations:[]}],
  ["simulated fresh quota", {actionsMinutesRemaining:1000}],
  ["mock source tree", {sourceTree:{tree:[]}}],
  ["proposed override", {overrideIncidentHold:true}],
];

for (const [name, override] of scenarios) {
  test(`legacy publisher denies ${name} before source IO`, async () => {
    let requests = 0;
    const fetchImpl = async () => { requests++; throw Error("network invoked"); };
    const options = override === undefined ? undefined : override === null ? null : {...base, ...override, fetchImpl};
    await assert.rejects(publishPrivateMirror(options), /PRIVATE_MIRROR_SUSPENDED/);
    assert.equal(requests, 0);
  });
}

test("poisoned accessors and Proxy traps are not touched", async () => {
  let getters = 0;
  const attacker = new Proxy({}, {get() { getters++; throw Error("REQUEST_READ"); },
    ownKeys() { getters++; throw Error("REQUEST_ENUMERATED"); }});
  await assert.rejects(publishPrivateMirror(attacker), /PRIVATE_MIRROR_SUSPENDED/);
  assert.equal(getters, 0);
});

test("injected source/destination fetch hooks cannot be invoked", async () => {
  let requests = 0;
  const denied = publishPrivateMirror({...base, fetchImpl:async () => { requests++; return {}; }});
  await assert.rejects(denied, /PRIVATE_MIRROR_SUSPENDED/);
  assert.equal(requests, 0);
});

test("inherited request properties cannot change incident hold", async () => {
  let touched = 0;
  const opts = Object.create({get fetchImpl() { touched++; throw Error("READ"); }});
  await assert.rejects(publishPrivateMirror(opts), /PRIVATE_MIRROR_SUSPENDED/);
  assert.equal(touched, 0);
});

test("CLI is denied regardless of allowlist and avoids printing secrets", () => {
  const result = spawnSync(process.execPath,
    [cli, source, A, destination, B, "snapshots/test", "ci/private-synthetic-test"],
    {env:{...process.env, GH_TOKEN:base.token,
      ORES_APPROVED_PRIVATE_MIRRORS:destination}, encoding:"utf8", timeout:5000});
  assert.equal(result.status, 1, result.error?.message);
  assert.match(result.stderr, /PRIVATE_MIRROR_SUSPENDED/);
  assert.doesNotMatch(result.stdout + result.stderr, /NEVER_LOG_THIS_SYNTHETIC_SECRET/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_MIRROR_PUBLISHED/);
});

test("CLI with no arguments is denied", () => {
  const result = spawnSync(process.execPath, [cli], {encoding:"utf8",timeout:5000});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PRIVATE_MIRROR_SUSPENDED/);
});

test("importing the publisher does not log or perform GitHub calls", () => {
  const script = `globalThis.fetch = () => { throw Error("FETCH_CALLED"); };\nimport(${JSON.stringify(new URL("../bin/private-mirror-publish.mjs", import.meta.url).href)}).then(()=>console.log("IMPORT_OK"));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script],
    {encoding:"utf8",timeout:5000});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "IMPORT_OK");
  assert.equal(result.stderr, "");
});

test("programmatic rejection remains unchanged under operator flags", async () => {
  const old = process.env.ORES_APPROVED_PRIVATE_MIRRORS;
  const oldToken = process.env.GITHUB_TOKEN;
  try {
    process.env.ORES_APPROVED_PRIVATE_MIRRORS = destination;
    process.env.GITHUB_TOKEN = base.token;
    await assert.rejects(publishPrivateMirror(base), /PRIVATE_MIRROR_SUSPENDED/);
  } finally {
    if(old === undefined) delete process.env.ORES_APPROVED_PRIVATE_MIRRORS;
    else process.env.ORES_APPROVED_PRIVATE_MIRRORS = old;
    if(oldToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = oldToken;
  }
});
