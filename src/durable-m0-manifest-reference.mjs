import {createHash} from 'node:crypto';

// Source-free byte/reference admission. Java's metadata serializer is the only
// intended M0 producer. This is NOT backend compiler, replay or guest parity.
const deny=(code)=>{throw new Error(code);};
const requireValue=(ok,code)=>{if(!ok)deny(code);};
const own=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,names,code)=>{
  requireValue(own(value)&&Object.keys(value).join(',')===names.join(','),code);
};
const isName=(value)=>typeof value==='string'&&value.length>0&&value.length<=256&&
  !/[\x00-\x1f\x7f]/.test(value);
const list=(value,max,code)=>requireValue(Array.isArray(value)&&value.length<=max,code);
const noDup=(items,key,code)=>{
  const seen=new Set();
  for(const item of items){const id=key(item);requireValue(!seen.has(id),code);seen.add(id);}
};
function checkParam(p){
 fields(p,['name','type','mutable','structural'],'DURABLE_M0_PARAM_SHAPE');
 requireValue(isName(p.name)&&isName(p.type)&&typeof p.mutable==='boolean'&&
   typeof p.structural==='boolean','DURABLE_M0_PARAM_INVALID');
}
function checkMethod(m){
 fields(m,['name','visibility','static','abstract','async','suspends','structural',
   'generics','arity','parameters','returns'],'DURABLE_M0_METHOD_SHAPE');
 requireValue(isName(m.name)&&m.visibility==='public'&&!m.static&&!m.abstract&&
   !m.async&&!m.suspends&&!m.structural&&isName(m.returns),
   'DURABLE_M0_METHOD_EFFECT_UNSUPPORTED');
 list(m.generics,0,'DURABLE_M0_GENERICS_UNSUPPORTED');
 list(m.parameters,16,'DURABLE_M0_PARAMETERS_UNSUPPORTED');
 requireValue(Number.isSafeInteger(m.arity)&&m.arity===m.parameters.length,
   'DURABLE_M0_METHOD_ARITY');
 m.parameters.forEach(checkParam);
 noDup(m.parameters,p=>p.name,'DURABLE_M0_DUPLICATE_PARAMETER');
}
function checkExpr(e,depth=0){
 requireValue(depth<=32,'DURABLE_M0_EXPRESSION_DEPTH');
 requireValue(own(e)&&isName(e.kind),'DURABLE_M0_EXPRESSION_SHAPE');
 if(['name','string','symbol'].includes(e.kind)){
   fields(e,['kind','value'],'DURABLE_M0_EXPRESSION_SHAPE');
   requireValue(typeof e.value==='string'&&e.value.length<=4096,
     'DURABLE_M0_EXPRESSION_VALUE');
   if(e.kind==='name')requireValue(isName(e.value)&&!e.value.startsWith('$'),
     'DURABLE_M0_EXPRESSION_NAME');
 }else if(e.kind==='int'){
   fields(e,['kind','value'],'DURABLE_M0_EXPRESSION_SHAPE');
   requireValue(Number.isSafeInteger(e.value),'DURABLE_M0_I64_NEEDS_TYPED_DECODER');
 }else if(e.kind==='bool'){
   fields(e,['kind','value'],'DURABLE_M0_EXPRESSION_SHAPE');
   requireValue(typeof e.value==='boolean','DURABLE_M0_EXPRESSION_VALUE');
 }else if(e.kind==='unary'){
   fields(e,['kind','op','value'],'DURABLE_M0_EXPRESSION_SHAPE');
   requireValue(isName(e.op),'DURABLE_M0_EXPRESSION_OPERATOR');
   checkExpr(e.value,depth+1);
 }else if(e.kind==='binary'){
   fields(e,['kind','op','left','right'],'DURABLE_M0_EXPRESSION_SHAPE');
   requireValue(isName(e.op),'DURABLE_M0_EXPRESSION_OPERATOR');
   checkExpr(e.left,depth+1);checkExpr(e.right,depth+1);
 }else if(e.kind==='conditional'){
   fields(e,['kind','condition','true','false'],'DURABLE_M0_EXPRESSION_SHAPE');
   checkExpr(e.condition,depth+1);checkExpr(e.true,depth+1);checkExpr(e.false,depth+1);
 }else if(e.kind==='list'||e.kind==='tuple'){
   fields(e,['kind','items'],'DURABLE_M0_EXPRESSION_SHAPE');
   list(e.items,64,'DURABLE_M0_EXPRESSION_BUDGET');
   e.items.forEach(v=>checkExpr(v,depth+1));
 }else deny('DURABLE_M0_EXPRESSION_KIND_UNSUPPORTED');
}
function checkCommand(c,idx,activities,workflows){
 const allowed=new Set(['activity_step','timer','wait_event','signal','update',
   'child_workflow','continue_as_new','compensation']);
 requireValue(own(c)&&allowed.has(c.kind),'DURABLE_M0_COMMAND_KIND_UNSUPPORTED');
 fields(c,['order','kind','id','target','arguments'],'DURABLE_M0_COMMAND_SHAPE');
 requireValue(Number.isSafeInteger(c.order)&&c.order===idx,'DURABLE_M0_HISTORY_ORDER');
 requireValue(isName(c.id)&&typeof c.target==='string','DURABLE_M0_COMMAND_ID');
 list(c.arguments,16,'DURABLE_M0_COMMAND_ARGS_BUDGET');
 c.arguments.forEach(e=>checkExpr(e));
 if(c.kind==='activity_step'||c.kind==='compensation'){
   requireValue(activities.has(c.target+'#'+c.arguments.length),
     'DURABLE_M0_ACTIVITY_TARGET_UNKNOWN');
 }else if(c.kind==='child_workflow'){
   requireValue(workflows.has(c.target)&&c.arguments.length===1,
     'DURABLE_M0_CHILD_TARGET_UNKNOWN');
 }else if(c.kind==='timer'){
   requireValue(c.target===''&&c.arguments.length===1,
     'DURABLE_M0_TIMER_SHAPE');
 }else if(c.kind==='wait_event'){
   requireValue(isName(c.target)&&c.arguments.length===0,
     'DURABLE_M0_WAIT_EVENT_SHAPE');
 }else if(c.kind==='continue_as_new'){
   requireValue(c.target===''&&c.arguments.length===1,
     'DURABLE_M0_CONTINUE_AS_NEW_SHAPE');
 }
}
export function verifyDurableM0Reference(bytes,{expectedSha256=null}={}){
 requireValue(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=131072,
   'DURABLE_M0_BYTES_BUDGET');
 const hash=createHash('sha256').update(bytes).digest('hex');
 if(expectedSha256!==null)requireValue(hash===expectedSha256,'DURABLE_M0_SHA256_MISMATCH');
 let text,root;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{deny('DURABLE_M0_INVALID_UTF8');}
 try{root=JSON.parse(text);}catch{deny('DURABLE_M0_INVALID_JSON');}
 requireValue(JSON.stringify(root)===text,'DURABLE_M0_NONCANONICAL_BYTES');
 fields(root,['format','activities','workflows'],'DURABLE_M0_ROOT_SHAPE');
 requireValue(root.format==='atto.durable.manifest.v1','DURABLE_M0_FORMAT_UNSUPPORTED');
 list(root.activities,128,'DURABLE_M0_ACTIVITIES_BUDGET');
 list(root.workflows,128,'DURABLE_M0_WORKFLOWS_BUDGET');
 const activities=new Set(),workflows=new Set();
 for(const a of root.activities){
   fields(a,['id','visibility','version','operations'],'DURABLE_M0_ACTIVITY_SHAPE');
   requireValue(isName(a.id)&&a.visibility==='public'&&a.version===1,
     'DURABLE_M0_ACTIVITY_VERSION');
   list(a.operations,64,'DURABLE_M0_ACTIVITY_METHOD_BUDGET');
   a.operations.forEach(checkMethod);
   noDup(a.operations,m=>m.name+'#'+m.arity,'DURABLE_M0_DUPLICATE_ACTIVITY_OPERATION');
   for(const m of a.operations)activities.add(a.id+'.'+m.name+'#'+m.arity);
 }
 for(const w of root.workflows){
   fields(w,['id','visibility','version','state','members','commands','queries'],
     'DURABLE_M0_WORKFLOW_SHAPE');
   requireValue(isName(w.id)&&w.visibility==='public'&&w.version===1,
     'DURABLE_M0_WORKFLOW_VERSION');
   list(w.state,0,'DURABLE_M0_STATE_SCHEMA_UNSUPPORTED');
   list(w.members,64,'DURABLE_M0_WORKFLOW_METHOD_BUDGET');
   w.members.forEach(checkMethod);
   noDup(w.members,m=>m.name+'#'+m.arity,'DURABLE_M0_DUPLICATE_WORKFLOW_MEMBER');
   requireValue(w.members.filter(m=>m.name==='run').length===1,
     'DURABLE_M0_WORKFLOW_ENTRYPOINT');
   workflows.add(w.id);
 }
 noDup(root.activities,a=>a.id,'DURABLE_M0_DUPLICATE_ACTIVITY');
 noDup(root.workflows,w=>w.id,'DURABLE_M0_DUPLICATE_WORKFLOW');
 for(const w of root.workflows){
   list(w.commands,1024,'DURABLE_M0_HISTORY_BUDGET');
   w.commands.forEach((c,i)=>checkCommand(c,i,activities,workflows));
   noDup(w.commands,c=>c.id,'DURABLE_M0_DUPLICATE_COMMAND_ID');
   list(w.queries,64,'DURABLE_M0_QUERY_BUDGET');
   for(const q of w.queries){
     fields(q,['endpoint','parameters','returns'],'DURABLE_M0_QUERY_SHAPE');
     requireValue(isName(q.endpoint)&&isName(q.returns),'DURABLE_M0_QUERY_SHAPE');
     list(q.parameters,16,'DURABLE_M0_QUERY_PARAM_BUDGET');
     q.parameters.forEach(checkParam);
     const member=w.members.find(m=>m.name===q.endpoint&&
       m.parameters.length===q.parameters.length);
     requireValue(member,'DURABLE_M0_QUERY_ENDPOINT_UNKNOWN');
     requireValue(member.returns===q.returns&&member.parameters.every((p,i)=>
       p.type===q.parameters[i].type),
       'DURABLE_M0_QUERY_SIGNATURE_MISMATCH');
   }
   noDup(w.queries,q=>q.endpoint+'#'+q.parameters.length,
     'DURABLE_M0_DUPLICATE_QUERY');
 }
 return Object.freeze({format:root.format,sha256:hash,bytes:bytes.length,
   activities:root.activities.length,workflows:root.workflows.length,
   commands:root.workflows.reduce((n,w)=>n+w.commands.length,0),
   queries:root.workflows.reduce((n,w)=>n+w.queries.length,0),
   gate:'SOURCE_FREE_REFERENCE_ONLY_NOT_GUEST_EXECUTION'});
}
