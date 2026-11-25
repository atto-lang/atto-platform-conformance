import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePipelineContract,PIPELINE_BACKENDS,PIPELINE_OPERATIONS} from '../src/pipeline-contract.mjs';
const dir=new URL('../contracts/pipeline/v1/',import.meta.url);
const fixture=JSON.parse(await readFile(new URL('three-actor.json',dir)));
const clone=()=>structuredClone(fixture);
const check=x=>validatePipelineContract(x);
const deny=(x,pattern)=>{const r=check(x);assert.equal(r.ok,false);if(pattern)assert.match(r.errors.join(' | '),pattern);};

test('three-stage two-direction nominal pipeline proposal admits, without declaring backend support',()=>{
 assert.deepEqual(check(fixture),{ok:true,errors:[]});
 assert.deepEqual(fixture.confirmedBackends,[]);
 assert.deepEqual(fixture.pendingBackends,PIPELINE_BACKENDS);
 assert.deepEqual(fixture.operations,PIPELINE_OPERATIONS);
});
test('source/transform/sink roles are nominal and supervisors/ordinary actors cannot enter DATA chain',()=>{
 for(const [index,role] of [[0,'supervisor'],[1,'ordinary'],[2,'transform'],[0,'writable']]){
  const x=clone();x.stages[index].role=role;deny(x,/role/);
 }
});
test('both directions are typed and independently checked on every hop',()=>{
 for(const [edge,key,value] of [[0,'forwardType','Message.Other'],[1,'backwardType','Message.Other'],[0,'forwardType','any'],[1,'backwardType','']]){
  const x=clone();x.edges[edge][key]=value;deny(x,/type|nominal/);
 }
 for(const [index,key,value] of [[1,'forwardIn','Message.Different'],[1,'backwardOut','Message.Different'],[0,'backwardIn','Message.Different'],[2,'forwardIn','Message.Different']]){
  const x=clone();x.stages[index][key]=value;deny(x,/mismatch/);
 }
});
test('only adjacent ordered acyclic edges and unique owned IDs are admitted',()=>{
 let x=clone();x.edges[1].to='source';deny(x,/adjacent/);
 x=clone();x.edges[0].from='sink';deny(x,/adjacent/);
 x=clone();x.stages[1].id='source';deny(x,/duplicate/);
 x=clone();x.edges.splice(1,1);deny(x,/dense|exactly connected/);
});
test('bounded backpressure and restricted endpoint directions',()=>{
 for(const value of [0,257,-1,1.5,NaN]){
  const x=clone();x.edges[1].capacity=value;deny(x,/capacity/);
 }
 for(const [index,key,value] of [[0,'forwardIn','Message.Compute'],[0,'backwardOut','Message.Result'],[2,'forwardOut','Message.Compute'],[2,'backwardIn','Message.Result']]){
  const x=clone();x.stages[index][key]=value;deny(x,/must be null/);
 }
});
test('explicit self.forward and self.backward, correlation, publication, generation and supervisor separation are mandatory',()=>{
 let x=clone();x.operations.backward='self.respond';deny(x,/operations/);
 x=clone();x.semantics.backwardCorrelation='ambient';deny(x,/semantics/);
 x=clone();x.semantics.supervisorDataRouting=true;deny(x,/semantics/);
 x=clone();x.semantics.generationFencing=false;deny(x,/semantics/);
 x=clone();x.semantics.atomicPublication=false;deny(x,/semantics/);
});
test('pending backend outcomes cannot be silently reclassified as verified',()=>{
 let x=clone();x.confirmedBackends=['llvm'];deny(x,/pending/);
 x=clone();x.pendingBackends=['llvm'];deny(x,/pending/);
});
test('unknown properties, arrays with holes/method spoofing and getter fields fail closed without invoking accessors',()=>{
 let x=clone();x.unknown=true;deny(x,/closed/);
 x=clone();x.stages[1].sideChannel='supervisor';deny(x,/closed/);
 x=clone();x.stages.length=4;deny(x,/dense/);
 x=clone();x.edges.map=()=>[];deny(x,/dense/);
 let invoked=0;x=clone();Object.defineProperty(x.edges[0],'capacity',{get(){invoked++;return 1},enumerable:true});deny(x,/closed/);assert.equal(invoked,0);
 x=clone();Object.defineProperty(x,'stages',{get(){invoked++;return []},enumerable:true});deny(x,/closed/);assert.equal(invoked,0);
 x=clone();Object.defineProperty(x.stages[0],'forwardOut',{get(){invoked++;return 'Message.Compute'},enumerable:true});deny(x,/closed/);assert.equal(invoked,0);
});
test('schema and TypeSpec vocabularies synchronize with runtime admission',async()=>{
 const schema=JSON.parse(await readFile(new URL('pipeline-graph.schema.json',dir)));
 const tsp=await readFile(new URL('actor-pipeline.tsp',dir),'utf8');
 assert.equal(schema.$schema,'https://json-schema.org/draft/2020-12/schema');
 assert.equal(schema.additionalProperties,false);
 assert.equal(schema.properties.schemaVersion.const,fixture.schemaVersion);
 assert.equal(schema.properties.kind.const,fixture.kind);
 assert.equal(schema.properties.operations.properties.forward.const,PIPELINE_OPERATIONS.forward);
 assert.equal(schema.properties.operations.properties.backward.const,PIPELINE_OPERATIONS.backward);
 assert.equal(schema.properties.confirmedBackends.const.length,0);
 assert.deepEqual(schema.properties.pendingBackends.const,PIPELINE_BACKENDS);
 assert.deepEqual(schema.$defs.stage.properties.role.enum,['readable','transform','writable']);
 assert.equal(schema.$defs.edge.properties.capacity.maximum,256);
 for(const role of schema.$defs.stage.properties.role.enum)assert.ok(tsp.includes(role+': "'+role+'"'));
 for(const op of Object.values(PIPELINE_OPERATIONS))assert.ok(tsp.includes('"'+op+'"'));
 for(const tag of ['PipelineProposal','PipelineStage','PipelineEdge','PipelineSemantics'])assert.ok(tsp.includes('model '+tag));
});

