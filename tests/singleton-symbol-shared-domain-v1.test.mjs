import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyContract } from "../verification/verify-singleton-symbol-shared-domain-v1.mjs";
const path=fileURLToPath(new URL("../contracts/singleton-symbol-shared-domain-v1.json",import.meta.url));
const original=JSON.parse(readFileSync(path,"utf8"));
const clone=()=>structuredClone(original);
test("frozen additive source-free contract validates, WITHOUT guest certification",()=>{
 assert.equal(verifyContract(clone()),true);
 assert.equal(original.promotion.conformant,false);
});
const adversaries=[
 ["fabricated certification", c=>{c.status="certified"}],
 ["global identity instead of domain",c=>{c.scope="global"}],
 ["missing backend",c=>{c.backendTargets.pop()}],
 ["extra noncanonical backend",c=>{c.backendTargets.push("cranelift")}],
 ["dual owners",c=>{c.invariants.regionOwner="multiple"}],
 ["per-slot split singleton",c=>{c.invariants.perSlotShadowSingletons="permitted"}],
 ["raw private heap pointer",c=>{c.invariants.actorPrivateHeapPointers="shared-directly"}],
 ["raw cross-isolate pointer",c=>{c.invariants.crossIsolate="raw-pointer"}],
 ["unsafe symbol default ingress",c=>{c.invariants.untrustedSymbolAdmission="automatic"}],
 ["untrusted atom intern DoS",c=>{c.invariants.symbolWireDecode="intern-untrusted"}],
 ["weaken a required oracle",c=>{c.scenarios[1].requires.pop()}],
 ["alter case kind",c=>{c.scenarios[9].kind="compile"}],
 ["duplicate scenario",c=>{c.scenarios[11].id=c.scenarios[10].id}],
 ["missing scenario",c=>{c.scenarios.pop()}],
 ["fake compiler/guest pass",c=>{c.evidence[0].guestExecution="PASS"}],
 ["fake Wasm shared isolate",c=>{c.evidence[3].crossIsolate="PASS"}],
 ["fake NativeAOT certification",c=>{c.evidence[2].certification="CERTIFIED"}],
 ["premature promotion",c=>{c.promotion.conformant=true}],
 ["ignore stepful runner",c=>{c.promotion.stepfulRunnerRequired=false}],
 ["extra unreviewed field",c=>{c.extra="true"}]
];
for(const [name,mutate] of adversaries){
 test("fail closed: "+name,()=>{const c=clone();mutate(c);assert.throws(()=>verifyContract(c),/SINGLETON_DOMAIN_V1/)});
}
