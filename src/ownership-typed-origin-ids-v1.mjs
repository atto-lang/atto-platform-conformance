// Cross-backend typed-MIR identifier *shape* contract, NOT provenance proof.
// Numeric BindingId denotes one current compiler-frame declaration. OriginId 0
// denotes unknown allocation provenance. Neither different numeric IDs nor
// claimed OriginIds establish independently verified heap-root separation.
const IDENT = /^[A-Za-z_][A-Za-z_0-9]{0,63}$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const MODES = new Set(['owned','shared-loan','exclusive-loan']);
function identifier(x) { return typeof x==='string' && IDENT.test(x) && !FORBIDDEN.has(x); }
function plain(x) { return x!==null && typeof x==='object' && !Array.isArray(x); }
function validId(x,zero=false) {
  return Number.isSafeInteger(x) && (zero ? x>=0 : x>0);
}
function invalid(reason) {
  return {ok:false,verified:false,candidateValid:false,
    independentStorageVerified:false,status:'INVALID_UNATTESTED_ORIGIN_IDS',
    errors:[reason]};
}
export function inspectTypedPlaceIdentity(input) {
  try {
    if(!plain(input) ||
       Object.keys(input).sort().join(',')!=='bindingId,fields,mode,originId,root')
      throw Error('INVALID_PLACE_ID_SCHEMA');
    if(!validId(input.bindingId)) throw Error('UNMINTED_BINDING_ID');
    if(!validId(input.originId,true)) throw Error('INVALID_ORIGIN_ID');
    if(!identifier(input.root) || !MODES.has(input.mode)) throw Error('INVALID_BINDING_MODE_OR_ROOT');
    if(!Array.isArray(input.fields) || input.fields.length>8 ||
       !input.fields.every(identifier)) throw Error('INVALID_FIELD_PATH');
    return {
      ok:false,verified:false,candidateValid:true,independentStorageVerified:false,
      status:'CANDIDATE_TYPED_PLACE_UNATTESTED',
      bindingId:input.bindingId,originId:input.originId,mode:input.mode,
      root:input.root,fields:[...input.fields],errors:[]
    };
  } catch(e){return invalid(e instanceof Error?e.message:'INVALID_ORIGIN_RECORD')}
}
export function inspectTypedPlacePair(first,second) {
  const a=inspectTypedPlaceIdentity(first);
  const b=inspectTypedPlaceIdentity(second);
  if(!a.candidateValid || !b.candidateValid)
    return invalid('PAIR_HAS_INVALID_ORIGIN');
  return {
    ok:false,verified:false,candidateValid:true,independentStorageVerified:false,
    // Not even distinct positive origin IDs may be treated as a certificate
    // without source compiler lowering + an independently authenticated proof.
    candidateMayAlias:true,status:'TYPED_PLACE_PAIR_UNATTESTED',errors:[]
  };
}
