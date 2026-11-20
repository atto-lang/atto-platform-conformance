import {createHash} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";
import {resolve,sep} from "node:path";

const fail=(message)=>{throw Error(message)};
const validSha=(value)=>typeof value==="string"&&/^[0-9a-f]{40}$/.test(value);
const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
const expectedBindings=[
  {
    "backend": "java",
    "repository": "ores-truffle-oreslang/oreslang-source.java",
    "path": "src/main/resources/dev/atto/core/numeric.atto",
    "stage": "PR_CANDIDATE"
  },
  {
    "backend": "llvm",
    "repository": "ores-truffle-oreslang/oreslang-source.llvm",
    "path": "stdlib/numeric.atto",
    "stage": "PR_CANDIDATE"
  },
  {
    "backend": "wasm",
    "repository": "ores-truffle-oreslang/oreslang-source.wasm",
    "path": "contracts/atto-core-v1/numeric.atto",
    "stage": "SNAPSHOT_ONLY"
  },
  {
    "backend": "net",
    "repository": "ores-truffle-oreslang/oreslang-source.net",
    "path": "contracts/atto-core-v1/numeric.atto",
    "stage": "SNAPSHOT_ONLY"
  },
  {
    "backend": "forge",
    "repository": "ores-truffle-oreslang/oreslang-source.forge",
    "path": "contracts/atto-core-v1/numeric.atto",
    "stage": "SNAPSHOT_ONLY"
  }
];

export function gitBlobId(bytes) {
 if(!Buffer.isBuffer(bytes))throw new TypeError("Git blob source must be a byte Buffer");
 return createHash("sha1")
   .update(Buffer.from("blob " + bytes.length + String.fromCharCode(0)))
   .update(bytes).digest("hex");
}

export function validateAttoLibrarySources(manifest){
 if(!manifest||manifest.schemaVersion!==1||
    manifest.contract!=="atto.library-source-identity/1"||
    manifest.canonicalSuffix!==".atto")fail("unknown library source schema");
 if(!same(manifest.coreNumeric,{
   module:"atto.core/numeric",
   gitBlob:"5ced991f1d49b3c2a60fdd72b9003c0a4d18cd72",
   snapshot:"fixtures/atto-library-source/v1/numeric.atto"}))
   fail("canonical Core numeric identity weakened");
 if(!same(manifest.allocCandidates,[
   {module:"atto.alloc/int_buffer",gitBlob:"25b3d4bc06a0c859aacadaf0795414027a076bdc",owner:"llvm",status:"CANDIDATE_NOT_FIVE_BACKEND"},
   {module:"atto.alloc/int_buffer_bundle",gitBlob:"07c7083e099a18f1db7097f9639efc677070eb95",owner:"llvm",status:"CANDIDATE_NOT_FIVE_BACKEND"}]))
   fail("Alloc source identity or candidate status weakened");
 if(!same(manifest.backendBindings,expectedBindings))
   fail("backend source path or source stage changed");
 if(!same(manifest.evidence,{
   sourceSnapshot:"SOURCE_ONLY",guestExecution:"NOT_EXECUTED",
   compilerBinary:"NOT_EXECUTED",linkedFreestandingArtifact:"NOT_EXECUTED"
 }))fail("source snapshot cannot promote guest or compiler evidence");
 return true;
}

export function checkLocalAttoLibrarySnapshot(manifest,root) {
 validateAttoLibrarySources(manifest);
 const target=resolve(root,manifest.coreNumeric.snapshot);
 if(!target.startsWith(resolve(root)+sep))fail("source snapshot escaped project");
 const info=lstatSync(target);
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1048576||info.size===0)
   fail("invalid or shared canonical snapshot file");
 const bytes=readFileSync(target);
 if(gitBlobId(bytes)!==manifest.coreNumeric.gitBlob)fail("source Git blob mismatch");
 if(!bytes.toString("utf8").includes("define module numeric as"))
   fail("canonical numeric module declaration absent");
 return {classification:"LOCAL_SOURCE_SNAPSHOT_ONLY",gitBlob:manifest.coreNumeric.gitBlob,
  guestExecution:"NOT_EXECUTED"};
}

// Input observations are unauthenticated claims; this checker validates their
// shape and consistency, never attests that GitHub returned these values.
// A separate reviewer must fetch each immutable Git tree/blob independently.
export function compareClaimedBackendBlobs(manifest,observations) {
 validateAttoLibrarySources(manifest);
 if(!Array.isArray(observations)||observations.length!==expectedBindings.length)
   fail("five backend source observations required");
 const seen=new Set();
 for(const observed of observations) {
   if(!observed||typeof observed!=="object"||
      !same(Object.keys(observed).sort(),
        ["backend","repository","path","head","tree","gitBlob","classification"].sort()))
      fail("source observation has missing, unknown or promoted evidence fields");
   const binding=expectedBindings.find(x=>x.backend===observed.backend);
   if(!binding||seen.has(observed.backend))fail("duplicate or unknown backend");
   seen.add(observed.backend);
   if(observed.repository!==binding.repository||observed.path!==binding.path)
     fail("backend source path identity differs");
   if(!validSha(observed.head)||!validSha(observed.tree))
     fail("exact backend source HEAD and Git tree IDs required");
   if(!validSha(observed.gitBlob)||observed.gitBlob!==manifest.coreNumeric.gitBlob)
     fail("backend numeric source Git blob differs");
   if(observed.classification!=="GITHUB_SOURCE_BLOB_CLAIM_ONLY")
     fail("cannot promote backend execution from a source Git blob");
 }
 return {classification:"UNVERIFIED_FIVE_BACKEND_SOURCE_CLAIMS",
   backends:seen.size,expectedGitBlob:manifest.coreNumeric.gitBlob,
   guestExecution:"NOT_EXECUTED"};
}
