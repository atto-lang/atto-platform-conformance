import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export const CORE=Object.freeze(['java','llvm','wasm','forge','net']);
export const EXTRA=Object.freeze(['js','rs','cranelift','hdl']);
export const ALL=Object.freeze([...CORE,...EXTRA]);
export const REQUIRED_GATES=Object.freeze(["source-head-sha-and-selected-blob-verification","real-compiler-parse-type-ownership","generated-guest-execution-exit-42","reject-nonzero-and-no-usable-artifact","actor-state-capability-isolation","full-source-build-and-compiled-aot-where-applicable","independent-security-review"]);
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)&&x!=='0'.repeat(40);
export function validateToolchainParityV2(input,root){
  const errors=[];
  if(!isObj(input))return ['parity manifest must be an object'];
  const expectedKeys=['schema','status','fullExecutableParityCertified','canonicalManifest',
    'canonicalSourceCases','coreBackends','extendedBackends','sourceRepositories',
    'promotionGates','fullCorpusEvidence','selectedReceipts','knownDivergences'];
  if(!eq(Object.keys(input).sort(),expectedKeys.sort()))errors.push('top-level shape changed');
  if(input.schema!=='attolang.source-toolchain-parity/2'
      ||input.status!=='INCOMPLETE_SELECTED_PROOFS'
      ||input.fullExecutableParityCertified!==false)errors.push('fabricated full parity');
  if(input.canonicalManifest!=='contracts/atto-canonical-syntax-v1.json'
      ||input.canonicalSourceCases!==26)errors.push('canonical suite identity changed');
  if(!eq(input.coreBackends,CORE)||!eq(input.extendedBackends,EXTRA))
    errors.push('backend coverage drift');
  if(!eq(input.promotionGates,REQUIRED_GATES))errors.push('promotion gates deleted or reordered');
  if(!Array.isArray(input.sourceRepositories)||input.sourceRepositories.length!==ALL.length)
    errors.push('backend list missing or repeated');
  else for(let i=0;i<ALL.length;i++){
    const r=input.sourceRepositories[i],id=ALL[i];
    if(!isObj(r)||!eq(Object.keys(r).sort(),['id','tier','repo','target'].sort())
        ||r.id!==id||r.repo!=='ores-truffle-oreslang/oreslang-source.'+id
        ||r.tier!==(i<CORE.length?'core':'additional')
        ||typeof r.target!=='string'||!r.target)
      errors.push('backend identity/role mismatch: '+id);
  }
  if(!isObj(input.fullCorpusEvidence)||!eq(Object.keys(input.fullCorpusEvidence).sort(),ALL.slice().sort())
      ||ALL.some(id=>input.fullCorpusEvidence[id]!=='NOT_CERTIFIED'))
    errors.push('full corpus incorrectly certified');
  const receiptIds=['java','llvm','forge','net','js','rs'];
  const receiptClass={java:'compiled-guest-subset',llvm:'compiled-guest-subset',
    forge:'compile-reject-safety-subset',net:'compile-reject-safety-subset',
    js:'compiled-guest-subset',rs:'compile-reject-safety-subset'};
  if(!Array.isArray(input.selectedReceipts)
      ||!eq(input.selectedReceipts.map(r=>r?.backend),receiptIds))
    errors.push('selected proof set drift');
  else for(const receipt of input.selectedReceipts){
    const expected=['backend','scope','sourceSha','sourcePr','carrierSha',
      'carrierRun','carrierJob','sourceBlobs','selectedTests','guestKind','scopeIsFullRepo','evidenceClass'];
    if(!eq(Object.keys(receipt).sort(),expected.sort())||!sha(receipt.sourceSha)
        ||!sha(receipt.carrierSha)||receipt.scopeIsFullRepo!==false
        ||receipt.evidenceClass!==receiptClass[receipt.backend]
        ||!Number.isSafeInteger(receipt.sourcePr)||receipt.sourcePr<1
        ||!Number.isSafeInteger(receipt.carrierRun)||receipt.carrierRun<1
        ||!Number.isSafeInteger(receipt.carrierJob)||receipt.carrierJob<1
        ||!Number.isSafeInteger(receipt.sourceBlobs)||receipt.sourceBlobs<1
        ||!Number.isSafeInteger(receipt.selectedTests)||receipt.selectedTests<1
        ||typeof receipt.scope!=='string'||!receipt.scope
        ||typeof receipt.guestKind!=='string'||!receipt.guestKind)
      errors.push('invalid proof metadata for '+receipt.backend);
  }
  if(!Array.isArray(input.knownDivergences)||input.knownDivergences.length<4
      ||input.knownDivergences.some(d=>!isObj(d)||!d.feature||!d.target||!d.message))
    errors.push('unresolved divergences not recorded');
  if(root){
    try{
      const baseline=JSON.parse(readFileSync(resolve(root,input.canonicalManifest),'utf8'));
      if(baseline.cases?.length!==26||baseline.counts?.accept!==12
          ||baseline.counts?.reject!==14||baseline.cases.find(c=>c.id==='legacy-on-default')?.expect!=='reject')
        errors.push('canonical case manifest diverges from shared contract');
    }catch(e){errors.push('cannot verify canonical fixture contract: '+e.message);}
  }
  return errors;
}
