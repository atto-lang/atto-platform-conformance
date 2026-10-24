import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAdmission,collectAdmission} from '../bin/diagnose-prestep-admission.mjs';
const SHA='a'.repeat(40), ID=1200000111, RID=4011110001;
const run=()=>({id:RID,head_sha:SHA,run_attempt:1,status:'completed',conclusion:'failure'});
const job=()=>({id:ID,head_sha:SHA,run_id:RID,run_attempt:1,status:'completed',conclusion:'failure',name:'native-smoke',steps:[]});
const args=(message)=>({run:run(),jobs:[job()],annotations:{[ID]:{access:'read',items:[{message}]}}});
test('billing annotation is only an unverified hint, never root cause',()=>{
 const x=summarizeAdmission(args('The job was not started because account spending limit was reached'));
 assert.deepEqual(x.jobs[0].unverifiedHints,['BILLING_OR_SPENDING']);
 assert.equal(x.rootCauseConfirmed,false);assert.equal(x.compilerTestsExecuted,false);
 assert.equal(x.privateSourceTransferAuthorized,false);
 assert.equal(JSON.stringify(x).includes('account spending limit'),false);
});
test('Actions organization policy is a different provisional category',()=>{
 const x=summarizeAdmission(args('Job not allowed by organization policy'));
 assert.deepEqual(x.jobs[0].unverifiedHints,['ACTIONS_POLICY']);
});
test('runner capacity is a different provisional category',()=>{
 const x=summarizeAdmission(args('No matching labels for runner group'));
 assert.deepEqual(x.jobs[0].unverifiedHints,['RUNNER_CAPACITY']);
});
test('unrelated annotations do not invent quota root cause',()=>{
 const x=summarizeAdmission(args('The workflow could not be executed.'));
 assert.deepEqual(x.jobs[0].unverifiedHints,[]);
 assert.equal(x.zeroStepJobCount,1);
});
test('annotation not accessible is not interpreted as an empty annotation',()=>{
 const a=args('hidden');a.annotations[ID]={access:'unavailable'};
 const x=summarizeAdmission(a);
 assert.equal(x.jobs[0].annotationCount,null);
 assert.equal(x.jobs[0].annotationAccess,'unavailable');
});
test('real executed failing test does not get pre-run conclusion',()=>{
 const a=args('billing limit');
 a.jobs[0].steps=[{name:'npm test',status:'completed',conclusion:'failure'}];
 const x=summarizeAdmission(a);
 assert.equal(x.zeroStepJobCount,0);assert.deepEqual(x.jobs[0].unverifiedHints,[]);
});
test('mismatched SHA, attempt and job IDs fail closed',()=>{
 const a=args('billing');
 a.jobs[0].head_sha='b'.repeat(40);
 assert.throws(()=>summarizeAdmission(a),/identity mismatch/);
 a.jobs[0].head_sha=SHA;a.jobs[0].run_attempt=2;
 assert.throws(()=>summarizeAdmission(a),/identity mismatch/);
 a.jobs[0].run_attempt=1;a.jobs.push({...job()});
 assert.throws(()=>summarizeAdmission(a),/duplicate/);
});
test('unread or malformed annotations cannot count as observed',()=>{
 const a=args('spending');delete a.annotations[ID];
 assert.throws(()=>summarizeAdmission(a),/annotation record/);
 a.annotations[ID]={access:'read',items:[{}]};
 assert.throws(()=>summarizeAdmission(a),/truncated annotation/);
});
test('read-only collector preserves run head and redacts sensitive check text',async()=>{
 const requests=[];
 const requester=async path=>{
   requests.push(path);
   if(path.endsWith('/jobs?filter=latest&per_page=100&page=1'))return {total_count:1,jobs:[job()]};
   if(path.includes('/check-runs/'))return [{message:'Billing payment denied; secret=PRIVATE_ABC'}];
   if(path.endsWith('/actions/runs/'+RID))return run();
   throw Error('unexpected network request');
 };
 const x=await collectAdmission('orestruffle/conformance',RID,requester);
 assert.equal(x.zeroStepJobCount,1);
 assert.deepEqual(x.jobs[0].unverifiedHints,['BILLING_OR_SPENDING']);
 assert.equal(JSON.stringify(x).includes('PRIVATE_ABC'),false);
 assert.equal(requests.length,4);
});
test('annotation access failures remain explicitly unavailable',async()=>{
 const requester=async path=>{
   if(path.includes('/jobs?'))return {total_count:1,jobs:[job()]};
   if(path.includes('/check-runs/'))throw Error('forbidden');
   return run();
 };
 const x=await collectAdmission('orestruffle/conformance',RID,requester);
 assert.equal(x.jobs[0].annotationAccess,'unavailable');
});
test('changing run identity aborts, rather than attributing stale annotations',async()=>{
 let n=0;
 const requester=async path=>{
   if(path.includes('/jobs?'))return {total_count:1,jobs:[job()]};
   if(path.includes('/check-runs/'))return [];
   n++;return {...run(),run_attempt:n};
 };
 await assert.rejects(collectAdmission('orestruffle/conformance',RID,requester),/changed during diagnostic/);
});
test('repo path traversal and zero IDs are rejected before API access',async()=>{
 await assert.rejects(collectAdmission('../a',1,async()=>{}),/required/);
 await assert.rejects(collectAdmission('org/repo',0,async()=>{}),/required/);
});
