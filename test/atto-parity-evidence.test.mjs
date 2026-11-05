import test from 'node:test';
import assert from 'node:assert/strict';
import {crossCheckParityReceiptEvidence} from '../src/atto-parity-evidence.mjs';

const sha='a'.repeat(40), tree='b'.repeat(40), digest='c'.repeat(64);
const repo='ores-truffle-oreslang/oreslang-source.java';
function good() {
  const receipt={schema:'attolang.parity-receipt/1',backend:'java',head_sha:sha,
    tree_sha:tree,compiler:'javac',compiler_sha256:digest,run_id:123,run_attempt:2,
    executed_steps:1,job_conclusion:'success',cases:[{id:'returns_42',source_sha256:digest,
      kind:'positive',compile_exit:0,executed:true,run_exit:0,stdout:'42\n',expected_stdout:'42\n'}]};
  const evidence={run:{id:123,run_attempt:2,head_sha:sha,workflow_id:456,
    event:'pull_request',status:'completed',conclusion:'success',repository:{full_name:repo,id:1400792274},
    html_url:`https://github.com/${repo}/actions/runs/123`},
    job:{id:789,run_id:123,head_sha:sha,status:'completed',conclusion:'success',
      runner_id:900,runner_name:'Ubuntu Hosted Runner',
      html_url:`https://github.com/${repo}/actions/runs/123/job/789`,
      started_at:'2026-11-03T20:00:00Z',completed_at:'2026-11-03T20:00:30Z',
      steps:[{number:1,name:'Set up job',status:'completed',conclusion:'success'},
        {number:2,name:'Run actual guest fixture',status:'completed',conclusion:'success'}]},
    commit:{sha,commit:{tree:{sha:tree}},html_url:`https://github.com/${repo}/commit/${sha}`},
    fixture_sha256_by_id:{returns_42:digest}};
  return {receipt,evidence};
}
test('structural cross-check never attests authenticity or guest execution',()=>{
  const {receipt,evidence}=good(); const result=crossCheckParityReceiptEvidence(receipt,evidence);
  assert.equal(result.external_metadata_consistent,true);
  assert.equal(result.provenance_authenticated,false);
  assert.equal(result.actual_guest_execution_attested,false);
  assert.equal(result.publicly_promotable,false);
});
const failures=[
  ['wrong repository', ({evidence:e})=>e.run.repository.full_name='other/repo'],
  ['wrong immutable repository id', ({evidence:e})=>e.run.repository.id=7],
  ['wrong run id', ({evidence:e})=>e.run.id=999],
  ['wrong attempt', ({evidence:e})=>e.run.run_attempt=1],
  ['missing workflow id', ({evidence:e})=>delete e.run.workflow_id],
  ['mismatched run head', ({evidence:e})=>e.run.head_sha='b'.repeat(40)],
  ['failed workflow', ({evidence:e})=>e.run.conclusion='failure'],
  ['pending workflow', ({evidence:e})=>e.run.status='queued'],
  ['unsupported event', ({evidence:e})=>e.run.event='unknown'],
  ['forged run URL', ({evidence:e})=>e.run.html_url+='x'],
  ['wrong commit', ({evidence:e})=>e.commit.sha='b'.repeat(40)],
  ['wrong tree', ({evidence:e})=>e.commit.commit.tree.sha='c'.repeat(40)],
  ['forged commit URL', ({evidence:e})=>e.commit.html_url+='x'],
  ['wrong job run id', ({evidence:e})=>e.job.run_id=999],
  ['wrong job head', ({evidence:e})=>e.job.head_sha='b'.repeat(40)],
  ['missing runner', ({evidence:e})=>e.job.runner_id=null],
  ['runner id zero', ({evidence:e})=>e.job.runner_id=0],
  ['missing runner name', ({evidence:e})=>e.job.runner_name=''],
  ['missing job id', ({evidence:e})=>delete e.job.id],
  ['failed job', ({evidence:e})=>e.job.conclusion='failure'],
  ['forged job URL', ({evidence:e})=>e.job.html_url+='x'],
  ['invalid start time', ({evidence:e})=>e.job.started_at='bogus'],
  ['backward job time', ({evidence:e})=>e.job.completed_at='2026-11-03T19:00:00Z'],
  ['null steps', ({evidence:e})=>e.job.steps=null],
  ['empty steps', ({evidence:e})=>e.job.steps=[]],
  ['setup-only steps', ({evidence:e})=>e.job.steps=[e.job.steps[0]]],
  ['zero user step', ({evidence:e})=>e.job.steps[1].status='pending'],
  ['failed step', ({evidence:e})=>e.job.steps[1].conclusion='failure'],
  ['duplicate step number', ({evidence:e})=>e.job.steps[1].number=1],
  ['extra reported steps', ({receipt:r})=>r.executed_steps=3],
  ['missing pinned ledger', ({evidence:e})=>delete e.fixture_sha256_by_id],
  ['mismatched fixture digest', ({evidence:e})=>e.fixture_sha256_by_id.returns_42='d'.repeat(64)],
  ['extra fixture ledger', ({evidence:e})=>e.fixture_sha256_by_id.extra=digest],
  ['missing fixture ledger ID', ({evidence:e})=>e.fixture_sha256_by_id={extra:digest}]
];
for(const [name,mutate] of failures)test('reject '+name,()=>{
  const v=good(); mutate(v); assert.throws(()=>crossCheckParityReceiptEvidence(v.receipt,v.evidence),/rejected/);
});

