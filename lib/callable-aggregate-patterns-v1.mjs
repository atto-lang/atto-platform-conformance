// Source-only contract validation; candidate results are not independently attested guest evidence.
export function validateManifest(m) {
  const require=(ok,why)=>{if(!ok)throw Error(why);};
  const backends=["java","llvm","net","forge","wasm","rs","cranelift","js","hdl"];
  require(m.schema==="atto.callable-aggregate-patterns/v1","schema");
  require(JSON.stringify(m.backends)===JSON.stringify(backends),"backend coverage");
  require(Object.keys(m.status).length===backends.length&&backends.every(k=>m.status[k]==="not_executed"),"no fabricated baseline evidence");
  require(Array.isArray(m.cases)&&m.cases.length>=35,"case inventory");
  const ids=new Set(), groups=new Set();
  for(const c of m.cases){
    require(typeof c.id==="string"&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id)&&!ids.has(c.id),"invalid/duplicate case id");
    ids.add(c.id);groups.add(c.group);
    require(typeof c.source==="string"&&c.source.endsWith("\n")&&c.source.trim().length>0,"source fixture");
    require(typeof c.reason==="string"&&c.reason.length>0,"reason");
    require(c.expect==="accept"||c.expect==="reject","expectation");
    if(c.expect==="accept")require(typeof c.stdout==="string"&&!Object.hasOwn(c,"diagnostic_family"),"positive stdout oracle");
    else {
      require(!Object.hasOwn(c,"stdout")&&typeof c.diagnostic_family==="string","negative diagnostic oracle");
      require(c.diagnostic_family.split("|").every(x=>/^[a-z]+$/.test(x)&&x!=="unsupported"),"semantic diagnostic only");
    }
  }
  require(["tuple","record","struct","class","recursive","alias","shape","binding","arity","visibility"].every(x=>groups.has(x)),"semantic groups");
  require(m.cases.filter(c=>c.expect==="accept").length>=18&&m.cases.filter(c=>c.expect==="reject").length>=17,"positive/negative floor");
  return {cases:ids.size,backends:backends.length};
}

export function classifyCase(c,r) {
  if(!r||r.executed!==true)return "not_executed";
  if(r.signal||!Number.isInteger(r.status)||r.status<0||r.status>255)return "inconclusive";
  // Missing or non-string streams are incomplete evidence, not an empty stream.
  if(typeof r.stdout!=="string"||typeof r.stderr!=="string")return "inconclusive";
  if(r.unsupported===true||/\b(?:E_UNSUPPORTED|unsupported|not (?:yet )?implemented)\b/i.test(r.stderr||""))return "unsupported";
  if(c.expect==="accept")return r.status===0&&r.stdout===c.stdout&&r.stderr===""?"candidate_pass":"failed";
  // Rejected source must not yield partial guest output or an emitted program.
  if(r.status===0||r.stdout!=="")return "failed";
  return new RegExp(c.diagnostic_family,"i").test(r.stderr||"")?"candidate_pass":"failed";
}
