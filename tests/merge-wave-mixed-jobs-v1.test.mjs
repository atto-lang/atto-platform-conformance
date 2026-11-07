// Negative tests for mixed GitHub jobs and short-lived private fetch token.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonicalizeMergeEvidence} from '../tools/merge-wave-canonical-evidence-v1.mjs';

const R='ores-truffle-oreslang/oreslang-source.java';
const H='a'.repeat(40),B='b'.repeat(40),T='c'.repeat(40);
const executed={run_id:100,attempt:1,job_id:201,runner_id:801,steps_count:4,state:'RUNNER_EXECUTED_SUCCESS'};
const absent={run_id:100,attempt:1,job_id:202,runner_id:null,steps_count:0,state:'NOT_EXECUTED'};
const failed={run_id:100,attempt:1,job_id:203,runner_id:803,steps_count:3,state:'RUNNER_EXECUTED_NON_SUCCESS'};
const input=jobs=>({
 audit:{schema_version:1,target:{repo:R,number:7},observed_at:'2026-11-06T22:30:00Z',
  facts:{head_sha:H,base_sha:B,tree_sha:T},gates:{review:{status:'BLOCKED'}},
  blockers:['REVIEW_GATE_BLOCKED'],status:'BLOCKED',
  merge_authorized:false,compiler_guest_certified:false},
 live:{schema:1,target:{repo:R,number:7,head_sha:H,base_sha:B,tree_sha:T},
  as_of:'2026-11-06T22:30:00Z',status:'BLOCKED',merge_authorized:false,guest_certified:false,
  reviews:{complete:true,observed:0},check_runs:{complete:true},workflow_runs:{complete:true},
  executions:jobs.map(x=>({...x})),gaps:['MAIN_NOT_PROTECTED']}
});
const evaluate=jobs=>canonicalizeMergeEvidence(input(jobs));
const mix=jobs=>{const r=evaluate(jobs);
 assert.equal(r.ci.classification,'MIXED_OR_INCOMPLETE');
 assert.equal(r.ci.execution_verified,false);
 assert.equal(r.merge_authorized,false);
 return r;
};
const workflow=()=>readFileSync('.github/workflows/merge-wave-real-five-gates-v1.yml','utf8');

test('single stepful success remains reported, never attested',()=>{
 const r=evaluate([executed]);
 assert.equal(r.ci.classification,'REPORTED_EXECUTION_UNATTESTED');
 assert.equal(r.ci.execution_verified,false);
});
test('multiple runnerless zero-step jobs stay NOT_EXECUTED',()=>{
 const r=evaluate([absent,{...absent,run_id:101,job_id:205}]);
 assert.equal(r.ci.classification,'NOT_EXECUTED');
});
test('success then zero-step job must be MIXED',()=>mix([executed,absent]));
test('zero-step then success must be MIXED',()=>mix([absent,executed]));
test('success then failed job must be MIXED',()=>mix([executed,failed]));
test('failed then success must be MIXED',()=>mix([failed,executed]));
test('invalid second job cannot be concealed by successful job',()=>{
 const r=mix([executed,{...absent,job_id:'202'}]);
 assert(r.blockers.includes('JOB_ENTRY_INVALID'));assert.equal(r.contract_valid,false);
});
test('duplicate job across attempts cannot be concealed by success',()=>{
 const r=mix([executed,{...absent,attempt:2,job_id:201}]);
 assert(r.blockers.includes('JOB_IDENTITY_DUPLICATE'));assert.equal(r.contract_valid,false);
});
test('contradictory second successful job with zero steps is MIXED',()=>{
 const r=mix([executed,{...absent,job_id:207,runner_id:900,
  steps_count:0,state:'RUNNER_EXECUTED_SUCCESS'}]);
 assert(r.blockers.includes('JOB_EVIDENCE_CONTRADICTORY'));
});
test('two fully stepful successes remain unverified reported success',()=>{
 const r=evaluate([executed,{...executed,run_id:101,job_id:211,runner_id:811}]);
 assert.equal(r.ci.classification,'REPORTED_EXECUTION_UNATTESTED');
 assert.equal(r.contract_valid,true);assert.equal(r.ci.execution_verified,false);
});
test('three-way positive, zero-step and failed remain MIXED',()=>mix([executed,absent,failed]));
test('failed-only job is never summarized as reported successful',()=>{
 assert.equal(evaluate([failed]).ci.classification,'MIXED_OR_INCOMPLETE');
});
test('empty inventory is UNOBSERVED and never authorizes release',()=>{
 const r=evaluate([]);
 assert.equal(r.ci.classification,'UNOBSERVED');assert.equal(r.merge_authorized,false);
});
test('checkout never persists credential to PR-head test workspace',()=>{
 const y=workflow();
 assert.match(y,/persist-credentials:\s*false/);
 assert.doesNotMatch(y,/persist-credentials:\s*true/);
});
test('fetch credential is scoped to one read-only immutable Git fetch step',()=>{
 const y=workflow(),fetch=y.slice(y.indexOf('      - name: Fetch immutable'),
 y.indexOf('      - name: Use pinned Node.js'));
 assert.match(fetch,/FETCH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
 assert.match(fetch,/GIT_CONFIG_COUNT=1/);
 assert.match(fetch,/GIT_CONFIG_KEY_0=/);
 assert.match(fetch,/GIT_CONFIG_VALUE_0=/);
 assert.doesNotMatch(fetch,/git\s+-c\s+http\.[^\s]*extraheader=/);
});
test('credential and local Git extraheader absent before running Node',()=>{
 const y=workflow(),fetch=y.slice(y.indexOf('      - name: Fetch immutable'),
 y.indexOf('      - name: Use pinned Node.js')),
 execute=y.slice(y.indexOf('      - name: Execute pinned real-gate'));
 assert.match(fetch,/unset\s+FETCH_TOKEN/);
 assert.match(fetch,/unset\s+fetch_auth/);
 assert.match(fetch,/git config --local --get-regexp/);
 assert.match(execute,/test -z "\$\{GITHUB_TOKEN:-\}"/);
 assert.match(execute,/test -z "\$\{GH_TOKEN:-\}"/);
 assert.doesNotMatch(execute,/\$\{\{\s*github\.token\s*\}\}/);
});
test('workflow remains original-head, read-only, SHA-pinned and not target privileged',()=>{
 const y=workflow();
 assert.match(y,/permissions:\s*\n\s+contents:\s*read/);
 assert.match(y,/actions\/checkout@[a-f0-9]{40}/);
 assert.match(y,/actions\/setup-node@[a-f0-9]{40}/);
 assert.match(y,/github\.event\.pull_request\.head\.sha/);
 assert.doesNotMatch(y,/git\s+push\b/);
 assert.doesNotMatch(y,/pull_request_target:/);
});
test('Node workflow requires exactly 158 tests and no failures',()=>{
 const y=workflow();
 assert.match(y,/node --test tests\/merge-wave-real-five-gates-v1\.test\.mjs tests\/merge-wave-mixed-jobs-v1\.test\.mjs/);
 assert(y.includes("grep -Eq '^# tests 158$'"));
 assert(y.includes("grep -Eq '^# pass 158$'"));
 assert(y.includes("grep -Eq '^# fail 0$'"));
});
