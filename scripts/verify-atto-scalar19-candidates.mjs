#!/usr/bin/env node
// Status/provenance metadata schema only. NEVER authenticates external GitHub runs.
import {readFileSync,lstatSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const SOURCE=resolve(dirname(fileURLToPath(import.meta.url)),"../contracts/atto-source-v1/scalar-19-candidates.json");
const PIN={"expected":[{"id":"java","repository":"ores-truffle-oreslang/oreslang-source.java","pr":2501,"head_sha":"399a293920b486216ac8dff3ec4a4a17cd776aee","tree_sha":"e72423eced5054a729e152a36e46e7795c7a29ad","planned_scope":"compiler-admission-10-positive-5-negative"},{"id":"llvm","repository":"ores-truffle-oreslang/oreslang-source.llvm","pr":1348,"head_sha":"c4f725cde2f62470285d2269af002e4a064d84d5","tree_sha":"c03f2bd48ae86bcd7a234e3cf0e2a740227be05e","planned_scope":"native-execution-7-positive-3-negative"},{"id":"wasm","repository":"ores-truffle-oreslang/oreslang-source.wasm","pr":278,"head_sha":"9311d86fa82c26d26031714037ad44a59d37744a","tree_sha":"c6fe343e4ef8b348c8d584819b8e7aa293cc317b","planned_scope":"isolated-wasm-execution-10-positive-3-negative"},{"id":"net","repository":"ores-truffle-oreslang/oreslang-source.net","pr":350,"head_sha":"ef374ff7ba80ae43c1766fb841c1b3996e4d1b02","tree_sha":"a8e824986eb40a513e63ae5237b2992ddcea5c7d","planned_scope":"linux-nativeaot-execution-2-positive-3-negative"},{"id":"forge","repository":"ores-truffle-oreslang/oreslang-source.forge","pr":178,"head_sha":"82222ea9128ff54865696c17a82877e535898543","tree_sha":"f41e0ce606a711e8bca7557a6ea15b18bb1a1ea0","planned_scope":"stage0-ir-native-10-positive-9-negative"}],"common_source":{"repository":"ores-truffle-oreslang/oreslang-common-source","pr":217,"head_sha":"6a158074810bda5c25dc51c1714214c6852c69a9","manifest_blob_sha1":"43c4d295a237e483f70722bd90ec10d273b73854","cases":19,"positive":10,"negative":9}};
const NOTES=["These are candidate PR HEADs/trees and authored test scopes only, not authenticated executable observations.","The five GitHub source trees were each read back with matching 19/19 fixture blob hashes, but this local manifest alone cannot verify any remote source.","The independent Cranelift JIT backend is not Forge; it has its own separate scalar parity route.","Zero-step GitHub Actions are runner admission failures; no compiler or native guest execution claimed."];
function keys(v,expected){
 if(!v||typeof v!=="object"||Array.isArray(v)||
    JSON.stringify(Object.keys(v))!==JSON.stringify(expected))
   throw Error("incorrect scalar candidate fields");
}
export function verifyAttoScalar19CandidateManifest(path=SOURCE){
 const f=resolve(path);
 if(lstatSync(f).isSymbolicLink()||!lstatSync(f).isFile())throw Error("invalid scalar candidate manifest file");
 const raw=readFileSync(f,"utf8");
 const m=JSON.parse(raw);
 if(raw!==JSON.stringify(m,null,2)+"\n")throw Error("noncanonical or duplicate candidate JSON");
 keys(m,["schema","common_source","source_identity","guest_evidence","certified_parity","backend_candidates","notes"]);
 if(m.schema!=="attolang.scalar-five-backend-candidates.v1"||
    JSON.stringify(m.common_source)!==JSON.stringify(PIN.common_source)||
    m.source_identity!=="independently-readback-19-of-19-per-source-PR-as-of-2026-11-03"||
    m.guest_evidence!=="NOT_EXECUTED"||m.certified_parity!==false||
    JSON.stringify(m.notes)!==JSON.stringify(NOTES))
   throw Error("unreviewed evidence/corpus promotion metadata");
 if(!Array.isArray(m.backend_candidates)||m.backend_candidates.length!==5)
   throw Error("five independently identified compiler routes required");
 for(let i=0;i<PIN.expected.length;i++){
   const expected=PIN.expected[i],record=m.backend_candidates[i];
   keys(record,["id","repository","pr","head_sha","tree_sha","planned_scope","status"]);
   if(record.id!==expected.id||record.repository!==expected.repository||
      record.pr!==expected.pr||record.head_sha!==expected.head_sha||
      record.tree_sha!==expected.tree_sha||
      record.planned_scope!==expected.planned_scope||
      record.status!=="NOT_EXECUTED")
     throw Error("backend candidate identity/status mismatch: "+i);
 }
 return {candidates:5,cases:19,sourceIdentityOnly:true,guestsExecuted:0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log("ATTO_SCALAR_19_METADATA_SOURCE_ONLY "+JSON.stringify(verifyAttoScalar19CandidateManifest()));}
 catch(e){console.error("ATTO_SCALAR_19_METADATA_DENIED "+e.message);process.exitCode=1;}
}
