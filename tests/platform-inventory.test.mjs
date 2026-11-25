import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {platforms, verifyInventory, verifyBundle, verifyFiles} from "../bin/verify-platform-inventory.mjs";

const all = () => Object.entries(platforms).map(([name,info]) => ({
  schema:"oreslang.platform-inventory/1",
  platform:name,
  repository:"ores-truffle-oreslang/oreslang-platform." + name,
  targetClass:info.targetClass,
  integrationSha256:"a".repeat(64),
  role:"host",
  upstreams:[...info.upstreams],
  evidence:"not-attested",
  claims:{compilerGuest:false,targetExecuted:false,physicalHardware:false,releaseAuthorized:false}
}));
const clone = value => JSON.parse(JSON.stringify(value));
function filesTest(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"ores-inventory-bundle-"));
  const entries = all();
  const files = entries.map((entry,index) => {
    const file = path.join(dir,index + ".json");
    fs.writeFileSync(file,JSON.stringify(entry,null,2)+"\n");
    return file;
  });
  try { return run({dir,files,entries}); }
  finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

test("complete six-platform declarations pass without an attestation claim", () => {
  const result = verifyBundle(all());
  assert.deepEqual(result,{ok:true,errors:[]});
  filesTest(({files}) => assert.deepEqual(verifyFiles(files),{ok:true,errors:[]}));
});

test("reject omitted, duplicated, unknown and substituted platform identities", () => {
  const original = all();
  assert.equal(verifyBundle(original.slice(1)).ok,false);
  const duplicate = clone(original);
  duplicate[1] = clone(duplicate[0]);
  assert.equal(verifyBundle(duplicate).ok,false);
  for (const invalid of [
    {platform:"constructor"}, {platform:"__proto__"},
    {repository:"foreign/fpga"}, {targetClass:"physical-asic"},
    {upstreams:["oreslang-source.wasm"]}
  ]) {
    const broken = clone(original);
    Object.assign(broken[0],invalid);
    assert.equal(verifyBundle(broken).ok,false);
  }
});

test("reject forged evidence, promotion claims and noncanonical shapes", () => {
  const item = all()[0];
  for (const bad of [
    {evidence:"attested"},
    {role:"compiler-guest"},
    {claims:{...item.claims,compilerGuest:true}},
    {claims:{...item.claims,releaseAuthorized:true}},
    {integrationSha256:"A".repeat(64)},
    {schema:"oreslang.platform-inventory/2"},
    {unexpected:"success"}
  ]) {
    assert.equal(verifyInventory({...item,...bad}).ok,false);
  }
  assert.equal(verifyInventory(Object.create(null)).ok,false);
  assert.equal(verifyInventory(null).ok,false);
});

test("reject aliased, malformed or oversized inventory files", () => {
  filesTest(({dir,files}) => {
    const damaged = files[0];
    const original = fs.readFileSync(damaged,"utf8");
    const duplicate = original.replace('"role": "host",', '"role": "host",\n  "role": "host",');
    assert.notEqual(duplicate,original);
    fs.writeFileSync(damaged,duplicate);
    assert.throws(() => verifyFiles(files));
    fs.writeFileSync(damaged,original + " ");
    assert.throws(() => verifyFiles(files));
    fs.writeFileSync(damaged,"x".repeat(16385));
    assert.throws(() => verifyFiles(files));
    fs.writeFileSync(damaged,original);
    const alias = path.join(dir,"alias.json");
    fs.symlinkSync(damaged,alias);
    assert.throws(() => verifyFiles([alias,...files.slice(1)]));
    fs.rmSync(alias);
    fs.linkSync(damaged,alias);
    assert.throws(() => verifyFiles(files));
  });
});
