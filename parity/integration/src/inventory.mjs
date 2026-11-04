/** Six exact draft-head inventory checks. This never certifies compiler parity. */
export const HEADS=Object.freeze([
 '4f5b723c9f55d21eb7a07631a41dd63fec0cffd1',
 '4bb5e69efa871bee7829af4790dbd5bc0c2bbae4',
 '7f614ac1128dabeb06ca6b67678c11a341fe973c',
 '478292e8fa8ee08cbd1553d785aa83b327dd610a',
 '178598885b1c9e5399a1ed05fa5c4a6e2c008184',
 '938fade4961cd1432951d52fea98715b21c442f3'
]);
export const PULLS=Object.freeze([47,49,52,54,55,56]);
export const FILE_COUNTS=Object.freeze([13,19,16,13,17,14]);
export const BACKENDS=Object.freeze(['java','llvm','net','forge','wasm']);
export const TASKS=Object.freeze(['exact-six-wave-tree-pin-and-path-collision','same-private-repo-executable-host-ci','exact-head-runtime-observation-gate','cross-wave-fixture-and-provenance-audit','production-backend-merge-readiness']);
const fail=s=>{throw Error('integration-inventory: '+s)};
const isObj=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
function fields(o,ks){if(!isObj(o)||Object.keys(o).length!==ks.length||ks.some(k=>!Object.hasOwn(o,k))||Reflect.ownKeys(o).length!==ks.length)fail('unknown/missing fields')}
const sha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
const cleanPath=p=>typeof p==='string'&&/^[a-zA-Z0-9_.\/-]{4,240}$/.test(p)&&!p.startsWith('/')&&!p.includes('//')&&!p.split('/').some(k=>k==='.'||k==='..');
export function validateInventory(m){
 fields(m,['schemaVersion','kind','status','sourceRepository','tasks','backends','waves','requiredProof','certifiedParity']);
 if(m.schemaVersion!==1||m.kind!=='oreslang-roadmap-integration'||m.status!=='draft-host-suite-conformance-not-compiler-parity'||m.sourceRepository!=='ores-truffle-oreslang/oreslang-platform-conformance'||m.certifiedParity!==false)fail('false release assertion');
 if(JSON.stringify(m.backends)!==JSON.stringify(BACKENDS)||!Array.isArray(m.waves)||m.waves.length!==6||!Array.isArray(m.tasks)||m.tasks.length!==5||!Array.isArray(m.requiredProof)||m.requiredProof.length!==6)fail('backend/task/source inventory');
 for(let i=0;i<5;i++){fields(m.tasks[i],['id','name']);if(m.tasks[i].id!==i+31||m.tasks[i].name!==TASKS[i])fail('task identity differs')}
 const all=new Set();
 for(let i=0;i<6;i++){
  const w=m.waves[i];fields(w,['wave','pr','head','path','changedFiles','pinnedFiles']);
  if(w.wave!==i+1||w.pr!==PULLS[i]||w.head!==HEADS[i]||w.path!=='checkouts/wave'+(i+1))fail('unreviewed PR/head/path substitution');
  if(!Array.isArray(w.changedFiles)||w.changedFiles.length!==FILE_COUNTS[i]||!Array.isArray(w.pinnedFiles)||w.pinnedFiles.length!==(i>=4?3:2))fail('file count/selected anchors');
  let expectedAnchorCount=0;
  for(const p of w.changedFiles){
   if(!cleanPath(p)||(!p.startsWith('parity/wave'+(i+1)+'/')&&!p.startsWith('.github/workflows/')&&p!=='contracts/v1/PRIVATE_ABSTRACT_ACTOR_HOOKS_V1.md')||all.has(p))fail('path collision or unexpected file');
   all.add(p);
  }
  const pins=new Set();
  for(const entry of w.pinnedFiles){
   fields(entry,['path','gitBlob']);
   if(!w.changedFiles.includes(entry.path)||!sha(entry.gitBlob)||pins.has(entry.path))fail('unreviewed pinned blob/duplicate');
   pins.add(entry.path);
   if(entry.path.endsWith('/manifest.json'))expectedAnchorCount++;
  }
  if(expectedAnchorCount!==1)fail('manifest is not pinned');
  const testName=i===3?'wave4.test.mjs':i===2?'reference.test.mjs':'wave'+(i+1)+'.test.mjs';
  if(!pins.has('parity/wave'+(i+1)+'/tests/'+testName))fail('primary test is not pinned');
 }
 if(all.size!==92)fail('aggregate file inventory drift');
 if(m.waves[4].pinnedFiles[2]?.gitBlob!==m.waves[5].pinnedFiles[2]?.gitBlob||m.waves[4].pinnedFiles[2]?.path!=='parity/wave5/fixtures/llvm-native-main.ores'||m.waves[5].pinnedFiles[2]?.path!=='parity/wave6/fixtures/scalar-42.ores')fail('cross-wave scalar golden source drift');
 if(m.requiredProof.some(x=>typeof x!=='string'||x.length<15))fail('proof requirements must be explicit');
 return Object.freeze({status:'PINNED_INVENTORY_VALID',waves:6,files:all.size,anchoredBlobs:m.waves.reduce((n,w)=>n+w.pinnedFiles.length,0),hostOnly:true,certifiedParity:false});
}
export function mergeReadiness(report){
 if(!report||!Array.isArray(report.results)||report.results.length!==6)fail('missing executed host-wave suite results');
 const ids=new Set(),missing=[],bad=[];
 for(const r of report.results){
  if(!Number.isInteger(r.wave)||r.wave<1||r.wave>6||ids.has(r.wave))fail('duplicate/invalid result wave');
  ids.add(r.wave);
  if(r.head!==HEADS[r.wave-1])bad.push({wave:r.wave,reason:'source-head-mismatch'});
  if(r.status!=='PASSED')bad.push({wave:r.wave,reason:'host-suite-not-passed'});
  else {
   const c=r.testCounts,fixture=r.sourceValidation;
   if(r.hostSuiteRan!==true||r.guestCompilerRan!==false||!c||!Number.isSafeInteger(c.tests)||c.tests<1||c.pass!==c.tests||c.fail!==0||c.skipped!==0||c.cancelled!==0||c.todo!==0||
      !fixture||fixture.status!=='SOURCE_FIXTURES_VALIDATED_HOST_ONLY'||fixture.wave!==r.wave||fixture.compilerExecuted!==false||fixture.parityVerified!==false)
     bad.push({wave:r.wave,reason:'no-executed-test-and-source-validator-evidence'});
  }
 }
 for(let i=1;i<=6;i++)if(!ids.has(i))missing.push(i);
 return Object.freeze({
  hostReadiness:missing.length||bad.length?'BLOCKED':'HOST_SUITES_PASSED_NEEDS_INDEPENDENT_CI',
  missingWaves:missing,failedWaves:bad,backendCompilerParity:'UNVERIFIED',securityReview:'REQUIRED',
  mergeApproved:false,releaseCertified:false,
  nextRequirements:['independent job-step evidence','production compiler guest execution','backend ownership/actor parity','approved runner/source provenance','review each source PR before merge']
 });
}
