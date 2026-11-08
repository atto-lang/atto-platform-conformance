#!/usr/bin/env node
/** Structural verifier only; checks do not authenticate GitHub Actions or certify a guest. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MANIFEST=path.join(ROOT,'contracts/cooperative-execution-v1.json');
const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^[0-9a-f]{64}$/;
const GITHUB_RUN=/^https:\/\/github\.com\/atto-lang\/atto-source\.(java|llvm|wasm|forge|net|js)\/actions\/runs\/([1-9][0-9]*)$/;
const CANONICAL_CASES=new Map([
  ['hot-path-127-no-slow-poll',['runtime','only-one-slow-poll-at-128']],
  ['interval-512-amortization',['runtime','only-one-slow-poll-at-512']],
  ['counter-overflow-mask',['runtime','poll-after-unsigned-wrap']],
  ['infinite-loop-fuel-denial',['security','actor-stops-without-refuel']],
  ['nested-loop-cost-coverage',['runtime','nested-backedges-charged']],
  ['continue-break-backedge-coverage',['compiler','all-cycles-metered']],
  ['recursion-and-stack-budget',['compiler','recursive-scc-metered-and-stack-bounded']],
  ['straight-line-weighted-block',['runtime','expensive-block-exhausts-fuel']],
  ['cancellation-at-next-poll',['runtime','cancel-observed-within-poll-interval']],
  ['await-resume-budget-conserved',['security','no-budget-reset-across-resume']],
  ['cross-carrier-cpu-debt',['security','cpu-deltas-summed-across-carriers']],
  ['wall-deadline-exact-boundary',['security','deadline-at-equality-denied']],
  ['critical-region-no-unsafe-yield',['security','yield-deferred-denial-not-deferred']],
  ['actor-local-budget-isolation',['security','actor-budget-not-shared']],
  ['untrusted-ffi-hard-kill',['security','independent-boundary-terminates-hostile-guest']],
  ['post-opt-safepoint-preservation',['compiler','metered-cycles-retained-after-optimization']],
  ['worker-termination-neighbor-survives',['security','worker-terminated-neighbor-unaffected']]
]);
const REQUIRED_PASSED_FIELDS=[
  'backend','case_id','head_sha','tree_sha','artifact_sha256','fixture_sha256',
  'workflow_run_id','workflow_attempt','job_id','workflow_url','executed_job_steps',
  'guest_executed','evidence_kind','command','observed','exit_code'
];
const REQUIRED_BOUNDARY_CASES=[
  'untrusted-ffi-hard-kill','worker-termination-neighbor-survives'
];
export class EvidenceError extends Error {}
const req=(ok,msg)=>{if(!ok)throw new EvidenceError(msg);};
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const pos=x=>Number.isSafeInteger(x)&&x>0;
export function validateManifest(m){
  req(m&&typeof m==='object'&&!Array.isArray(m),'manifest');
  req(m.schema==='atto.cooperative-execution.v1'&&m.version===1,'schema');
  req(m.status==='SPECIFICATION_AND_HOST_MODEL_ONLY_NOT_GUEST_EXECUTED','not-executed-baseline');
  const keys=['java','llvm','wasm','forge','net','js'];
  req(Object.keys(m.backends||{}).sort().join(',')===keys.sort().join(','),'backend-set');
  for(const key of keys){
    req(m.backends[key].repository==='atto-lang/atto-source.'+key,'backend-repository');
    req(m.backends[key].status==='NOT_EXECUTED','backend-must-not-claim-guest');
  }
  const p=m.polling;
  req(p&&p.default_interval===128&&p.counter_bits===64,'poll-policy');
  req(Array.isArray(p.allowed_intervals)&&p.allowed_intervals.join(',')==='32,64,128,256,512','poll-policy-intervals');
  req(Array.isArray(m.invariants)&&m.invariants.length>=8,'invariants');
  req(Array.isArray(m.cases)&&m.cases.length===CANONICAL_CASES.size,'case-count');
  const cases=new Map();
  for(const c of m.cases){
    req(c&&nonempty(c.id)&&nonempty(c.expect)&&
        ['runtime','compiler','security'].includes(c.kind)&&!cases.has(c.id),'case');
    const pinned=CANONICAL_CASES.get(c.id);
    req(pinned&&c.kind===pinned[0]&&c.expect===pinned[1],'case-contract-downgrade');
    cases.set(c.id,c);
  }
  req(m.evidence&&Array.isArray(m.evidence.states)&&
    m.evidence.states.join(',')==='passed,failed,unsupported,not_executed','evidence-states');
  req(Array.isArray(m.evidence.required_passed_fields)&&
      m.evidence.required_passed_fields.length===REQUIRED_PASSED_FIELDS.length&&
      REQUIRED_PASSED_FIELDS.every(k=>m.evidence.required_passed_fields.includes(k)),
      'evidence-fields-downgrade');
  req(Array.isArray(m.evidence.boundary_required_for)&&
      m.evidence.boundary_required_for.length===REQUIRED_BOUNDARY_CASES.length&&
      REQUIRED_BOUNDARY_CASES.every(k=>m.evidence.boundary_required_for.includes(k)),
      'boundary-policy-downgrade');
  return cases;
}
export function validateReceipt(r,m){
  const cases=validateManifest(m);
  req(r&&typeof r==='object'&&!Array.isArray(r),'receipt');
  req(Object.hasOwn(m.backends,r.backend),'unknown-backend');
  req(cases.has(r.case_id),'unknown-case');
  req(m.evidence.states.includes(r.status),'unknown-status');
  if(r.status==='unsupported'||r.status==='not_executed'){
    req(nonempty(r.reason)&&r.guest_executed!==true&&r.evidence_kind!=='compiled-guest',
        'nonexecution-must-not-claim-guest');
    return 'NON_PROMOTING';
  }
  if(r.status==='failed'){
    req(nonempty(r.reason),'failure-needs-reason');
    return 'NON_PROMOTING';
  }
  for(const key of m.evidence.required_passed_fields)
    req(Object.hasOwn(r,key),'missing:'+key);
  req(r.guest_executed===true&&r.evidence_kind==='compiled-guest','guest-execution-required');
  for(const k of ['head_sha','tree_sha'])req(SHA40.test(r[k]),'invalid:'+k);
  for(const k of ['artifact_sha256','fixture_sha256'])req(SHA256.test(r[k]),'invalid:'+k);
  req(pos(r.workflow_run_id)&&pos(r.workflow_attempt)&&pos(r.job_id),'nonzero-job-provenance');
  req(pos(r.executed_job_steps),'zero-step-run');
  const match=typeof r.workflow_url==='string'&&r.workflow_url.match(GITHUB_RUN);
  req(match&&match[1]===r.backend&&Number(match[2])===r.workflow_run_id,'wrong-workflow-target');
  req(nonempty(r.command),'missing-command');
  req(r.observed===cases.get(r.case_id).expect,'unverified-outcome');
  req(Number.isSafeInteger(r.exit_code)&&r.exit_code===0,'nonzero-exit');
  if(m.evidence.boundary_required_for.includes(r.case_id)){
    req(['os-process','validated-wasm-isolate','hardware-compartment'].includes(r.enforced_boundary),'no-independent-boundary');
    req(r.independent_termination_tested===true&&r.neighbor_survived===true,'no-verified-kill');
  }
  return 'STRUCTURE_ONLY_NOT_CERTIFIED';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length>3)throw new EvidenceError('usage: verify_cooperative_execution.mjs [receipt.json]');
    const m=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
    validateManifest(m);
    if(process.argv[2]){
      console.log(validateReceipt(JSON.parse(fs.readFileSync(process.argv[2],'utf8')),m));
    }else console.log('CONTRACT STRUCTURE VALID; NO BACKEND GUEST EXECUTION CERTIFIED');
  }catch(e){console.error('INVALID: '+e.message);process.exitCode=1;}
}
