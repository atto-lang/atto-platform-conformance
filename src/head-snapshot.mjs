import {readFileSync} from "node:fs";
import {loadCandidateInventory,loadCompatibilityCandidate,validateCompatibilityCandidate} from "./compatibility-release.mjs";
export const snapshotPath = new URL("../integration/head-provenance-snapshot.v1.json",import.meta.url);
const fields=["schemaVersion","candidateId","organization","observationWindow","method","kind","compatibility","sourceExport","repositories"];
const item=["name","repositoryId","pinnedSha","observedMainSha","relation"];
const eqFields=(o,list,at)=>{if(!o||typeof o!=="object"||Array.isArray(o)||
 JSON.stringify(Object.keys(o).sort())!==JSON.stringify([...list].sort()))
 throw Error(at+": unexpected or missing metadata fields")};
export function validateHeadSnapshot(snapshot,candidate,registry){
 validateCompatibilityCandidate(candidate,registry);
 eqFields(snapshot,fields,"head snapshot");
 if(snapshot.schemaVersion!==1 || snapshot.candidateId!==candidate.releaseId ||
 snapshot.organization!==candidate.organization ||
 snapshot.kind!=="READ_ONLY_PROVENANCE_SNAPSHOT_NOT_ATTESTATION" ||
 snapshot.compatibility!=="NOT_VERIFIED" || snapshot.sourceExport!=="NONE" ||
 typeof snapshot.observationWindow!=="string" || snapshot.observationWindow.length<15 ||
 typeof snapshot.method!=="string" ||
 !snapshot.method.includes("authenticated metadata") ||
 !Array.isArray(snapshot.repositories) || snapshot.repositories.length!==candidate.pins.length)
 throw Error("head snapshot: invalid provenance or false release claim");
 let exact=0,ancestors=0;
 for(let i=0;i<candidate.pins.length;i++){
  const p=candidate.pins[i],r=snapshot.repositories[i];eqFields(r,item,"head entry");
  if(r.name!==p.name||r.repositoryId!==p.repositoryId||r.pinnedSha!==p.commit||
     typeof r.observedMainSha!=="string" || !/^[a-f0-9]{40}$/.test(r.observedMainSha))
    throw Error("head snapshot: identity, ref or ordering mismatch");
  if(r.observedMainSha===r.pinnedSha){
    if(r.relation!=="EXACT_MAIN")throw Error("head snapshot: false exact-ref relation");
    exact++;
  }else{
    if(r.relation!=="ANCESTOR_OF_MAIN")throw Error("head snapshot: inconsistent ancestor relation");
    ancestors++;
  }
 }
 return Object.freeze({result:"SNAPSHOT_STRUCTURE_ONLY_NOT_REMOTE_ATTESTATION",
  entries:snapshot.repositories.length,exactMain:exact,recordedAncestors:ancestors,
  remotesRecheckedByThisCommand:false,releaseReady:false});
}
export function loadHeadSnapshot(path=snapshotPath){
 const s=readFileSync(path,"utf8"),p=JSON.parse(s);
 if(JSON.stringify(p,null,2)+"\n"!==s)throw Error("head snapshot: noncanonical JSON");
 return p;
}
export function verifyStoredHeadSnapshot(){
 return validateHeadSnapshot(loadHeadSnapshot(),loadCompatibilityCandidate(),loadCandidateInventory());
}
