import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, validateReceipt, collectEvidence, githubReadOnlyGet,
  REPOSITORY, WORKFLOW, BRANCH } from '../scripts/collect-source-runner-failure.mjs';
const sha = '7d9620f2cd64c5b128ff267086ba9d4830114f1f';
const target = { runId: 40815105000, attempt: 1, sha, branch: BRANCH };
const base = () => ({
  run: { id: target.runId, repository: { full_name: REPOSITORY }, head_sha: sha,
    head_branch: BRANCH, path: WORKFLOW, run_attempt: 1, event: 'push',
    status: 'completed', conclusion: 'failure' },
  jobs: { total_count: 1, jobs: [{ id: 123254216351, name: 'runner-admission',
    run_id: target.runId, run_attempt: 1, head_sha: sha, status: 'completed',
    conclusion: 'failure', runner_id: 0, runner_name: '', steps: [] }] },
  annotations: [{ annotation_level: 'failure', title: 'Provider message',
    message: 'Job did not start due to policy (synthetic fixture)' }],
});
function withMutation(f) { const data = base(); f?.(data); return data; }
test('parse positive exact target', () => assert.deepEqual(parseTarget([String(target.runId), '1', sha, BRANCH]), target));
for (const [label, values] of [
  ['zero run', ['0', '1', sha, BRANCH]],
  ['negative attempt', ['1', '-1', sha, BRANCH]],
  ['non-integer ID', ['1e3', '1', sha, BRANCH]],
  ['wrong sha', ['1', '1', 'z'.repeat(40), BRANCH]],
  ['wrong branch', ['1', '1', sha, 'main']],
  ['missing', []],
]) test('target rejects ' + label, () => assert.throws(() => parseTarget(values)));
const invalid = [
  ['run ID', d => { d.run.id++; }],
  ['repo', d => { d.run.repository.full_name = 'attacker/carrier'; }],
  ['sha', d => { d.run.head_sha = '0'.repeat(40); }],
  ['branch', d => { d.run.head_branch = 'main'; }],
  ['path', d => { d.run.path = 'some-other.yml'; }],
  ['event', d => { d.run.event = 'pull_request_target'; }],
  ['attempt', d => { d.run.run_attempt++; }],
  ['missing jobs', d => { d.jobs.jobs = []; d.jobs.total_count = 0; }],
  ['truncated jobs', d => { d.jobs.total_count = 2; }],
  ['job name', d => { d.jobs.jobs[0].name = 'non-canary'; }],
  ['job id', d => { d.jobs.jobs[0].id = 0; }],
  ['job run', d => { d.jobs.jobs[0].run_id++; }],
  ['job attempt', d => { d.jobs.jobs[0].run_attempt++; }],
  ['job SHA', d => { d.jobs.jobs[0].head_sha = '0'.repeat(40); }],
];
for (const [label, f] of invalid)
  test('fail-closed receipt: ' + label, () => { const d = withMutation(f); assert.throws(() => validateReceipt(d.run,d.jobs,target)); });
