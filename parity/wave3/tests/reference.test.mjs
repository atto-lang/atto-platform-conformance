import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKENDS,unwind,validateLibraryGraph,LocalActorRegistry,actorHookPolicy,SingleFlightModel} from '../src/reference.mjs';
const fault=(kind,detail)=>{throw {kind,detail};};
test('five backends tracked but reference model makes no parity certification',()=>assert.deepEqual(BACKENDS,['java','llvm','net','wasm','forge']));
test('all defers LIFO and finally run exactly once, even after cleanup failure',()=>{
 const called=[];
 const r=unwind({primary:{kind:'panic',detail:'root'},deferred:[()=>{called.push('first');},()=>{called.push('middle');fault('throw','weaker');},()=>{called.push('last');}],finallyAction:()=>{called.push('finally');}});
 assert.deepEqual(called,['last','middle','first','finally']);assert.equal(r.terminal.kind,'panic');assert.deepEqual(r.suppressed.map(x=>x.kind),['throw']);assert.equal(r.attempted.length,4);
});
test('stronger cleanup can replace weaker failure without erasing it',()=>{
 const r=unwind({primary:{kind:'throw',detail:'ordinary'},deferred:[()=>fault('raise','escalated')]});
 assert.equal(r.terminal.kind,'raise');assert.equal(r.suppressed[0].kind,'throw');
});
test('cancellation, panic and host fatal outrank ordinary cleanup failures',()=>{
 for(const kind of ['cancel','panic','host_fatal']){
  const r=unwind({primary:{kind},deferred:[()=>fault('throw','weak')]});assert.equal(r.terminal.kind,kind);
 }
});
test('freestanding closure permits core-only transitive imports',()=>{
 const graph={scalar:{layer:'core',deps:['math']},math:{layer:'core',deps:['abi']},abi:{layer:'core',deps:[]}};
 assert.deepEqual(validateLibraryGraph(graph,'scalar').closure,['abi','math','scalar']);
});
test('core cannot transitively import std or HAL',()=>{
 const g={app:{layer:'core',deps:['x']},x:{layer:'core',deps:['std']},std:{layer:'std',deps:[]}};
 assert.throws(()=>validateLibraryGraph(g,'app',{profile:'hosted'}),/core imports/);
 const other={app:{layer:'hal',deps:['core']},core:{layer:'core',deps:[]}};
 assert.throws(()=>validateLibraryGraph(other,'app',{profile:'freestanding'}),/forbidden hal/);
 assert.deepEqual(validateLibraryGraph(other,'app',{profile:'embedded-rtos'}).closure,['core','app']);
});
test('dependency cycles, unresolved modules, duplicate deps and misplaced platform layers reject',()=>{
 for(const g of [
  {a:{layer:'core',deps:['a']}},
  {a:{layer:'core',deps:['not-found']}},
  {a:{layer:'core',deps:['x','x']},x:{layer:'core',deps:[]}},
  {a:{layer:'hal',deps:['s']},s:{layer:'std',deps:[]}}
 ])assert.throws(()=>validateLibraryGraph(g,'a',{profile:'hosted'}),/wave3:/);
});
test('ActorRef is minted, opaque, local and not serializable',()=>{
 const reg=new LocalActorRegistry({capacity:2,mailboxCapacity:2});const ref=reg.spawn();
 assert.equal(Object.isFrozen(ref),true);assert.equal(Object.keys(ref).includes('id'),false);
 assert.equal(reg.send(ref,10),1);assert.equal(reg.read(ref),10);
 assert.throws(()=>reg.send({id:1,generation:1},10),/forged/);
 assert.throws(()=>JSON.stringify(ref),/not wire-serializable/);
 assert.throws(()=>new LocalActorRegistry().send(ref,1),/foreign/);
});
test('slot incarnation rotates after stop; stale ref never inherits new authority',()=>{
 const r=new LocalActorRegistry({capacity:1});const stale=r.spawn();r.stop(stale);const live=r.spawn();
 assert.throws(()=>r.send(stale,4),/stale/);assert.equal(r.send(live,5),1);
 assert.throws(()=>r.spawn(),/capacity/);
});
test('full mailbox and invalid send values fail closed without consuming pending mail',()=>{
 const r=new LocalActorRegistry({mailboxCapacity:1});const ref=r.spawn();r.send(ref,8);
 assert.throws(()=>r.send(ref,9),/full/);assert.throws(()=>r.send(ref,'malformed'),/full|scalar/);
 assert.equal(r.read(ref),8);assert.equal(r.read(ref),null);
});
test('private abstract slots normalize optional self while denying caller dispatch',()=>{
 const a=actorHookPolicy({operation:'override',inlineSelf:true});const b=actorHookPolicy({operation:'override',inlineSelf:false});assert.equal(a.slot,b.slot);
 assert.deepEqual(actorHookPolicy({caller:'trusted-hidden-base'}).slot,'receive/1');
 for(const args of [{caller:'user'},{caller:'UserActor'},{operation:'reference',caller:'trusted-hidden-base'},{operation:'override',overrideVisibility:'public'}])assert.throws(()=>actorHookPolicy(args),/wave3:/);
});
test('one physical actor turn while multiple unfinished lifetimes coexist',()=>{
 const m=new SingleFlightModel({maxOutstanding:3});m.create('actor-1');const a=m.send('actor-1'),b=m.send('actor-1');
 assert.equal(m.enter('actor-1','carrier-A'),a);assert.throws(()=>m.enter('actor-1','carrier-B'),/parallel/);
 m.suspend('actor-1',a);assert.equal(m.enter('actor-1','carrier-B'),b);m.finish('actor-1',b);
 m.resume('actor-1',a);assert.throws(()=>m.resume('actor-1',a),/double/);
 assert.equal(m.enter('actor-1','carrier-C'),a);m.finish('actor-1',a);
 assert.equal(m.snapshot('actor-1').outstanding,0);
});
test('logical admission bound, cancellation and stale continuation rejection',()=>{
 const m=new SingleFlightModel({maxOutstanding:2});m.create('x');const a=m.send('x'),b=m.send('x');assert.throws(()=>m.send('x'),/outstanding/);
 m.cancel('x',b);assert.equal(m.enter('x','other-carrier'),a);assert.throws(()=>m.cancel('x',a),/currently running/);m.finish('x',a);
 assert.throws(()=>m.resume('x',a),/illegal/);assert.equal(m.snapshot('x').active,null);
});
test('independent actors execute concurrently without actor-local overlap',()=>{
 const m=new SingleFlightModel();m.create('a');m.create('b');m.send('a');m.send('b');m.enter('a','carrier1');m.enter('b','carrier2');
 assert.equal(m.snapshot('a').active.carrier,'carrier1');assert.equal(m.snapshot('b').active.carrier,'carrier2');
});
test('bounded actor continuation interleavings preserve single-flight on every reachable trace',()=>{
 // Replay each prefix from a fresh model; invalid steps are deliberately pruned.
 const actions=['send','enter-A','enter-B','suspend','resume','finish','cancel'];
 let reachable=0,branchCount=0;
 function replay(trace){
  const m=new SingleFlightModel({maxOutstanding:2,maxReady:2});m.create('actor');
  for(const action of trace){
   const s=m.snapshot('actor');
   if(action==='send')m.send('actor');
   else if(action.startsWith('enter-'))m.enter('actor',action.slice(6));
   else if(action==='suspend')m.suspend('actor',s.active?.ticket);
   else if(action==='finish')m.finish('actor',s.active?.ticket);
   else if(action==='resume'){const entry=s.states.find(x=>x[1]==='suspended');m.resume('actor',entry?.[0]);}
   else if(action==='cancel'){const entry=s.states.find(x=>x[1]==='ready'||x[1]==='suspended');m.cancel('actor',entry?.[0]);}
   const after=m.snapshot('actor');
   assert.ok(after.active===null||after.states.filter(x=>x[1]==='running').length===1);
   assert.equal(after.states.filter(x=>x[1]==='running').length,after.active?1:0);
   assert.ok(after.outstanding<=2,JSON.stringify({trace,after}));
  }
 }
 function visit(trace,depth){
  replay(trace);reachable++;
  if(depth===0)return;
  for(const action of actions){
   const next=[...trace,action];
   try{replay(next);}catch(e){if(!String(e.message).startsWith('wave3:'))throw e;continue;}
   branchCount++;visit(next,depth-1);
  }
 }
 visit([],5);
 assert.ok(reachable>80,{reachable,branchCount});
});
