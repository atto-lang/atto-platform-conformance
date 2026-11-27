// Source-free executable semantic model; not an Atto compiler, durable store, or guest execution receipt.
// Run: node --test tests/actor-retry-undo-v1-model.test.mjs
function run_actor_retry_undo_model() {
  const assert=(condition,message)=>{if(!condition)throw new Error(message)};
  let count=0;
  const test=(name,body)=>{body();count++;};
  const retry=({attempt,max,now,deadline,delay,error,cancelled=false})=>{
    if(cancelled)return {kind:"cancelled"};
    if(now>=deadline)return {kind:"deadline"};
    if(error!=="transient")return {kind:"propagate",error};
    if(attempt>=max)return {kind:"exhausted",attempt,error};
    if(delay>=deadline-now)return {kind:"deadline"};
    return {kind:"wait",wake:now+delay,attempt:attempt+1};
  };
  const delay=(initial,cap,attempt)=>{
    let n=BigInt(initial), max=BigInt(cap);
    if(n===0n)return 0n;
    if(n>=max)return max;
    for(let i=1;i<attempt&&n<max;i++)n=n>max/2n?max:n*2n;
    return n;
  };
  const state=()=>({value:10,version:0,epoch:1,undo:[],redo:[],receipts:new Map()});
  const op=(s,{id,expected,epoch=s.epoch,kind,value,capacity=2,target,fail=false,external=false})=>{
    if(epoch!==s.epoch)return "STALE_EPOCH";
    if(s.receipts.has(id)){
      const r=s.receipts.get(id);
      return r.expected===expected&&r.kind===kind&&r.value===value&&r.target===target?r.result:"COMMAND_CONFLICT";
    }
    if(expected!==s.version)return "STALE_VERSION";
    if(fail)return "ROLLED_BACK";
    if(kind==="commit"){
      if(s.undo.length>=capacity)return "QUOTA";
      s.undo.push({id,before:s.value,after:value,external});s.redo=[];s.value=value;
    }else if(kind==="undo"){
      const t=s.undo.at(-1);
      if(!t||t.id!==target)return "NOT_TAIL";
      if(t.external)return "COMPENSATION_REQUIRED";
      s.undo.pop();s.redo.push(t);s.value=t.before;
    }else if(kind==="redo"){
      const t=s.redo.at(-1);
      if(!t||t.id!==target)return "NOT_REDO_TAIL";
      if(s.undo.length>=capacity)return "QUOTA";
      s.redo.pop();s.undo.push(t);s.value=t.after;
    }else throw new Error("bad model action");
    s.version++;
    const result=`COMMITTED:${s.version}`;
    s.receipts.set(id,{expected,kind,value,target,result});return result;
  };
  const start=(s,id,value,extra={})=>op(s,{id,expected:s.version,kind:"commit",value,...extra});
  const undo=(s,id,target,extra={})=>op(s,{id,expected:s.version,kind:"undo",target,...extra});
  const redo=(s,id,target,extra={})=>op(s,{id,expected:s.version,kind:"redo",target,...extra});
  test("eligible retry",()=>assert(retry({attempt:1,max:3,now:10,deadline:100,delay:5,error:"transient"}).wake===15,"wake"));
  test("exhaustion",()=>assert(retry({attempt:3,max:3,now:0,deadline:100,delay:1,error:"transient"}).kind==="exhausted","attempt bound"));
  test("noneligible effects",()=>{for(const error of ["panic","raise","permanent","unclassified-result"])assert(retry({attempt:1,max:3,now:0,deadline:100,delay:1,error}).kind==="propagate",error)});
  test("cancellation",()=>assert(retry({attempt:1,max:3,now:0,deadline:100,delay:1,error:"transient",cancelled:true}).kind==="cancelled","cancel"));
  test("deadline boundary",()=>assert(retry({attempt:1,max:3,now:9,deadline:10,delay:1,error:"transient"}).kind==="deadline","exclusive boundary"));
  test("retry decision precedence",()=>{const p={attempt:3,max:3,now:100,deadline:100,delay:1,error:"permanent"};assert(retry(p).kind==="deadline","expired before eligibility/exhaustion");assert(retry({...p,cancelled:true}).kind==="cancelled","cancel before deadline");assert(retry({...p,now:99}).kind==="propagate","eligibility before exhaustion")});
  test("capped delay",()=>{assert(delay(10,100,1)===10n,"initial");assert(delay(10,100,1000000)===100n,"cap");assert(delay(0,100,1000000)===0n,"zero");assert(delay(2n**62n,2n**63n-1n,5)===2n**63n-1n,"overflow")});
  test("rollback",()=>{const s=state();assert(start(s,"a",0,{fail:true})==="ROLLED_BACK","failure");assert(s.value===10&&s.version===0&&s.undo.length===0&&s.receipts.size===0,"no publication")});
  test("undo overwritten value",()=>{const s=state();start(s,"a",0);undo(s,"u","a");assert(s.value===10&&s.version===2,"inverse and monotonic version")});
  test("redo",()=>{const s=state();start(s,"a",0);undo(s,"u","a");redo(s,"r","a");assert(s.value===0&&s.version===3,"redo")});
  test("stale version",()=>{const s=state();start(s,"a",0);assert(undo(s,"u","a",{expected:0})==="STALE_VERSION"&&s.value===0&&s.version===1,"stale")});
  test("non-tail",()=>{const s=state();start(s,"a",0);start(s,"b",1);assert(undo(s,"u","a")==="NOT_TAIL"&&s.value===1&&s.version===2,"non-tail")});
  test("duplicate settlement",()=>{const s=state();start(s,"a",0);assert(undo(s,"u","a")==="COMMITTED:2","first");assert(undo(s,"u","a",{expected:1})==="COMMITTED:2"&&s.version===2,"duplicate");assert(undo(s,"u","b")==="COMMAND_CONFLICT","id collision");assert(undo(s,"u","a",{expected:2})==="COMMAND_CONFLICT","changed expected version")});
  test("new branch",()=>{const s=state();start(s,"a",0);undo(s,"u","a");start(s,"b",3);assert(redo(s,"r","a")==="NOT_REDO_TAIL"&&s.value===3,"redo invalidation")});
  test("quota",()=>{const s=state();start(s,"a",0,{capacity:1});assert(start(s,"b",2,{capacity:1})==="QUOTA"&&s.version===1&&s.value===0,"quota")});
  test("published effects",()=>{const s=state();start(s,"a",0,{external:true});assert(undo(s,"u","a")==="COMPENSATION_REQUIRED"&&s.version===1,"external")});
  test("stale epoch",()=>{const s=state();s.epoch=2;assert(start(s,"a",0,{epoch:1})==="STALE_EPOCH"&&s.version===0,"fence")});
  return count;
}
console.log(`${run_actor_retry_undo_model()} source-free actor retry/undo model checks passed`);