import {admitPipelineContract} from '../src/pipeline-admission.mjs';

test('admission returns a deep-frozen owned graph independent from caller mutation',()=>{
 const input=clone();
 const admitted=admitPipelineContract(input);
 assert.equal(admitted.ok,true,admitted.errors.join('; '));
 const a=admitted.contract;
 assert.notStrictEqual(a,input);
 assert.notStrictEqual(a.stages,input.stages);
 assert.notStrictEqual(a.stages[1],input.stages[1]);
 assert.notStrictEqual(a.edges,input.edges);
 assert.ok(Object.isFrozen(a)&&Object.isFrozen(a.operations)&&Object.isFrozen(a.semantics));
 assert.ok(Object.isFrozen(a.stages)&&Object.isFrozen(a.stages[0])&&Object.isFrozen(a.edges[0]));
 assert.ok(Object.isFrozen(a.confirmedBackends)&&Object.isFrozen(a.pendingBackends));
 input.stages[1].forwardIn='Message.Escalated';
 input.edges[0].capacity=9999;
 input.edges[0].to='sink';
 input.operations.forward='self.respond';
 input.pendingBackends.pop();
 assert.deepEqual(validatePipelineContract(a),{ok:true,errors:[]});
 assert.equal(a.stages[1].forwardIn,'Message.Compute');
 assert.equal(a.edges[0].capacity,8);
 assert.equal(a.edges[0].to,'transform');
 assert.equal(a.operations.forward,'self.forward');
 assert.deepEqual(a.pendingBackends,PIPELINE_BACKENDS);
 assert.throws(()=>{a.stages[1].forwardIn='Message.Escalated'},TypeError);
 assert.throws(()=>{a.edges[0].capacity=9999},TypeError);
 assert.throws(()=>{a.edges.push({})},TypeError);
});

test('admission refuses accessor descriptors before invocation, including nested and inherited fields',()=>{
 let getters=0;
 for(const [container,key] of [
  [x=>x,'operations'],[x=>x.operations,'forward'],[x=>x.stages[0],'forwardOut'],
  [x=>x.edges[0],'capacity'],[x=>x.semantics,'generationFencing']
 ]){
  const input=clone(),target=container(input);
  Object.defineProperty(target,key,{enumerable:true,configurable:true,get(){getters++;throw Error('getter executed')}});
  const admitted=admitPipelineContract(input);
  assert.equal(admitted.ok,false);
  assert.equal(Object.hasOwn(admitted,'contract'),false);
 }
 assert.equal(getters,0);
 const inherited=Object.assign(Object.create(fixture),{});
 assert.equal(admitPipelineContract(inherited).ok,false);
});

test('admission rejects non-JSON authority arrays and metadata, without invoking accessor slots',()=>{
 let getters=0;
 const cases=[
  x=>{x.stages.length=4;},
  x=>{x.edges.map=()=>[];},
  x=>{Object.defineProperty(x.edges,'0',{enumerable:true,get(){getters++;return fixture.edges[0]}});},
  x=>{Object.defineProperty(x,'kind',{value:x.kind,enumerable:false});},
  x=>{Object.defineProperty(x.stages[1],'id',{value:x.stages[1].id,enumerable:false});},
  x=>{x.stages[1][Symbol('authority')]=true;},
  x=>{x.edges[1].capacity=0;},
  x=>{x.confirmedBackends=['llvm'];}
 ];
 for(const mutate of cases){
  const input=clone();mutate(input);
  const r=admitPipelineContract(input);
  assert.equal(r.ok,false);
  assert.equal(Object.hasOwn(r,'contract'),false);
 }
 assert.equal(getters,0);
});
