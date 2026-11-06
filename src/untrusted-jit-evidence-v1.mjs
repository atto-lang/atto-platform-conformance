// Source-free shape checks ONLY; this module does not authenticate CI, OS boundaries,
// image signatures, engine binary provenance or source compiler guest execution.
const sha40=/^[0-9a-f]{40}$/,sha256=/^[0-9a-f]{64}$/;
const backends=['java','llvm','wasm','net','forge'];
const executionClasses={ATTO_SOURCE:'REAL_ATTOLANG_GUEST_EXECUTED',
 WASM_BINARY:'BACKEND_ADVERSARIAL_BINARY_EXECUTED'};
const demand=(ok,code)=>{if(!ok)throw new Error(code);};
function exact(object,keys,code){
 demand(object!==null && typeof object==='object' && !Array.isArray(object) &&
 Object.getPrototypeOf(object)===Object.prototype &&
 Object.keys(object).length===keys.length &&
 Object.keys(object).every(key=>keys.includes(key)),code);
}
export function validateJitMatrix(matrix){
 exact(matrix,['schema','revisionDate','status','backendStatus','cases','sources'],'INVALID_MATRIX_FIELDS');
 demand(matrix.schema==='attolang.untrusted-jit-adversarial.v1' &&
 matrix.status==='CANDIDATE_NOT_EXECUTED','FALSE_MATRIX_STATUS');
 exact(matrix.backendStatus,backends,'INVALID_BACKENDS');
 demand(Object.values(matrix.backendStatus).every(x=>x==='NOT_EXECUTED'),'FALSE_BACKEND_PASS');
 demand(Array.isArray(matrix.cases) && matrix.cases.length===16,'INVALID_CASE_COUNT');
 let ids=new Set(),categories=new Set();
 for(const c of matrix.cases){
  exact(c,['id','category','backends','arch','sourceKind','attack','oracle','neighborMustSurvive','status'],'INVALID_CASE');
  demand(/^UJI-\d\d$/.test(c.id) && !ids.has(c.id),'INVALID_CASE_ID');
  ids.add(c.id);categories.add(c.category);
  demand(c.status==='NOT_EXECUTED','FALSE_CASE_PASS');
  demand(Array.isArray(c.backends) && c.backends.length>0 &&
   new Set(c.backends).size===c.backends.length &&
   c.backends.every(x=>backends.includes(x)),'INVALID_CASE_BACKENDS');
  demand(c.arch==='any'||c.arch==='aarch64','INVALID_CASE_ARCH');
  demand(Object.hasOwn(executionClasses,c.sourceKind),'INVALID_SOURCE_KIND');
  demand(typeof c.attack==='string' && c.attack.length>15 &&
   typeof c.oracle==='string' && c.oracle.length>15,'MISSING_TEST_ORACLE');
  demand(typeof c.neighborMustSurvive==='boolean','MISSING_NEIGHBOR_ORACLE');
 }
 demand([...Array(16)].every((_,i)=>ids.has('UJI-'+String(i+1).padStart(2,'0'))),'MISSING_CASE');
 demand(['isolation','quota','interruption','cancellation','evidence'].every(x=>categories.has(x)),'MISSING_CATEGORY');
 demand(Array.isArray(matrix.sources)&&matrix.sources.length>=8 &&
 matrix.sources.every(x=>typeof x==='string'&&x.startsWith('https://')),'MISSING_SOURCES');
 return true;
}
export function inspectJitReceipt(matrix,receipt,head,tree){
 validateJitMatrix(matrix);
 exact(receipt,['caseId','backend','arch','sourceKind','executionClass','headSha',
 'treeSha','imageSha256','engine','engineVersion','runnerId','jobId',
 'steps','outcome','neighborOutcome'],'INVALID_RECEIPT_FIELDS');
 const c=matrix.cases.find(x=>x.id===receipt.caseId);
 demand(Boolean(c),'UNKNOWN_CASE');
 demand(c.backends.includes(receipt.backend),'WRONG_BACKEND');
 demand(['x86_64','aarch64','arm64-macos'].includes(receipt.arch) &&
  (c.arch==='any'||c.arch===receipt.arch),'WRONG_ARCH');
 demand(c.sourceKind===receipt.sourceKind &&
  receipt.executionClass===executionClasses[c.sourceKind],'SOURCE_BINARY_PROVENANCE_CONFLATED');
 demand(sha40.test(head)&&sha40.test(tree)&&receipt.headSha===head &&
  receipt.treeSha===tree,'UNPINNED_SOURCE_HEAD_OR_TREE');
 demand(sha256.test(receipt.imageSha256),'UNPINNED_IMAGE');
 demand(typeof receipt.engine==='string'&&receipt.engine.length>0 &&
  typeof receipt.engineVersion==='string'&&receipt.engineVersion.length>0,'MISSING_ENGINE_VERSION');
 demand(Number.isSafeInteger(receipt.runnerId)&&receipt.runnerId>0 &&
  Number.isSafeInteger(receipt.jobId)&&receipt.jobId>0 &&
  Array.isArray(receipt.steps)&&receipt.steps.length>0,'ZERO_STEP_OR_UNADMITTED_RUN');
 for(const step of receipt.steps){
  exact(step,['name','conclusion'],'INVALID_JOB_STEP');
  demand(typeof step.name==='string'&&step.name.length>0 &&
   step.conclusion==='success','FAILED_OR_EMPTY_STEP');
 }
 demand(receipt.outcome==='PASS','UNPROVEN_TEST_ORACLE');
 demand(!c.neighborMustSurvive||receipt.neighborOutcome==='SURVIVED','UNPROVEN_NEIGHBOR');
 return Object.freeze({status:'STRUCTURAL_ONLY_UNAUTHENTICATED',
   certified:false,realGuestParityProven:false,independentReviewRequired:true,
   caseId:c.id,backend:receipt.backend});
}