test('GitHub evidence timestamps must be canonical UTC and calendar-valid',()=>{
 for(const invalid of [
  '2026-02-30T20:00:00Z','2026-11-03T20:00:00',
  '2026-11-03T20:00:00+02:00','2026-11-03T20:00:00Z injected',
  '2026-11-03T25:00:00Z','2026-11-03T20:00:00.0000Z'
 ]){
  const v=good();v.evidence.job.started_at=invalid;
  assert.throws(()=>crossCheckParityReceiptEvidence(v.receipt,v.evidence),/job timing/,invalid);
 }
 for(const valid of ['2024-02-29T20:00:00Z','2026-11-03T20:00:00.123Z']){
  const v=good();v.evidence.job.started_at=valid;
  // The year-2024 fixture must end after its own start.
  v.evidence.job.completed_at=valid;
  assert.equal(crossCheckParityReceiptEvidence(v.receipt,v.evidence).publicly_promotable,false);
 }
});

test('reject a successful job with an additional pending or running step',()=>{
 for(const status of ['pending','queued','in_progress']){
  const v=good();
  v.evidence.job.steps.push({number:3,name:'Run unexecuted guest',status,conclusion:null});
  assert.throws(()=>crossCheckParityReceiptEvidence(v.receipt,v.evidence),
    /unfinished step in completed job/,status);
 }
 const v=good();
 v.evidence.job.steps.push({number:3,name:'Optional cleanup',status:'completed',conclusion:'skipped'});
 assert.equal(crossCheckParityReceiptEvidence(v.receipt,v.evidence).publicly_promotable,false);
});

test('job step evidence requires consecutive ordered numbers and inert labels',()=>{
 const baseline=good();assert.equal(crossCheckParityReceiptEvidence(baseline.receipt,baseline.evidence).publicly_promotable,false);
 for(const numbers of [[1,3],[2,3],[2,1]]){
  const v=good();
  v.evidence.job.steps.forEach((s,i)=>{s.number=numbers[i]});
  assert.throws(()=>crossCheckParityReceiptEvidence(v.receipt,v.evidence),/discontinuous job step sequence/);
 }
 for(const label of ['Run guest\u202ePASS','Run guest\u0085PASS','Run guest\nPASS','\u001b[32mPASS']){
  const v=good();v.evidence.job.steps[1].name=label;
  assert.throws(()=>crossCheckParityReceiptEvidence(v.receipt,v.evidence),/unsafe job step name/);
 }
});
