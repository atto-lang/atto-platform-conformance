// Bounded, executable SPECIFICATION of critical actor-state access (NOT compiler/runtime proof).
import test from 'node:test';
import assert from 'node:assert/strict';

const start = () => ({mode:[0,0], suspended:[false,false], alive:true, generation:1, rejected:false, illegalWrites:0});
const copy = s => ({...s, mode:[...s.mode], suspended:[...s.suspended]});
const permitted = (s,i) => s.alive && !s.suspended[i] && s.mode[i]===0;
function steps(s) {
  const out=[];
  const add=(label,change)=>{const n=copy(s);change(n);out.push([label,n]);};
  if (s.alive) {
    for (let i=0;i<2;i++) {
      if (permitted(s,i) && !s.mode.includes(2)) add('read:'+i,n=>{n.mode[i]=1;});
      if (permitted(s,i) && s.mode.every(m=>m===0)) add('write:'+i,n=>{n.mode[i]=2;});
      if (s.mode[i]!==0) add('leave:'+i,n=>{n.mode[i]=0;});
      if (permitted(s,i)) add('await:'+i,n=>{n.suspended[i]=true;});
      if (s.suspended[i]) add('resume:'+i,n=>{n.suspended[i]=false;});
    }
    if (!s.rejected) add('reject_direct_field',n=>{n.rejected=true;});
    if (s.mode.every(m=>m===0)) add('retire',n=>{n.alive=false;n.suspended=[false,false];});
  } else if (s.generation<2) {
    add('reincarnate',n=>{n.generation++;n.alive=true;n.rejected=false;});
  }
  return out;
}
function safety(s) {
  const readers=s.mode.filter(m=>m===1).length;
  const writers=s.mode.filter(m=>m===2).length;
  return writers<=1 && (writers===0 || readers===0) &&
    s.mode.every((m,i)=>m>=0&&m<=2&&(!s.suspended[i]||m===0)) &&
    (s.alive||s.mode.every(m=>m===0)) && s.illegalWrites===0;
}
function explore(inject) {
  const queue=[{s:start(),trace:[]}], seen=new Set(), witnesses=new Set();
  let edges=0, counterexample=null;
  for(let pos=0;pos<queue.length;pos++){
    const {s,trace}=queue[pos],key=JSON.stringify(s);
    if(seen.has(key))continue;
    seen.add(key);
    if(!safety(s)){counterexample={s,trace};break;}
    if(s.mode[0]===1&&s.mode[1]===1)witnesses.add('parallel_reads');
    if(s.mode.includes(2))witnesses.add('exclusive_writer');
    if(s.suspended.includes(true))witnesses.add('suspension');
    if(!s.alive)witnesses.add('retirement');
    if(s.generation===2)witnesses.add('reincarnation');
    if(s.rejected)witnesses.add('direct_rejected');
    const next=steps(s);
    if(inject==='unsafe_await'&&s.mode.includes(2))
      next.push(['UNSAFE:await_during_write',(()=>{const n=copy(s);n.suspended[s.mode.indexOf(2)]=true;return n;})()]);
    if(inject==='unsafe_direct'&&s.alive)
      next.push(['UNSAFE:direct_field_mutation',(()=>{const n=copy(s);n.illegalWrites=1;return n;})()]);
    for(const [label,n] of next){edges++;queue.push({s:n,trace:[...trace,label]});}
  }
  return {states:seen.size,edges,witnesses,counterexample};
}
test('bounded exhaustive two-task critical-section admission',()=>{
  const r=explore();
  assert.equal(r.counterexample,null);
  for(const w of ['parallel_reads','exclusive_writer','suspension','retirement','reincarnation','direct_rejected'])
    assert.ok(r.witnesses.has(w), 'unreachable witness '+w);
  assert.ok(r.states>30 && r.edges>50);
  console.log('HOST_ONLY actor critical-state model', {states:r.states,edges:r.edges});
});
for(const mutation of ['unsafe_await','unsafe_direct']) test('unsafe mutant MUST be detected: '+mutation,()=>{
  const r=explore(mutation);
  assert.ok(r.counterexample, 'unsafe mutant escaped the invariant');
  assert.ok(r.counterexample.trace.at(-1).startsWith('UNSAFE:'));
  console.log('expected counterexample',mutation,r.counterexample.trace);
});