test('real no-runner receipt yields preallocation failure, never guest parity',()=> {
  const d=base(), x=validateReceipt(d.run,d.jobs,target);
  assert.equal(x.preAllocationFailure,true);assert.equal(x.runnerBackedExecutionObserved,false);assert.equal(x.guestExecutionProven,false);
});
test('completed failed step still counts as runner-backed execution, not guest parity',()=>{
  const d=withMutation(d=>{const j=d.jobs.jobs[0]; j.runner_id=42;j.runner_name='Actions 42';j.steps=[{name:'Guest test',status:'completed',conclusion:'failure'}];});
  const x=validateReceipt(d.run,d.jobs,target);assert.equal(x.preAllocationFailure,false);assert.equal(x.runnerBackedExecutionObserved,true);assert.equal(x.guestExecutionProven,false);
});
test('housekeeping-only work does not count as meaningful',()=>{
  const d=withMutation(d=>{const j=d.jobs.jobs[0];j.runner_id=2;j.runner_name='runner';j.steps=[{name:'Post cache',status:'completed',conclusion:'success'}];});
  assert.equal(validateReceipt(d.run,d.jobs,target).runnerBackedExecutionObserved,false);
});
test('collect evidence only uses approved three read-only routes and returns annotations', async()=>{
  const d=base(), paths=[];const urls=['repos/' + REPOSITORY + '/actions/runs/' + target.runId,'repos/' + REPOSITORY + '/actions/runs/' + target.runId + '/attempts/1/jobs?per_page=100','repos/' + REPOSITORY + '/check-runs/123254216351/annotations?per_page=100'];
  const x=await collectEvidence(target, async p=>{paths.push(p);return [d.run,d.jobs,d.annotations][paths.length-1];});
  assert.deepEqual(paths,urls);assert.equal(x.providerAnnotations.length,1);assert.equal(x.sourceExportAuthorized,false);assert.equal(x.preAllocationFailure,true);
});
test('collect refuses malformed annotation API and does not mark success', async()=>{
  const d=base();let i=0;await assert.rejects(collectEvidence(target,async()=>[d.run,d.jobs,{error:'403'}][i++]));
});
test('mask credential-like tokens in annotation output',async()=>{
  const d=base();d.annotations[0].message='Bearer abcdef ghp_abcdefghijklmnopqrstuvwxyz123456789';let i=0;
  const x=await collectEvidence(target,async()=>[d.run,d.jobs,d.annotations][i++]);
  assert.doesNotMatch(x.providerAnnotations[0].message,/ghp_|Bearer abcdef/);
});
test('reject paths outside source-local approved read-only subset',()=>{
  assert.throws(()=>githubReadOnlyGet('repos/other/repo/actions/runs/42'));
  assert.throws(()=>githubReadOnlyGet('repos/' + REPOSITORY + '/git/blobs/123'));
  assert.throws(()=>githubReadOnlyGet('repos/' + REPOSITORY + '/actions/runs/1/rerun'));
});

test('refuse successful run in failed-run collector',()=>{
  const d=base();d.run.conclusion='success';assert.throws(()=>validateReceipt(d.run,d.jobs,target));
});
test('refuse queued run in failed-run collector',()=>{
  const d=base();d.run.status='queued';assert.throws(()=>validateReceipt(d.run,d.jobs,target));
});
test('refuse successful job in failed-run collector',()=>{
  const d=base();d.jobs.jobs[0].conclusion='success';assert.throws(()=>validateReceipt(d.run,d.jobs,target));
});
test('refuse not-completed job in failed-run collector',()=>{
  const d=base();d.jobs.jobs[0].status='in_progress';assert.throws(()=>validateReceipt(d.run,d.jobs,target));
});
test('refuse truncated 100-entry annotation page instead of presenting partial evidence',async()=>{
  const d=base();let i=0; const many=Array.from({length:100},()=>({...d.annotations[0]}));
  await assert.rejects(collectEvidence(target,async()=>[d.run,d.jobs,many][i++]));
});
test('refuse malformed annotation with missing message',async()=>{
  const d=base();let i=0;const bad=[{title:'broken',annotation_level:'failure'}];
  await assert.rejects(collectEvidence(target,async()=>[d.run,d.jobs,bad][i++]));
});
test('refuse invalid annotation level',async()=>{
  const d=base();let i=0;const bad=[{message:'hi',annotation_level:'imposter'}];
  await assert.rejects(collectEvidence(target,async()=>[d.run,d.jobs,bad][i++]));
});
test('redact generic secrets and URL userinfo in provider annotation',async()=>{
  const d=base();let i=0;d.annotations[0].message='password=superSecret token:1234567890 https://alice:secretpass@example.com/path authorization:BearerToken x-api-key=key123';
  const x=await collectEvidence(target,async()=>[d.run,d.jobs,d.annotations][i++]);
  const v=x.providerAnnotations[0].message;
  for (const secret of ['superSecret','1234567890','secretpass','BearerToken','key123']) assert.ok(!v.includes(secret), secret);
});
