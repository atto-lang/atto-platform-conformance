// Stage-zero, source-only candidate for bounded typed-MIR loan last-use.
// This module NEVER authenticates a compiler's def-use proof, and NEVER
// returns ok=true/verified=true. A candidate last use is not merge authority.
const id = v => Number.isSafeInteger(v) && v > 0;
const slot = v => typeof v === 'string' &&
  /^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/.test(v) &&
  !['constructor','prototype','__proto__'].includes(v);
function bad(reason) {
  return {ok:false,verified:false,candidateValid:false,
    status:'UNPROVEN_LOAN_LAST_USE',errors:[reason]};
}
export function inspectCandidateLastUse({operations,proofs,successors=[]}={}) {
  if (!Array.isArray(operations) || operations.length > 4096 ||
      !Array.isArray(proofs) || proofs.length > 4096 ||
      !Array.isArray(successors) || successors.length !== 0)
    return bad('NOT_A_PROVEN_STRAIGHT_LINE_CFG');
  const issued=new Map(), used=new Map(), released=new Set();
  for (let i=0;i<operations.length;i++) {
    const op=operations[i];
    if (!op || typeof op !== 'object' || Array.isArray(op) ||
        !slot(op.place) || !id(op.token))
      return bad('INVALID_LEXICAL_LOAN_OPERATION');
    if (op.kind==='borrow-shared' || op.kind==='borrow-exclusive') {
      if (issued.has(op.token)) return bad('DUPLICATE_LOAN_TOKEN');
      issued.set(op.token,{site:i,place:op.place,kind:op.kind});
    } else if(op.kind==='use-shared' || op.kind==='use-exclusive') {
      const origin=issued.get(op.token);
      if(!origin || origin.place!==op.place ||
         (op.kind==='use-shared')!==(origin.kind==='borrow-shared'))
        return bad('FOREIGN_OR_WRONG_LOAN_USE');
      const prev=used.get(op.token)||[];prev.push(i);used.set(op.token,prev);
    } else if(op.kind==='release-shared' || op.kind==='release-exclusive') {
      released.add(op.token);
    } else return bad('UNSUPPORTED_OP_IN_LAST_USE_PROOF');
  }
  if(issued.size!==proofs.length || released.size)
    return bad('INCOMPLETE_OR_MIXED_LOAN_PROOF');
  const seen=new Set();
  for(const p of proofs) {
    if(!p || typeof p!=='object' || Array.isArray(p) ||
       !id(p.token) || !Number.isSafeInteger(p.finalUse) ||
       seen.has(p.token))
      return bad('INVALID_OR_DUPLICATE_LAST_USE_CERTIFICATE');
    seen.add(p.token);
    const origin=issued.get(p.token), uses=used.get(p.token)||[];
    if(!origin || !uses.length ||
       p.finalUse!==uses[uses.length-1] ||
       p.finalUse<=origin.site) return bad('INCORRECT_LAST_USE_SITE');
  }
  return {ok:false,verified:false,candidateValid:true,
    status:'COMPILER_LAST_USE_DEF_USE_PROOF_MISSING',errors:[]};
}
export function inspectCandidateFieldReinitialize(
  {before,hasActiveLoan=false,sourceWriteProven=false}={}
) {
  if (before !== 'moved' && before !== 'owned' &&
      before !== 'maybe-moved' && before !== 'dropped')
    return bad('UNKNOWN_MOVE_STATE');
  if (before!=='moved' || hasActiveLoan!==false ||
      sourceWriteProven!==true)
    return bad('UNPROVEN_FIELD_REINITIALIZATION');
  return {ok:false,verified:false,candidateValid:true,
    status:'FIELD_WRITE_EVIDENCE_UNATTESTED',errors:[]};
}
