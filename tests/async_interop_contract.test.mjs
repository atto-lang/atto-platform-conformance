import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';

// Source-free contract checks and pure reference model. NOT guest-source or AOT proof.
const ROOT = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');
const requiredBackends = ['java-graalvm', 'llvm', 'wasm', 'forge', 'net'];
const contracts = [
  ['future-task-interop', 'future-task-bidirectional-v1', 22],
  ['observable-future-task-interop', 'observable-future-task-interop-v1', 40],
];
for (const [dir, expected, count] of contracts) {
  test('pending manifest and fixture gate: ' + expected, () => {
    const root = 'fixtures/' + dir + '/v1/';
    const m = JSON.parse(read(root + 'manifest.json'));
    assert.equal(m.schemaVersion, 1);
    assert.equal(m.contract, expected);
    assert.equal(m.status, 'proposal-not-executable');
    assert.equal(m.sourceExecutionVerified, false);
    assert.equal(m.runtimeVerified, false);
    assert.equal(m.caseStatusDefault, 'pending');
    assert.deepEqual(m.evidence, []);
    assert.deepEqual(Object.keys(m.backendStatus).sort(), [...requiredBackends].sort());
    for (const state of Object.values(m.backendStatus)) assert.equal(state, 'pending');
    assert.equal(m.cases.length, count);
    assert.equal(new Set(m.cases.map(c => c.id)).size, count);
    for (const c of m.cases) {
      assert.equal(c.status, 'pending', c.id);
      assert.equal(c.verified, false, c.id);
      assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(Array.isArray(c.assert) && c.assert.length > 0, c.id);
      assert.equal(new Set(c.assert).size, c.assert.length);
      if (c.source) {
        assert.match(c.source, /^[a-z0-9-]+\.ores$/);
        const path = root + c.source;
        assert.ok(existsSync(resolve(ROOT, path)), path);
        const source = read(path);
        assert.match(source, /pub fnc main\(\): void/);
        assert.doesNotMatch(source, /Future\.new\(\s*task\s*\{/);
      }
    }
  });
}
test('canonical source surface and error/cardinality contracts', () => {
  const doc = read('docs/OBSERVABLE_FUTURE_TASK_INTEROP_V1.md');
  const parent = read('docs/FUTURE_TASK_INTEROP_V1.md');
  for (const s of ['Observable.from_future(', 'Observable.from_task(',
    'f.to_obs()', 't.to_obs()', 'Future.from_observable(',
    'Task.from_observable(', 'mode=#single', 'mode=#first',
    'Future<Option<T>>', 'Task<Option<T>>', 'EmptyObservableError',
    'TooManyElementsError', 'on_complete']) {
    assert.ok(doc.includes(s), 'missing contract: ' + s);
  }
  assert.ok(parent.includes('OBSERVABLE_FUTURE_TASK_INTEROP_V1.md'));
  assert.doesNotMatch(doc, /Future\.new\(task\s*\{/);
});
// The model proves ONLY its own transition policy. Real scheduler races remain
// unverified until compiled Oreslang and per-backend runtime tests execute.
class Reducer {
  constructor(mode) {
    assert.ok(['first','single'].includes(mode));
    this.mode = mode;
    this.registered = false;
    this.terminalStaged = false;
    this.staged = [];
    this.result = null;
    this.one = undefined;
    this.seen = false;
    this.detach = null;
    this.detaches = 0;
    this.callbacksDrained = false;
    this.cancelledProducer = false;
  }
  subscribe(registrar) {
    assert.equal(this.registered, false);
    try {
      const detach = registrar(e => this.next(e));
      if (typeof detach !== 'function') throw new Error('InvalidRegistration');
      this.detach = detach;
      this.registered = true;
      const staged = this.staged;
      this.staged = [];
      for (const e of staged) this.apply(e);
    } catch {
      this.staged = [];
      this.registered = true;
      this.result = {state:'FAILED', error:'InvalidRegistration'};
    }
    return this;
  }
  next(e) {
    if (this.result || this.terminalStaged) return;
    if (!this.registered) {
      assert.ok(this.staged.length < 2, 'registration buffer may not grow');
      this.staged.push(e);
      const values = this.staged.filter(v => v.kind === 'next').length;
      if (e.kind !== 'next' || (this.mode === 'first' && values === 1)
          || (this.mode === 'single' && values === 2)) this.terminalStaged = true;
    } else this.apply(e);
  }
  apply(e) {
    if (this.result) return;
    if (e.kind === 'next') {
      if (this.mode === 'first') this.finish({state:'SUCCESS', value:{some:e.value}});
      else if (!this.seen) {this.seen=true;this.one=e.value;}
      else this.finish({state:'FAILED', error:'TooManyElementsError'});
    } else if (e.kind === 'complete') {
      if (this.mode === 'first') this.finish({state:'SUCCESS', value:{none:true}});
      else if (this.seen) this.finish({state:'SUCCESS',value:this.one});
      else this.finish({state:'FAILED',error:'EmptyObservableError'});
    } else if (e.kind === 'error') this.finish({state:'FAILED',error:e.error});
    else if (e.kind === 'cancel') this.finish(e.authenticated ?
      {state:'CANCELLED'} : {state:'FAILED',error:'CancellationException'});
    else throw Error('BadEvent');
  }
  finish(outcome) {
    if (this.result) return;
    if (this.detach) {
      try {this.detach();this.detaches++;} catch {
        this.result={state:'FAILED',error:'SubscriptionCleanupFailure'};
        return;
      }
    }
    this.result=outcome;
  }
  get physicallyRetired() {
    return Boolean(this.result && this.callbacksDrained &&
      !['InvalidRegistration','SubscriptionCleanupFailure'].includes(this.result.error));
  }
}
const value = x => ({kind:'next',value:x});
const complete = {kind:'complete'};
const error = x => ({kind:'error',error:x});
const cancel = {kind:'cancel',authenticated:true};
function scenario(mode,events,valid=true) {
  let emit; let detached=0;
  const r = new Reducer(mode).subscribe(callback => {
    emit=callback;
    for (const e of events) emit(e);
    return valid ? () => {detached++;} : null;
  });
  return {r,emit,detached:()=>detached};
}
test('single waits for on_complete; empty and second fail', () => {
  const x=scenario('single',[value(42)]);
  assert.equal(x.r.result,null);
  x.emit(complete);
  assert.deepEqual(x.r.result,{state:'SUCCESS',value:42});
  assert.deepEqual(scenario('single',[complete]).r.result,
    {state:'FAILED',error:'EmptyObservableError'});
  assert.deepEqual(scenario('single',[value(1),value(2)]).r.result,
    {state:'FAILED',error:'TooManyElementsError'});
});
test('first is Option; unsubscribe at first, empty yields None', () => {
  const x=scenario('first',[value(3),value(4),error('late')]);
  assert.deepEqual(x.r.result,{state:'SUCCESS',value:{some:3}});
  assert.equal(x.detached(),1);
  assert.deepEqual(scenario('first',[complete]).r.result,
    {state:'SUCCESS',value:{none:true}});
});
test('registration failure defeats synchronous success; quiescence separate', () => {
  assert.deepEqual(scenario('single',[value(9),complete],false).r.result,
    {state:'FAILED',error:'InvalidRegistration'});
  const x=scenario('single',[value(5),complete]);
  assert.equal(x.r.physicallyRetired,false);
  x.emit(cancel);x.emit(value(99));
  assert.equal(x.detached(),1);
  assert.equal(x.r.cancelledProducer,false);
  x.r.callbacksDrained=true;
  assert.equal(x.r.physicallyRetired,true);
});
test('authorized cancellation differs from user-thrown cancellation error', () => {
  assert.deepEqual(scenario('single',[cancel]).r.result,{state:'CANCELLED'});
  assert.deepEqual(scenario('single',[{kind:'cancel',authenticated:false}]).r.result,
    {state:'FAILED',error:'CancellationException'});
});
test('enumerate 1562 terminal/event orderings; one-shot, bounded, no producer cancel', () => {
  const events=[value(1),value(2),complete,error('E'),cancel];
  for (const mode of ['single','first']) {
    let count=0;
    const walk=(prefix,depth)=>{
      const x=scenario(mode,prefix);
      assert.ok(x.r.staged.length <= 2);
      assert.ok(x.detached() <= 1);
      assert.equal(x.r.cancelledProducer,false);
      const initial=x.r.result;
      if (initial) {
        x.emit(value(99));x.emit(complete);
        assert.deepEqual(x.r.result,initial);
      }
      count++;
      if (depth<4) for (const e of events) walk([...prefix,e],depth+1);
    };
    walk([],0);
    assert.equal(count,781);
  }
});

test('reference trace vectors agree with the independent terminal reducer', () => {
  const vectors = JSON.parse(read('fixtures/observable-future-task-interop/v1/reference-traces.json'));
  assert.equal(vectors.schemaVersion,1);
  assert.equal(vectors.contract,'observable-future-task-traces-v1');
  assert.equal(vectors.status,'reference-model-only-not-backend-verified');
  assert.equal(vectors.modeRequired,true);
  assert.ok(vectors.records.length >= 14);
  const seen = new Set();
  for (const row of vectors.records) {
    assert.equal(seen.has(row.id), false, row.id);
    seen.add(row.id);
    const events = row.events.map(([kind,payload]) => {
      if (kind === 'next') return value(payload);
      if (kind === 'complete') return complete;
      if (kind === 'error') return error(payload);
      if (kind === 'cancel') return {kind:'cancel',authenticated:payload==='authorized'};
      throw Error('bad reference event');
    });
    const x = scenario(row.mode,events);
    const outcome = x.r.result ?? {state:'PENDING'};
    assert.deepEqual(outcome,row.expected,row.id);
    assert.ok(x.detached() <= 1);
    assert.equal(x.r.cancelledProducer,false);
  }
});
