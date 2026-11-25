import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSourcePlatformGovernance } from "../bin/check-source-platform-governance.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const base=[read("contracts/source-platform-governance-v1.json"),read("contracts/platform-capabilities-v1.json"),read("integration/repositories.json")];
const check=mutate=>{const copies=structuredClone(base);mutate(copies);return checkSourcePlatformGovernance(...copies);};
test("full 9+6 inventory reconciles with platform capability and integration entries without authenticating it",()=>{
  const result=check(()=>{});
  assert.equal(result.ok,true,result.errors.join("\n"));
  assert.equal(result.attested,false);
  assert.equal(result.sourceCount,9);assert.equal(result.platformCount,6);
});
test("missing, extra or substituted source identities fail closed",()=>{
  for(const id of ["java","rs","hdl","cranelift"]) {
    assert.equal(check(([r])=>{delete r.sourceRepositories[id]}).ok,false,id);
    assert.equal(check(([r])=>{r.sourceRepositories[id]="attacker/mirror"}).ok,false,id);
  }
  assert.equal(check(([r])=>{r.sourceRepositories.foreign="other/repo"}).ok,false);
});
test("missing, spoofed or rogue platform coverage fails closed",()=>{
  for(const id of ["desktop","mobile","iot","fpga","asic","embedded"]) {
    assert.equal(check(([r])=>{delete r.platformRepositories[id]}).ok,false,id);
    assert.equal(check(([r])=>{r.platformRepositories[id].repository="other/repo"}).ok,false,id);
  }
  assert.equal(check(([r])=>{r.platformRepositories.fake={repository:"fake/repo",upstreamSources:[]}}).ok,false);
});
test("no platform may silently drop, substitute or append a compiler edge",()=>{
  for(const id of ["mobile","fpga"]) {
    assert.equal(check(([r])=>{r.platformRepositories[id].upstreamSources=[]}).ok,false);
    assert.equal(check(([r])=>{r.platformRepositories[id].upstreamSources=["js"]}).ok,false);
    assert.equal(check(([r])=>{r.platformRepositories[id].upstreamSources.push("llvm")}).ok,false);
  }
});
test("capability cross-reference drift rejects platform substitution",()=>{
  assert.equal(check(([,cap])=>{cap.platforms.mobile.repository="attacker/mobile"}).ok,false);
  assert.equal(check(([,cap])=>{delete cap.platforms.fpga}).ok,false);
  assert.equal(check(([,cap])=>{cap.platforms.extra={repository:"other/repo"}}).ok,false);
});
test("integration graph cannot remove, duplicate, or corrupt a platform dependency",()=>{
  assert.equal(check(([, ,inventory])=>{inventory.repositories.find(x=>x.name==="oreslang-platform.asic").upstreams=[]}).ok,false);
  assert.equal(check(([, ,inventory])=>{inventory.repositories.push(structuredClone(inventory.repositories.find(x=>x.name==="oreslang-platform.mobile")))}).ok,false);
  assert.equal(check(([, ,inventory])=>{inventory.repositories.find(x=>x.name==="oreslang-platform.mobile").upstreams={}}).ok,false);
});
test("evidence classification and private-source approval policy cannot be weakened",()=>{
  for(const mutation of [
    r=>r.evidenceAxes.pop(),r=>r.evidenceAxes[0]="workflow-queued",
    r=>r.evidencePolicy.zeroSteps="pass",r=>r.evidencePolicy.hostOnlyIsGuest=true,
    r=>r.evidencePolicy.claimedShaIsAttested=true,r=>r.evidencePolicy.offlineValidatorIsAttestation=true,
    r=>r.evidencePolicy.unsupportedIsPassing=true,
    r=>r.evidencePolicy.sourceExportRequiresIndependentAuthorization=false,
    r=>r.status="passed",r=>r.attested=true
  ])assert.equal(check(([r])=>mutation(r)).ok,false);
});
test("prototype-shaped names and malformed records never promote",()=>{
  assert.equal(check(([r])=>{r.platformRepositories=JSON.parse('{"__proto__":{}}')}).ok,false);
  assert.equal(check(([r])=>{r.sourceRepositories=null}).ok,false);
});
