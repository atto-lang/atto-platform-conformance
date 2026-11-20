import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExternalBoundaries} from '../src/external-admission.mjs';

const authorities=['ORESoftware/api-docs','ORESoftware/typespec-json-schema-validator',
 'ORESoftware/ores-contracts','ORESoftware/ores-stack','ORESoftware/ores-interfaces'];
const edges=()=>authorities.flatMap((authority,i)=>[1,2].map(j=>({
 consumer:'ores-stack/integration-demo',authority,boundary:'bridge-'+i+'-'+j,
 contractPolicy:'independently-authored-typespec-plus-json-schema; generated-wit-protobuf-clients-are-derivative',
 admission:'blocked',evidence:'not-attested',sourceCommit:null,tjsvReceipt:null,
 compilerRuntimeReceipt:null,executedWorkflow:null
}))).sort((a,b)=>(a.consumer+'/'+a.authority+'/'+a.boundary).localeCompare(b.consumer+'/'+b.authority+'/'+b.boundary));
const doc=()=>({
 schemaVersion:1,status:'coordination-only',updatedAt:'2026-10-18',scope:'source-free',
 peerAuthorities:['human-authored TypeSpec','independently human-authored JSON Schema Draft 2020-12'],
 derivativeWitnesses:['TypeSpec-emitted JSON Schema','WIT','Protobuf','generated API clients','Oreslang bindings'],edges:edges()
});
const registry={organization:'ores-truffle-oreslang',repositories:[]};

test('cross-organization edges remain coordination-only even with complete authority coverage',()=>{
 const result=validateExternalBoundaries(doc(),registry);
 assert.equal(result.boundaries,10);
 assert.equal(result.authorities,5);
 assert.equal(result.status,'blocked');
});

test('a forged execution or compiler receipt cannot change blocked integration status',()=>{
 for(const mutate of [
  x=>{x.edges[0].admission='admitted';},
  x=>{x.edges[0].evidence='executed';},
  x=>{x.edges[0].sourceCommit='a'.repeat(40);},
  x=>{x.edges[0].tjsvReceipt='fake';},
  x=>{x.edges[0].compilerRuntimeReceipt='fake';},
  x=>{x.edges[0].executedWorkflow={runId:1};}
 ]){
  const x=doc();mutate(x);
  assert.throws(()=>validateExternalBoundaries(x,registry),/external admission:/);
 }
});

test('duplicate, foreign, missing authorities and derivative peer substitution fail closed',()=>{
 for(const mutate of [
  x=>{x.edges[1]=x.edges[0];},
  x=>{x.edges[0].authority='UnreviewedOrg/unknown';},
  x=>{x.edges[0].consumer='unapproved/internal';},
  x=>{x.peerAuthorities[0]='TypeSpec-emitted JSON Schema';},
  x=>{x.edges=x.edges.slice(0,9);}
 ]){
  const x=doc();mutate(x);
  assert.throws(()=>validateExternalBoundaries(x,registry),/external admission:/);
 }
});