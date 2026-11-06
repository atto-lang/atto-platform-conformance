// Pure, read-only audit dependency analysis; does not merge or approve PRs.
const ID=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/;
const CAUSE=/^[a-z][a-z0-9_.-]{0,63}$/;
const error=(kind,detail={})=>({kind,...detail});
export function analyzeBlockerGraph(items,{maxNodes=2048,maxEdges=8192}={}){
  if(!Array.isArray(items)||items.length>maxNodes||!Number.isInteger(maxNodes)||maxNodes<=0||
     !Number.isInteger(maxEdges)||maxEdges<0)return {status:'INCOMPLETE',issues:[error('INVALID_INPUT')],clusters:[],order:[],releaseAuthorized:false};
  const issues=[],map=new Map();let edges=0;
  for(const x of items){
    if(Array.isArray(x?.dependsOn)&&x.dependsOn.length>maxEdges)issues.push(error('EDGE_BUDGET_EXCEEDED',{id:x?.id,maxEdges}));
    if(!x||typeof x!=='object'||Array.isArray(x)||!ID.test(x.id??'')||!CAUSE.test(x.cause??'')||
       !['OPEN','RESOLVED','UNKNOWN'].includes(x.status)||!Array.isArray(x.dependsOn)||
       x.dependsOn.length>maxEdges||x.dependsOn.some(y=>typeof y!=='string'||!ID.test(y))){
      issues.push(error('INVALID_NODE',{id:x?.id??null}));continue;
    }
    if(map.has(x.id)){issues.push(error('DUPLICATE_NODE',{id:x.id}));continue;}
    if(new Set(x.dependsOn).size!==x.dependsOn.length)issues.push(error('DUPLICATE_EDGE',{id:x.id}));
    edges+=x.dependsOn.length;
    map.set(x.id,{id:x.id,cause:x.cause,status:x.status,dependsOn:x.dependsOn});
  }
  if(edges>maxEdges)issues.push(error('EDGE_BUDGET_EXCEEDED',{edges,maxEdges}));
  for(const x of map.values())for(const dep of x.dependsOn){
    if(!map.has(dep))issues.push(error('MISSING_DEPENDENCY',{id:x.id,dependsOn:dep}));
    if(dep===x.id)issues.push(error('SELF_DEPENDENCY',{id:x.id}));
    if(x.status==='RESOLVED'&&map.get(dep)?.status!=='RESOLVED')issues.push(error('RESOLVED_WITH_OPEN_DEPENDENCY',{id:x.id,dependsOn:dep}));
  }
  const indegree=new Map([...map.keys()].map(k=>[k,0]));
  const dependent=new Map([...map.keys()].map(k=>[k,[]]));
  for(const x of map.values())for(const d of x.dependsOn)if(map.has(d)){
    indegree.set(x.id,indegree.get(x.id)+1);dependent.get(d).push(x.id);
  }
  let queue=[...indegree].filter(([,n])=>n===0).map(([k])=>k).sort(),order=[];
  for(let i=0;i<queue.length;i++){
    const id=queue[i];order.push(id);
    for(const child of dependent.get(id).sort()){
      indegree.set(child,indegree.get(child)-1);
      if(indegree.get(child)===0)queue.push(child);
    }
  }
  if(order.length!==map.size)issues.push(error('CYCLE_OR_DOWNSTREAM',{unresolved:[...indegree].filter(([,v])=>v>0).map(([k])=>k).sort()}));
  const causeMap=new Map();
  for(const x of map.values()){
    const row=causeMap.get(x.cause)??{cause:x.cause,prs:[],open:0,unknown:0};
    row.prs.push(x.id);if(x.status==='OPEN')row.open++;if(x.status==='UNKNOWN')row.unknown++;
    causeMap.set(x.cause,row);
  }
  const clusters=[...causeMap.values()].sort((a,b)=>a.cause.localeCompare(b.cause));
  clusters.forEach(x=>x.prs.sort());
  const roots=[...map.values()].filter(x=>x.status!=='RESOLVED'&&x.dependsOn.length===0).map(x=>x.id).sort();
  return {status:issues.length?'INCOMPLETE':'STRUCTURAL_CANDIDATE',issues,clusters,order,roots,
    releaseAuthorized:false,reviewEnforcement:'UNKNOWN'};
}
