/**
 * CPU/GPU execution-region typed AST + graph reference oracle.
 * NOT an Oreslang source parser, actor scheduler, GPU runtime or compiler proof.
 * The only executable opcodes are CPU i64 constants/checked addition.
 */
const kinds = new Set(["void", "i64", "HostBuffer<f32>", "GpuBuffer<f32>"]);
const maxDepth = 64, maxNodes = 2048;
const bad = (code,detail) => { const e=new TypeError(code+": "+detail);e.code=code;throw e };
const record = v => v!==null && typeof v==="object" && !Array.isArray(v);
const future = type => {
 if(isFuture(type))bad("NESTED_FUTURE","explicit await/composition required");
 return "Future<"+type+">";
};
const isFuture = type => typeof type==="string" && /^Future<.+>$/.test(type);
const isOwnedBuffer = type => type==="HostBuffer<f32>" || type==="GpuBuffer<f32>";
const id = text => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(text||"");
const checked = value => {
 if(typeof value!=="bigint" || value<-(1n<<63n) || value>(1n<<63n)-1n)
  bad("INVALID_I64","requires signed i64 bigint");
 return value;
};
export const Ast=Object.freeze({
 CpuRegion:(body,nb=false)=>({kind:"CpuRegion",body,nb}),
 GpuRegion:(body,nb=false)=>({kind:"GpuRegion",body,nb}),
 I64:value=>({kind:"I64",value:checked(value)}),
 Add:(left,right)=>({kind:"Add",left,right}),
 Param:(name,type)=>({kind:"Param",name,type}),
 Upload:value=>({kind:"Upload",value}),
 Download:value=>({kind:"Download",value}),
 Kernel:(name,value)=>({kind:"Kernel",name,value}),
 Await:value=>({kind:"Await",value}),
 Seq:(...values)=>({kind:"Seq",values})
});
function snapshot(ast,depth=0,budget={remaining:maxNodes}){
 if(depth>maxDepth)bad("DEPTH_LIMIT","AST too deep");
 if(--budget.remaining<0)bad("NODE_LIMIT","AST exceeds total node budget");
 if(!record(ast)||typeof ast.kind!=="string")bad("INVALID_AST","not an AST node");
 const spec={
  CpuRegion:["body","nb"],GpuRegion:["body","nb"],I64:["value"],
  Add:["left","right"],Param:["name","type"],Upload:["value"],
  Download:["value"],Kernel:["name","value"],Await:["value"],Seq:["values"]
 }[ast.kind];
 if(!Array.isArray(spec)||!Object.hasOwn(ast,"kind"))
  bad("INVALID_AST","unknown or inherited AST kind");
 if(Object.keys(ast).length!==spec.length+1 ||
    !spec.every(k=>Object.hasOwn(ast,k)) ||
    Object.keys(ast).some(k=>k!=="kind" && !spec.includes(k)))
  bad("INVALID_AST","missing, inherited or unexpected AST field");
 let v;
 switch(ast.kind){
  case "I64": v={kind:"I64",value:checked(ast.value)};break;
  case "Param":
   if(!id(ast.name)||!kinds.has(ast.type)||ast.type==="void")bad("INVALID_TYPE","parameter");
   v={kind:"Param",name:ast.name,type:ast.type};break;
  case "CpuRegion":case "GpuRegion":
   if(typeof ast.nb!=="boolean")bad("INVALID_AST","nb must be boolean");
   v={kind:ast.kind,body:snapshot(ast.body,depth+1,budget),nb:ast.nb};break;
  case "Add":
   v={kind:"Add",left:snapshot(ast.left,depth+1,budget),right:snapshot(ast.right,depth+1,budget)};break;
  case "Kernel":
   if(!id(ast.name))bad("INVALID_KERNEL","name");
   v={kind:"Kernel",name:ast.name,value:snapshot(ast.value,depth+1,budget)};break;
  case "Seq":
   if(!Array.isArray(ast.values)||ast.values.length>maxNodes)bad("NODE_LIMIT","sequence");
   v={kind:"Seq",values:Object.freeze(ast.values.map(x=>snapshot(x,depth+1,budget)))};break;
  default: v={kind:ast.kind,value:snapshot(ast.value,depth+1,budget)};
 }
 return Object.freeze(v);
}
export function lower(root,{parameters={}}={}){
 const ast=snapshot(root);
 if(!record(parameters)||Object.keys(parameters).length>64)bad("INVALID_PARAMETERS","parameter map");
 for(const [name,type] of Object.entries(parameters))
  if(!id(name)||!kinds.has(type)||type==="void")bad("INVALID_PARAMETERS","name or type");
 const nodes=[], effects=new Set(), moved=new Set();let deviceKernels=0;
 const emit=(opcode,domain,type,inputs=[],meta={})=>{
  if(nodes.length>=maxNodes)bad("NODE_LIMIT","graph too large");
  const nodeId=nodes.length, predecessors=new Set(inputs.filter(x=>x!==null&&x!==undefined));
  if(nodeId>0)predecessors.add(nodeId-1);
  for(const dep of predecessors)
   if(!Number.isInteger(dep)||dep<0||dep>=nodeId)bad("INVALID_DEPENDENCY","forward/cyclic graph");
  const n=Object.freeze({id:nodeId,opcode,domain,type,
   dependencies:Object.freeze([...predecessors].sort((a,b)=>a-b)),
   meta:Object.freeze({...meta})});
  nodes.push(n);return {type,id:nodeId};
 };
 const visit=(node,domain,depth)=>{
  if(depth>maxDepth)bad("DEPTH_LIMIT","graph too deep");
  switch(node.kind){
   case "I64":
    if(domain!=="CPU")bad("DEVICE_EFFECT","host arithmetic in GPU kernel");
    effects.add("Host");return emit("CONST_I64","CPU","i64",[],{value:String(node.value)});
   case "Param":
    if(!Object.hasOwn(parameters,node.name)||parameters[node.name]!==node.type)
     bad("PARAM_TYPE","undeclared/mistyped parameter");
    if(isOwnedBuffer(node.type) && moved.has(node.name))bad("USE_AFTER_MOVE",node.name);
    if(isOwnedBuffer(node.type))moved.add(node.name);
    return emit("PARAM","HOST",node.type,[],{name:node.name});
   case "Add": {
    if(domain!=="CPU")bad("DEVICE_EFFECT","Add inside GPU kernel");
    const l=visit(node.left,domain,depth+1),r=visit(node.right,domain,depth+1);
    if(l.type!=="i64"||r.type!=="i64")bad("TYPE_MISMATCH","Add needs i64");
    effects.add("Host");return emit("ADD_I64","CPU","i64",[l.id,r.id],{left:l.id,right:r.id});
   }
   case "Upload":case "Download": {
    if(domain!=="CPU")bad("DEVICE_EFFECT","transfer requires CPU continuation");
    const v=visit(node.value,domain,depth+1);
    const input=node.kind==="Upload"?"HostBuffer<f32>":"GpuBuffer<f32>";
    if(v.type!==input)bad("RESIDENCY_MISMATCH","no implicit host/device transfer");
    effects.add("Transfer");effects.add("Suspend");
    return emit(node.kind.toUpperCase(),"TRANSFER",
     node.kind==="Upload"?"GpuBuffer<f32>":"HostBuffer<f32>",[v.id]);
   }
   case "Kernel": {
    if(domain!=="GPU")bad("DEVICE_EFFECT","GPU kernel outside gpu block");
    const v=visit(node.value,domain,depth+1);
    if(v.type!=="GpuBuffer<f32>")bad("RESIDENCY_MISMATCH","kernel input must be device buffer");
    effects.add("Device");effects.add("Suspend");deviceKernels++;
    return emit("DEVICE_KERNEL","GPU",v.type,[v.id],{kernel:node.name});
   }
   case "Await": {
    if(domain!=="CPU")bad("DEVICE_EFFECT","await must be host continuation");
    const v=visit(node.value,domain,depth+1);
    if(!isFuture(v.type))bad("NOT_FUTURE","await requires Future<T>");
    effects.add("Suspend");return emit("AWAIT","CPU",v.type.slice(7,-1),[v.id]);
   }
   case "Seq": {
    let last={type:"void",id:null};
    for(const item of node.values)last=visit(item,domain,depth+1);
    return last;
   }
   case "CpuRegion":case "GpuRegion": {
    const next=node.kind==="CpuRegion"?"CPU":"GPU";
    if(domain==="GPU"&&next==="CPU"){
     effects.add("Suspend");emit("DEVICE_FENCE","TRANSFER","void");
    }
    if(domain==="CPU"&&next==="GPU"){
     effects.add("Suspend");emit("DEVICE_ADMISSION","TRANSFER","void");
    }
    const before=deviceKernels,v=visit(node.body,next,depth+1);
    if(next==="GPU"&&before===deviceKernels)
     bad("EMPTY_GPU_REGION","GPU region requires declared kernel work");
    if(node.nb){
     effects.add("Suspend");
     return emit("SUBMIT","HOST",future(v.type),v.id===null?[]:[v.id],{target:next});
    }
    return v;
   }
   default:bad("INVALID_AST","unknown node");
  }
 };
 const ret=visit(ast,"CPU",0);
 return Object.freeze({schemaVersion:1,resultType:ret.type,returnId:ret.id,
  deviceKernels,effects:Object.freeze(["Host","Device","Transfer","Suspend"].filter(e=>effects.has(e))),
  nodes:Object.freeze(nodes.slice())});
}
/** Test oracle only: no device, transfer, asynchronous or actor scheduler. */
/** Conservative CPU-only *reference* executor, never GPU/async or guest source proof.
 * An externally supplied graph is not trusted merely because it has schemaVersion 1.
 * Re-validate canonical SSA operands, sequencing edges and integer encoding before use.
 */
