#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const owner="ores-truffle-oreslang";
const sourceNames=Object.freeze(["java","llvm","net","wasm","forge","cranelift","js","rs","hdl"]);
const platformNames=Object.freeze(["desktop","mobile","embedded","iot","fpga","asic"]);
const upstreams=Object.freeze({desktop:["llvm"],mobile:["llvm"],embedded:["llvm"],iot:["llvm"],fpga:["hdl"],asic:["hdl"]});
const axes=Object.freeze(["runner-admission","exact-head-and-tree","source-preflight","compiler-source-check","native-link","guest-execution","receipt-authentication","merge-governance"]);
const policy=Object.freeze({zeroSteps:"not-executed",hostOnlyIsGuest:false,claimedShaIsAttested:false,offlineValidatorIsAttestation:false,unsupportedIsPassing:false,sourceExportRequiresIndependentAuthorization:true});
const hasOwn=(o,k)=>Object.hasOwn(o,k);
const isRecord=x=>x!==null && typeof x==="object" && !Array.isArray(x);
const sameMembers=(value,wanted)=>Array.isArray(value)&&value.length===wanted.length&&value.every((v,i)=>v===wanted[i]);
const exactKeys=(obj,keys)=>isRecord(obj)&&Object.keys(obj).length===keys.length&&keys.every(k=>hasOwn(obj,k));
const repo=(name)=>owner+"/"+name;

/** Inventory/contract consistency only. Never authenticates GitHub or compiler execution. */
export function checkSourcePlatformGovernance(registry,capabilityContract,legacyInventory) {
  const errors=[];
  const fail=x=>errors.push(x);
  if(!isRecord(registry)||registry.schemaVersion!==1||registry.contract!=="atto.source-platform-governance/1")
    return {ok:false,attested:false,errors:["unsupported governance registry"]};
  if(!exactKeys(registry,["schemaVersion","contract","status","authorityRepository","sourceRepositories","platformRepositories","evidenceAxes","evidencePolicy"]))
    fail("unexpected or missing top-level governance registry fields");
  if(registry.status!=="inventory-only-not-attested"||registry.authorityRepository!==repo("oreslang-platform-conformance"))
    fail("registry authority/status may not assert execution or alternate authority");
  if(!exactKeys(registry.sourceRepositories,sourceNames))fail("incomplete or substituted source repository inventory");
  for(const id of sourceNames)
    if(registry.sourceRepositories?.[id]!==repo("oreslang-source."+id))fail("source repository mismatch: "+id);
  if(!exactKeys(registry.platformRepositories,platformNames))fail("incomplete or substituted platform repository inventory");
  for(const id of platformNames) {
    const item=registry.platformRepositories?.[id];
    if(!exactKeys(item,["repository","upstreamSources"])) {fail("bad platform entry: "+id);continue;}
    if(item.repository!==repo("oreslang-platform."+id))fail("platform repository mismatch: "+id);
    if(!sameMembers(item.upstreamSources,upstreams[id]))fail("unknown, missing or reordered source upstream: "+id);
  }
  if(!sameMembers(registry.evidenceAxes,axes))fail("all eight independent evidence axes must be retained in order");
  if(!exactKeys(registry.evidencePolicy,Object.keys(policy)))fail("evidence policy keys changed");
  for(const [key,value] of Object.entries(policy))
    if(registry.evidencePolicy?.[key]!==value)fail("weakened evidence policy: "+key);
  if(!isRecord(capabilityContract)||capabilityContract.contract!=="oreslang.platform-capability/1"||capabilityContract.schemaVersion!==1)
    fail("missing v1 platform capability authority");
  for(const id of platformNames)
    if(capabilityContract?.platforms?.[id]?.repository!==repo("oreslang-platform."+id))
      fail("capability registry platform mismatch: "+id);
  if(!isRecord(capabilityContract?.platforms)||Object.keys(capabilityContract.platforms).length!==platformNames.length)
    fail("capability platform coverage differs from governance inventory");
  if(!isRecord(legacyInventory)||!Array.isArray(legacyInventory.repositories))fail("missing integration graph");
  else {
    const matches=new Map();
    for(const item of legacyInventory.repositories) {
      if(!isRecord(item)||typeof item.name!=="string")continue;
      matches.set(item.name,(matches.get(item.name)||[]).concat(item));
    }
    for(const id of platformNames) {
      const name="oreslang-platform."+id, entries=matches.get(name)||[];
      if(entries.length!==1) {fail("integration graph missing or duplicate platform: "+id);continue;}
      if(!Array.isArray(entries[0].upstreams)) {fail("integration graph missing upstream list: "+id);continue;}
      const declared=new Set(entries[0].upstreams);
      if(declared.size!==entries[0].upstreams.length)fail("duplicate integration dependency: "+id);
      for(const source of upstreams[id])
        if(!declared.has("oreslang-source."+source))fail("integration graph missing source edge: "+id+" -> "+source);
    }
  }
  return {ok:errors.length===0,attested:false,sourceCount:sourceNames.length,platformCount:platformNames.length,errors};
}

export function checkFiles(base=root) {
  const read=p=>JSON.parse(fs.readFileSync(path.join(base,p),"utf8"));
  return checkSourcePlatformGovernance(read("contracts/source-platform-governance-v1.json"),read("contracts/platform-capabilities-v1.json"),read("integration/repositories.json"));
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {
    const result=checkFiles();
    if(!result.ok) {for(const message of result.errors)console.error("governance: "+message);process.exitCode=1;}
    else console.log("source/platform inventory: "+result.sourceCount+" source + "+result.platformCount+" platform; consistency PASS; authenticity NOT_ATTESTED");
  } catch(error) {
    console.error("governance: "+error.message);process.exitCode=1;
  }
}
