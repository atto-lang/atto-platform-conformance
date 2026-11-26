import {readFileSync} from 'node:fs';
function validate(r, rows, backends, cases) {
  const req=(b,m)=>{if(!b)throw Error(m)};
  req(r.schema==="atto.pointer-methods.v2.target"&&r.status==="TARGET_ONLY_NOT_EXECUTED","target only");
  req(r.operations.length===rows.length,"operation count");
  for(const [name,authority,result] of rows){const found=r.operations.filter(x=>x.name===name);req(found.length===1&&found[0].authority===authority&&found[0].result===result,"operation effect "+name);}
  req(r.cases.length===cases.length,"case count");
  for(let i=0;i<cases.length;i++){const id="PM-"+String(i+1).padStart(3,"0");const found=r.cases.filter(x=>x.id===id);req(found.length===1&&found[0].description===cases[i],"case "+id);const statuses=found[0].backend_status;req(Object.keys(statuses).sort().join()===backends.slice().sort().join(),"backend inventory "+id);for(const b of backends)req(statuses[b]==="NOT_EXECUTED","unverified backend "+b);}
}
function runTests(r, rows, backends, cases) {
  validate(r,rows,backends,cases);
  const mutations=[
    x=>x.status="PASS",x=>x.operations.pop(),x=>x.operations[0].name="read",x=>x.operations.find(o=>o.name==="close").authority="read",x=>x.operations.find(o=>o.name==="take_at").result="copy",x=>x.operations.find(o=>o.name==="borrow_mut_at").authority="read",x=>x.operations.find(o=>o.name==="slice").result="own",x=>x.operations.find(o=>o.name==="read_at").result="move",x=>x.cases.pop(),x=>x.cases[1].id=x.cases[0].id,x=>delete x.cases[0].backend_status[backends[0]],x=>x.cases[0].backend_status["unknown"]="NOT_EXECUTED",x=>x.cases[0].backend_status[backends[0]]="PASS",x=>x.cases[0].backend_status[backends[0]]="UNSUPPORTED",x=>x.cases[0].description=""];
  for(const [i,mutate] of mutations.entries()){const copy=JSON.parse(JSON.stringify(r));mutate(copy);let rejected=false;try{validate(copy,rows,backends,cases)}catch{rejected=true}if(!rejected)throw Error("mutation accepted "+i);}
  return 1+mutations.length;
}
const rows=[["alloc","none","own"],["alloc_value","none","own"],["len","read","value"],["size_bytes","read","value"],["is_empty","read","value"],["read","read","copy"],["write","write","void"],["read_at","read","copy"],["write_at","write","void"],["replace_at","own","move"],["borrow_at","read","loan_read"],["borrow_mut_at","write","loan_write"],["take_at","own","move"],["slice","read","view_read"],["slice_mut","write","view_write"],["fill","write","void"],["copy_from","write","void"],["swap_at","write","void"],["same_location","read","value"],["close","own","consume"]];
const backends=["atto-source.atto","atto-source.cranelift","atto-source.forge","atto-source.hdl","atto-source.java","atto-source.js","atto-source.llvm","atto-source.net","atto-source.realtime","atto-source.rs","atto-source.wasm"];
const cases=["singleton lifecycle","indexed initialized storage and metadata","copy swap replace","noncopy move and reinitialize","readonly nested views","exclusive view and disjoint ranges","scalar mutable loan","nested pointer loan","checked identity","all-path cleanup","unary reject and binary preserve","authority and alias rejection","lifetime and domain rejection","noncopy and initialization rejection","dynamic checked failures","copy overlap and failure preservation","partial-init cleanup","target-specific FFI atomic device admission","no implicit capability duplication","native and Wasm compiled evidence"];
const r=JSON.parse(readFileSync(new URL('../contracts/pointer-methods-v2.json',import.meta.url),'utf8'));
console.log('Pointer v2 target registry checks: '+runTests(r,rows,backends,cases)+' passed; no guest certification');
