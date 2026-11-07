// Advisory source-only closed-world loan-use stream contract.
// This is NOT typed SSA: raw JSON can omit uses, and its token IDs are not
// compiler-authenticated. This API NEVER returns an authorization or an
// executed compiler receipt.
const IDENT = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
const RESERVED = new Set(['prototype','constructor','__proto__']);
const identifier = value => typeof value === 'string' &&
    IDENT.test(value) && !RESERVED.has(value);
const token = value => Number.isSafeInteger(value) && value > 0;
function fail(code) {
  return {ok:false,verified:false,candidateResolved:false,
    status:'CLOSED_WORLD_LOAN_USE_UNPROVEN',errors:[code]};
}
export function inspectCandidateClosedWorldLoanUses({operations,successors=[]}={}) {
  if (!Array.isArray(operations) || operations.length > 4096 ||
      !Array.isArray(successors) || successors.length)
    return fail('NOT_A_STRAIGHT_LINE_COMPILER_STREAM');
  const loans = new Map(), releases = new Set();
  let observedBorrow = false;
  const pendingChecks = [];
  for(let i=0;i<operations.length;i++) {
    const op=operations[i];
    if (!op || typeof op !== 'object' || Array.isArray(op) ||
        Object.keys(op).sort().join(',') !== 'kind,place,token' ||
        !identifier(op.place))
      return fail('UNRECOGNIZED_SOURCE_OPERATION');
    if (op.kind==='borrow-shared' || op.kind==='borrow-exclusive') {
      observedBorrow=true;
      if(!token(op.token) || loans.has(op.token))
        return fail('DUPLICATED_OR_UNMINTED_LOAN_TOKEN');
      loans.set(op.token,{place:op.place,borrow:i,
        kind:op.kind,lastUse:-1});
    } else if (op.kind==='use-shared' || op.kind==='use-exclusive') {
      if(!token(op.token) || !loans.has(op.token))
        return fail('FOREIGN_LOAN_USE_TOKEN');
      const loan=loans.get(op.token);
      if(loan.place!==op.place || i<=loan.borrow ||
         (loan.kind==='borrow-shared') !== (op.kind==='use-shared'))
        return fail('MISMATCHED_LOAN_USE');
      loan.lastUse=i;
    } else if(op.kind==='release-shared' || op.kind==='release-exclusive') {
      if (!token(op.token)) return fail('UNMINTED_RELEASE_TOKEN');
      releases.add(op.token);
    } else if(op.kind==='read' || op.kind==='read-object' ||
              op.kind==='call' || op.kind==='await' ||
              op.kind==='send') {
      if(observedBorrow)
        return fail('UNCLASSIFIED_POST_BORROW_EFFECT');
      return fail('UNCLASSIFIED_SOURCE_EFFECT');
    } else if(op.kind==='move' || op.kind==='suspend') {
      if(op.token!==null) return fail('EFFECT_IMPERSONATES_LOAN_ID');
      pendingChecks.push({kind:op.kind,index:i,place:op.place});
    } else {
      return fail('UNRECOGNIZED_SOURCE_OPERATION');
    }
  }
  if (releases.size) return fail('MIXED_EXPLICIT_AND_DERIVED_RELEASES');
  if (![...loans.values()].every(x=>x.lastUse>x.borrow))
    return fail('BORROW_WITHOUT_COMPLETE_USE');
  for(const effect of pendingChecks) {
    for(const loan of loans.values()) {
      // Task suspension is globally sensitive to outstanding loan use:
      // it cannot be treated as an ordinary same-place mutation.
      if(effect.kind==='suspend' &&
         effect.index>loan.borrow && effect.index<=loan.lastUse)
        return fail('SUSPENSION_WITH_UNFINISHED_LOAN_USE');
      if(loan.place===effect.place && effect.index<=loan.lastUse &&
         effect.index>loan.borrow)
        return fail('EFFECT_BEFORE_FINAL_LOAN_USE');
    }
  }
  const lastUses=[...loans.entries()].map(([loanId,x])=>({
    loanId,place:x.place,finalUseSite:x.lastUse
  })).sort((a,b)=>a.loanId-b.loanId);
  return {ok:false,verified:false,candidateResolved:true,
    status:'TOKEN_STREAM_CANDIDATE_NOT_SSA_PROVEN',lastUses,
    errors:[]};
}
