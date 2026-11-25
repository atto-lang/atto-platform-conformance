// NON-PROMOTING typed-SSA/use-edge and field-store candidate reconciliation.
// It compares caller-supplied inventories but NEVER proves that typed MIR,
// LLVM IR or the guest compiler actually emitted/observed these operations.
import { inspectCandidateClosedWorldLoanUses } from './ownership-nll-closed-world-v1.mjs';

const id = x => Number.isSafeInteger(x) && x > 0;
const path = x => typeof x === 'string' && x.length <= 128 &&
  /^(?:[A-Za-z_][A-Za-z_0-9]{0,31})(?:\.[A-Za-z_][A-Za-z_0-9]{0,31}){0,3}$/.test(x) &&
  !x.split('.').some(p => ['constructor','prototype','__proto__'].includes(p));
const plain = x => x !== null && typeof x === 'object' &&
  !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const shape = (x, fields) => plain(x) &&
  Object.keys(x).sort().join(',') === fields.slice().sort().join(',');
const fail = code => ({
  ok:false, verified:false, candidateResolved:false,
  guestExecutionVerified:false, emittedStoreVerified:false,
  status:'UNPROVEN_SSA_AND_FIELD_WRITE_COVERAGE',errors:[code]
});

const UNSAFE_EFFECTS = new Set([
  'call-arg','closure-capture','exception-unwind','cancellation-cleanup',
  'suspend-frame','actor-send','return-borrow','phi','branch'
]);
const BORROWS = new Set(['borrow-shared','borrow-exclusive']);
const USES = new Set(['use-shared','use-exclusive']);

// Source operations and indexedUses MUST eventually come from one authenticated
// typed SSA function. The model cannot establish that fact; it only rejects
// inconsistent shape and obvious omissions in supplied inventories.
export function inspectCandidateSsaOwnershipCoverage({
  operations, indexedUses, sourceReinitializations=[],
  mirWrites=[], llvmStores=[], successors=[]
} = {}) {
  if (!Array.isArray(operations) || !Array.isArray(indexedUses) ||
      !Array.isArray(sourceReinitializations) || !Array.isArray(mirWrites) ||
      !Array.isArray(llvmStores) || !Array.isArray(successors) ||
      successors.length || operations.length > 4096 ||
      indexedUses.length > 4096 || sourceReinitializations.length > 256 ||
      mirWrites.length > 256 || llvmStores.length > 256)
    return fail('UNBOUNDED_OR_NON_STRAIGHT_LINE_SSA');

  const origin = new Set(), actual = new Map(), loanTokens = new Set();
  for (let site=0;site<operations.length;site++) {
    const op=operations[site];
    if(!shape(op,['kind','place','token']) || !path(op.place))
      return fail('MALFORMED_SOURCE_OPERATION');
    if(UNSAFE_EFFECTS.has(op.kind))
      return fail('UNMODELED_EFFECT_EDGE:'+op.kind);
    if(BORROWS.has(op.kind)) {
      if(!id(op.token) || loanTokens.has(op.token))
        return fail('DUPLICATE_OR_UNMINTED_BORROW_TOKEN');
      loanTokens.add(op.token);
      origin.add(op.token);
    } else if(USES.has(op.kind)) {
      if(!id(op.token)) return fail('INVALID_USE_TOKEN');
      actual.set(site,op);
    } else if(op.kind!=='move' && op.kind!=='suspend' &&
             op.kind!=='read' && op.kind!=='read-object' &&
             op.kind!=='call' && op.kind!=='await' && op.kind!=='send')
      return fail('UNKNOWN_SOURCE_EFFECT');
  }
  const seen=new Set();
  for(const use of indexedUses) {
    if(!shape(use,['site','kind','place','token']) ||
       !Number.isSafeInteger(use.site) || use.site<0 ||
       !USES.has(use.kind) || !id(use.token) || !path(use.place))
      return fail('MALFORMED_SSA_USE_INDEX');
    if(seen.has(use.site)) return fail('DUPLICATE_SSA_USE_SITE');
    seen.add(use.site);
    const op=actual.get(use.site);
    if(!op || op.kind!==use.kind || op.token!==use.token ||
       op.place!==use.place || !origin.has(use.token))
      return fail('SSA_INDEX_DOES_NOT_MATCH_SOURCE_USE');
  }
  if(seen.size!==actual.size)
    return fail('MISSING_SSA_USE_DEF_EDGE');

  // Reuse the independently implemented stage-zero lexer/CFG admission
  // fences. A locally consistent index is not evidence that all uses exist.
  const lower=inspectCandidateClosedWorldLoanUses({operations,successors});
  if(lower.candidateResolved!==true || lower.ok!==false || lower.verified!==false)
    return fail('SOURCE_LOAN_STREAM_UNPROVEN:'+String(lower.errors?.[0] ?? 'unknown'));

  const writeMaps=[];
  for(const entries of [sourceReinitializations,mirWrites,llvmStores]) {
    const records=new Map();
    for(const rec of entries) {
      if(!shape(rec,['writeId','place','site']) ||
         !id(rec.writeId) || !id(rec.site) || !path(rec.place) ||
         loanTokens.has(rec.writeId))
        return fail('INVALID_OR_COLLIDING_WRITE_PROVENANCE');
      if(records.has(rec.writeId))
        return fail('DUPLICATE_WRITE_ID_IN_EVIDENCE');
      records.set(rec.writeId,rec);
    }
    writeMaps.push(records);
  }
  const [sourceWrites,typedWrites,emittedWrites]=writeMaps;
  if(sourceWrites.size!==typedWrites.size || sourceWrites.size!==emittedWrites.size)
    return fail('MISSING_SOURCE_MIR_OR_LLVM_STORE');
  for(const [writeId,source] of sourceWrites) {
    const mir=typedWrites.get(writeId), llvm=emittedWrites.get(writeId);
    if(!mir || !llvm || mir.place!==source.place || llvm.place!==source.place)
      return fail('SOURCE_MIR_LLVM_WRITE_MISMATCH');
  }
  // Never assert that synthetic LLVM store records correspond to executable
  // IR. A real compiler must read-back final IR, prove store dominance and
  // alias-free field identity, and bind it to a checked guest execution.
  return {
    ok:false, verified:false, candidateResolved:true,
    guestExecutionVerified:false, emittedStoreVerified:false,
    status:'SSA_EFFECT_AND_STORE_INVENTORY_UNAUTHENTICATED',
    indexedUseCount:seen.size, matchedWriteCount:sourceWrites.size,
    errors:[]
  };
}