export function executeCpuI64(graph){
 const exactKeys=(value,required)=>record(value)&&
   Object.keys(value).length===required.length&&required.every(k=>Object.hasOwn(value,k));
 if(!exactKeys(graph,["schemaVersion","resultType","returnId","deviceKernels","effects","nodes"])||
    graph.schemaVersion!==1||graph.resultType!=="i64"||!Number.isInteger(graph.deviceKernels)||
    !Array.isArray(graph.effects)||!Array.isArray(graph.nodes)||graph.nodes.length<1||
    graph.nodes.length>maxNodes||graph.returnId!==graph.nodes.length-1)
   bad("INVALID_GRAPH","CPU-only i64 graph header or terminal value invalid");
 if(graph.deviceKernels!==0||graph.effects.length!==1||graph.effects[0]!=="Host")
   bad("DEVICE_OR_ASYNC_UNAVAILABLE","CPU-only oracle cannot execute device, transfer or async effects");
 const values=[];
 for(let i=0;i<graph.nodes.length;i++){
   const n=graph.nodes[i];
   if(!exactKeys(n,["id","opcode","domain","type","dependencies","meta"])||
      n.id!==i||n.domain!=="CPU"||n.type!=="i64"||
      !Array.isArray(n.dependencies)||!record(n.meta))
     bad("INVALID_GRAPH","CPU i64 node shape invalid");
   const expected=i===0?[]:[i-1];
   if(n.opcode==="CONST_I64"){
     if(!exactKeys(n.meta,["value"])||typeof n.meta.value!=="string"||
        n.meta.value.length>20||!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(n.meta.value))
       bad("INVALID_GRAPH","constant is not canonical signed i64 text");
     values[i]=checked(BigInt(n.meta.value));
   }else if(n.opcode==="ADD_I64"){
     if(!exactKeys(n.meta,["left","right"]))
       bad("INVALID_GRAPH","invalid ADD operands");
     const {left,right}=n.meta;
     if(!Number.isInteger(left)||!Number.isInteger(right)||
        left<0||right<0||left>=i||right>=i)
       bad("INVALID_GRAPH","ADD requires prior SSA operands");
     expected.push(left,right);
     values[i]=checked(values[left]+values[right]);
   }else{
     bad("DEVICE_OR_ASYNC_UNAVAILABLE","CPU-only reference cannot execute device/async opcodes");
   }
   const canonical=[...new Set(expected)].sort((a,b)=>a-b);
   if(n.dependencies.length!==canonical.length||
      n.dependencies.some((dep,j)=>dep!==canonical[j]))
     bad("INVALID_GRAPH","dependencies must equal canonical prior SSA and sequencing edges");
 }
 return values[graph.returnId];
}
