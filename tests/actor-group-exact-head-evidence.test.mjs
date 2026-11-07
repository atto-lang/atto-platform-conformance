import test from 'node:test';
import assert from 'node:assert/strict';
import {assessActorGroupEvidence,REQUIRED_CASES} from '../src/actor-group-exact-head-evidence.mjs';

const HEAD = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const NOW = '2026-11-07T18:00:00Z';
const stamp = '2026-11-07T17:00:00Z';
const repo = 'ores-truffle-oreslang/oreslang-source.java';
const step = phase => ({phase,conclusion:'success',started_at:stamp,completed_at:stamp});
const passing = () => ({
  backend:'java',repository:repo,head_sha:HEAD,execution_kind:'compiled_guest',
  run:{id:100,repository:repo,head_sha:HEAD,event:'pull_request',conclusion:'success',completed_at:stamp},
  job:{id:200,run_id:100,head_sha:HEAD,conclusion:'success',steps:
    ['compile_guest','execute_guest','assert_contract'].map(step)},
  source_tree_sha:TREE,artifact_sha256:'c'.repeat(64),assertions:[...REQUIRED_CASES]
});
const assess = receipt => assessActorGroupEvidence({backend:'java',expected_head_sha:HEAD,receipt,now:NOW});
const status = (receipt, desired) => assert.equal(assess(receipt).status,desired);

test('even complete caller-supplied receipts are candidates, never certified',()=>{
  assert.deepEqual(assess(passing()),{
    status:'EVIDENCE_CANDIDATE',
    reason:'REQUIRES_INDEPENDENT_PROVENANCE_AND_LOG_VERIFICATION',
    certified:false
  });
  const claimed=passing();claimed.certified=true;status(claimed,'EVIDENCE_CANDIDATE');
});

test('missing evidence, invalid backends and malformed expected SHA fail closed',()=>{
  status(null,'MISSING');
  assert.equal(assessActorGroupEvidence({backend:'unknown',expected_head_sha:HEAD,receipt:passing(),now:NOW}).status,'INVALID');
  assert.equal(assessActorGroupEvidence({backend:'java',expected_head_sha:'main',receipt:passing(),now:NOW}).status,'INVALID');
});

test('host-only, parser-only, negative no-IR do not prove guest execution',()=>{
  for(const [kind,want] of [['host_only','HOST_ONLY'],['parser_only','PARSER_ONLY'],['negative_no_ir','FAIL_CLOSED_ONLY']]) {
    const r=passing();r.execution_kind=kind;status(r,want);
  }
});

test('foreign repository, wrong SHA, wrong run head and unbound job rejected',()=>{
  for(const change of [
    r=>{r.repository='other/repo';},r=>{r.head_sha='f'.repeat(40);},
    r=>{r.run.head_sha='f'.repeat(40);},r=>{r.job.run_id=101;},
    r=>{r.run.event='push';}
  ]){const r=passing();change(r);assert.notEqual(assess(r).status,'EVIDENCE_CANDIDATE');}
});

test('zero steps, missing guest execution phase, failed and incomplete steps reject',()=>{
  const empty=passing();empty.job.steps=[];status(empty,'NOT_EXECUTED');
  const preRunner=passing();preRunner.job.steps=[];preRunner.run.conclusion='failure';preRunner.job.conclusion='failure';status(preRunner,'NOT_EXECUTED');
  const missing=passing();missing.job.steps=[step('compile_guest'),step('assert_contract')];status(missing,'NOT_CERTIFIED');
  const failed=passing();failed.job.steps[1].conclusion='failure';status(failed,'FAILED');
  const incomplete=passing();delete incomplete.job.steps[1].completed_at;status(incomplete,'NOT_CERTIFIED');
  const failRun=passing();failRun.run.conclusion='failure';status(failRun,'FAILED');
});

test('contract claims need every case exactly once plus tree and artifact provenance',()=>{
  const partial=passing();partial.assertions.pop();status(partial,'NOT_CERTIFIED');
  const repeated=passing();repeated.assertions.push(REQUIRED_CASES[0]);status(repeated,'NOT_CERTIFIED');
  const noTree=passing();delete noTree.source_tree_sha;status(noTree,'NOT_CERTIFIED');
  const noArtifact=passing();noArtifact.artifact_sha256='xx';status(noArtifact,'NOT_CERTIFIED');
});

test('undated, future and older than 48 hours are not current evidence',()=>{
  const old=passing();old.run.completed_at='2026-11-04T17:00:00Z';status(old,'NOT_CERTIFIED');
  const future=passing();future.run.completed_at='2026-11-08T17:00:00Z';status(future,'NOT_CERTIFIED');
  assert.equal(assessActorGroupEvidence({backend:'java',expected_head_sha:HEAD,receipt:passing()}).status,'NOT_CERTIFIED');
});

test('same exact-head gate applies to all five backends without aliasing Forge/Cranelift',()=>{
  for(const [backend,repository] of Object.entries({java:repo,llvm:'ores-truffle-oreslang/oreslang-source.llvm',wasm:'ores-truffle-oreslang/oreslang-source.wasm',forge:'ores-truffle-oreslang/oreslang-source.forge',net:'ores-truffle-oreslang/oreslang-source.net'})){
    const r=passing();r.repository=repository;r.backend=backend;r.run.repository=repository;
    assert.equal(assessActorGroupEvidence({backend,expected_head_sha:HEAD,receipt:r,now:NOW}).status,'EVIDENCE_CANDIDATE');
  }
});
