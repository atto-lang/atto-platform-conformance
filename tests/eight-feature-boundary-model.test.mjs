import test from 'node:test';
import assert from 'node:assert/strict';

// SOURCE-FREE finite state reference model, NOT Oreslang compiler/runtime evidence.
// Mutants deliberately exercise behaviors the checked-in compiler tests must forbid.
const state = () => ({started:false, closed:false, admissionFailure:null, guestEffects:0, physicalExit:false, terminal:false});
function pull(s, admit) {
  if (s.admissionFailure) throw s.admissionFailure;
  if (s.closed || s.terminal) return 'DONE';
  if (!s.started) {
    s.started = true;
    try { admit(); }
    catch (error) { s.admissionFailure = error; throw error; }
  }
  s.guestEffects++;
  return 'YIELD';
}
function mutateUnsafePull(s, admit) {
  if (s.closed || s.terminal) return 'DONE';
  if (!s.started) {
    s.started = true;
    try { admit(); }
    catch { s.terminal = true; return 'DONE'; } // wrong: conceals rejection
  }
  return 'YIELD';
}

test('denied generator producer launch remains a sticky failure with zero guest effects', () => {
  for (let polls=1;polls<=64;polls++) {
    const s=state(), rejected=new Error('runtime shutdown');
    for (let i=0;i<polls;i++) assert.throws(()=>pull(s,()=>{throw rejected;}), e=>e===rejected);
    assert.equal(s.guestEffects,0);
    assert.equal(s.started,true);
    assert.equal(s.admissionFailure,rejected);
  }
});
test('unsafe producer-launch mutant conceals original rejection', () => {
  const s=state();
  assert.equal(mutateUnsafePull(s,()=>{throw new Error('shutdown');}), 'DONE');
  assert.equal(s.terminal,true); // explicit witness of forbidden behavior
});

test('physical-exit barrier never admits completion merely because result settled', () => {
  for (const first of ['terminal','physicalExit']) {
    const s=state();
    s[first]=true;
    assert.equal(s.terminal && s.physicalExit,false);
    s[first==='terminal'?'physicalExit':'terminal']=true;
    assert.equal(s.terminal && s.physicalExit,true);
  }
});

const tuple=(...slots)=>({kind:'tuple',slots});
const record=fields=>({kind:'record',fields});
function expandArguments(parts,trace) {
  const values=[];
  for (const p of parts) {
    const v=p.eval(); // exactly one evaluation, left to right
    if (!p.spread) { values.push(v); continue; }
    if (v?.kind!=='tuple') throw new TypeError('statically known tuple required');
    values.push(...v.slots);
  }
  return {values,trace};
}
test('positional spreading evaluates every expression once and retains order', () => {
  const trace=[];
  const part=(label,value,spread=false)=>({spread,eval:()=>{trace.push(label);return value;}});
  const v=expandArguments([part('A',1),part('B',tuple(2,3),true),part('C',4)],trace);
  assert.deepEqual(v.values,[1,2,3,4]);
  assert.deepEqual(v.trace,['A','B','C']);
});
test('a record is not a positional spread and a tuple of records remains a tuple', () => {
  const r=record({x:1,y:2});
  assert.throws(()=>expandArguments([{spread:true,eval:()=>r}],[]),/statically known tuple/);
  assert.deepEqual(expandArguments([{spread:true,eval:()=>tuple(r)}],[]).values,[r]);
  assert.deepEqual(Object.values(r.fields),[1,2]); // forbidden legacy mutant's accidental result
});
test('checked conversion cannot silently reinterpret tuple as record or upgrade readonly',()=>{
  const mayCast=(source,target)=>source.kind===target.kind &&
    !(source.readonly && !target.readonly) &&
    (source.kind!=='tuple' || source.slots.length===target.slots.length);
  assert.equal(mayCast({kind:'tuple',slots:[1,2]}, {kind:'record',fields:{x:1,y:2}}),false);
  assert.equal(mayCast({kind:'record',readonly:true},{kind:'record',readonly:false}),false);
  assert.equal(mayCast({kind:'tuple',slots:[1,2]},{kind:'tuple',slots:[1]}),false);
});
