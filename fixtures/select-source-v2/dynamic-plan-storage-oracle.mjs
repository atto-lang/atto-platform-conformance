// Independent bounded storage accounting model, not compiler/guest evidence.
function verifyPool(){
 let checks=0;const assert=(b,m)=>{checks++;if(!b)throw Error(m)};
 const cap=256,freeS=[],freeC=[],allC=[],allS=[],active=new Map();
 function cell(cursor){let c=freeC.pop();if(!c){c={};allC.push(c)}Object.assign(c,{cursor,refs:1});return c}
 let current=cell(0),version=0;
 function drop(c){assert(c.refs>0,"ref underflow");if(--c.refs===0)freeC.push(c)}
 function mutate(){if(current.refs!==1){let old=current;current=cell(old.cursor);drop(old)}version++}
 function acquire(id){if(active.size===cap)return false;let s=freeS.pop();if(!s){s={};allS.push(s)}Object.assign(s,{cell:current,version});current.refs++;active.set(id,s);return true}
 function retire(id,commit){let s=active.get(id);assert(!!s,"unknown ticket");if(commit)s.cell.cursor=(s.cell.cursor+1)%8;drop(s.cell);active.delete(id);s.cell=null;freeS.push(s)}
 function validate(){let tally=new Map([[current,1]]);for(let s of active.values())tally.set(s.cell,(tally.get(s.cell)||0)+1);for(let c of allC)assert(c.refs===(tally.get(c)||0),"generation reference balance");assert(new Set(freeC).size===freeC.length,"cell duplicated");assert(new Set(freeS).size===freeS.length,"snapshot duplicated");assert(allS.length===freeS.length+active.size,"snapshot accounting");assert(allC.length<=cap+1&&allS.length<=cap,"storage ceiling");}
 for(let i=0;i<cap;i++){assert(acquire(i),"initial admission");mutate()}assert(!acquire(cap),"over quota");validate();
 for(let i=0;i<cap;i++){let before=current.cursor;retire(i,true);assert(before===current.cursor,"retired winner changed live cursor")}validate();
 for(let i=0;i<10000;i++){assert(acquire(i),"sequential admission");mutate();retire(i,i%2===0);if(i%101===0)validate()}validate();
 let seed=123456789;function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
 for(let i=0;i<5000;i++){let v=rand()%4;if(v===0)mutate();else if(v===1||active.size===0)acquire(i);else {let id=[...active.keys()][rand()%active.size];retire(id,v===2)}if(i%17===0)validate()}
 for(let id of [...active.keys()])retire(id,false);validate();return {checks,allocatedSnapshots:allS.length,allocatedCells:allC.length,active:active.size,liveGenerationRefs:current.refs}
}
console.log(JSON.stringify(verifyPool()));
