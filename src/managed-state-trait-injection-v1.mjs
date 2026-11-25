// Source-free oracle only, NOT an Oreslang compiler or executed native guest.
export function decide(x){
  if(!x||typeof x!=="object"||Array.isArray(x))return "INVALID";
  if(!["class","singleton"].includes(x.kind))return "UNSUPPORTED_OWNER_KIND";
  if(Object.keys(x).some(k=>!["kind","required_type","bindings","access"].includes(k)))return "UNKNOWN_FIELD";
  if(typeof x.required_type!=="string"||!x.required_type.trim())return "MISSING_CONTRACT";
  if(!Array.isArray(x.bindings))return "INVALID_BINDING";
  if(x.bindings.length===0)return "REQUIRED_STATE_MISSING";
  if(x.bindings.length!==1)return "DUPLICATE_STATE_BINDING";
  const b=x.bindings[0];
  if(!b||typeof b!=="object"||Array.isArray(b))return "INVALID_BINDING";
  const bindingKeys=b.origin==="state_block"?["origin","type","initialized"]:["origin","type","issuer","scope","initialized"];
  if(Object.keys(b).some(k=>!bindingKeys.includes(k)))return "UNKNOWN_FIELD";
  if(!["state_block","injected"].includes(b.origin))return "RAW_STORAGE_FORBIDDEN";
  if(b.type!==x.required_type)return "STATE_TYPE_MISMATCH";
  if(b.origin==="state_block"&&b.initialized!==true)return "UNINITIALIZED_STATE";
  if(b.origin==="injected"){
    if(b.issuer!=="compiler")return "UNTRUSTED_INJECTION";
    if(b.scope!==(x.kind==="singleton"?"application_domain":"instance"))return "INJECTION_SCOPE";
    if(b.initialized!==true)return "UNRESOLVED_PROVIDER";
  }
  const a=x.access??{};
  if(!a||typeof a!=="object"||Array.isArray(a))return "INVALID_ACCESS";
  if(Object.keys(a).some(k=>!["mode","guard","mutates","escapes","heap_escape","suspends","cross_domain","stale_generation","reentrant","direct_access","forged_control"].includes(k)))return "UNKNOWN_FIELD";
  for(const key of ["mutates","escapes","heap_escape","suspends","cross_domain","stale_generation","reentrant","direct_access","forged_control"]){
    if(Object.hasOwn(a,key)&&typeof a[key]!=="boolean")return "INVALID_ACCESS";
  }
  if(a.forged_control)return "CONTROL_FORGERY";
  if(a.direct_access)return "DIRECT_STATE_ACCESS";
  if(a.escapes||a.heap_escape)return "STATE_LOAN_ESCAPE";
  if(a.suspends)return "STATE_LOAN_SUSPEND";
  if(a.cross_domain)return "CROSS_DOMAIN_RAW_TRANSFER";
  if(a.stale_generation)return "STALE_GENERATION";
  if(a.reentrant)return "REENTRANT_GUARD";
  const mode=a.mode??"read";
  if(!["read","write"].includes(mode))return "INVALID_LOAN_MODE";
  if(a.guard!==(mode==="read"?"critical-read":"critical-write"))return "GUARD_REQUIRED";
  if(mode==="read"&&a.mutates)return "READ_ONLY_MUTATION";
  return "OK";
}
