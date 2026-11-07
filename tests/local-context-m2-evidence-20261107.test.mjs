import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classifyJob,evaluateCandidate,parityVerdict,POSITIVE_FIXTURE_BLOB,POSITIVE_FIXTURE_PATH,REPO,PR} from '../src/local-context-m2-evidence-20261107.mjs';
const H='30861ebd6b0770c64b71ec388e54348218e86713';
const T='cfa881bf11bc2badd12d8dd3ee3f7bfcb1c9c04e';
const PIN={repository:REPO,pr:PR,head:H,tree:T,fixturePath:POSITIVE_FIXTURE_PATH,fixtureBlob:POSITIVE_FIXTURE_BLOB};
const TRACE='SOURCE_TASK_RUNTIME_PASS producer_on_carrier=1';
const digest=s=>createHash('sha256').update(s).digest('hex');
const make=()=>({pin:{...PIN},run:{id:42392407658,runAttempt:2,head:H,status:'completed',conclusion:'success'},job:{id:128464697806,name:'compiled-guest',runId:42392407658,attempt:2,runner_id:77,status:'completed',conclusion:'success',steps:[{number:1,name:'checkout',status:'completed',conclusion:'success'},{number:2,name:'compile/link/run',status:'completed',conclusion:'success'}]},receipt:{runId:42392407658,attempt:2,jobId:128464697806,tree:T,fixtureBlob:POSITIVE_FIXTURE_BLOB,kind:'positive',commands:{compiler:'atto-compiler fixture.atto',linker:'clang guest.ll -o guest',guest:'./guest'},artifact:{path:'guest',sha256:'a'.repeat(64)},compile:{exitCode:0,emittedIR:true},link:{exitCode:0},guest:{exitCode:42,stderr:TRACE,traceSha256:digest(TRACE)}}});
const copy=o=>structuredClone(o);
const base=make();
const mutate=(name,fn,expected='EVIDENCE_REJECTED')=>test(name,()=>{const m=copy(base);fn(m);assert.equal(evaluateCandidate(m,PIN).classification,expected);});

test('stepful synthetic metadata is a candidate, NEVER independent verification',()=>{
  const result=evaluateCandidate(base,PIN); assert.equal(result.classification,'UNATTESTED_GUEST_RECEIPT_CANDIDATE'); assert.equal(result.canPromote,false);
});
for(const steps of [null,[]])test('missing steps '+String(steps)+' is runner admission failure',()=>{
  const x=copy(base);x.job.steps=steps;assert.equal(evaluateCandidate(x,PIN).classification,'RUNNER_ADMISSION_FAILURE');
});
test('all skipped steps are not execution',()=>{
  const x=copy(base);x.job.steps=[{number:1,name:'skipped',status:'completed',conclusion:'skipped'}];
  assert.equal(evaluateCandidate(x,PIN).classification,'RUNNER_ADMISSION_FAILURE');
});
test('pending steps cannot be treated as concluded execution',()=>{
  const x=copy(base);x.job.steps=[{number:1,name:'pending',status:'in_progress',conclusion:null}];
  assert.equal(evaluateCandidate(x,PIN).classification,'EVIDENCE_REJECTED');
});
mutate('missing Git head',m=>m.pin.head=null,'STALE_HEAD');
mutate('other repo is refused',m=>m.pin.repository='attacker/repo','STALE_HEAD');
mutate('stale tree is refused',m=>m.pin.tree='f'.repeat(40),'STALE_HEAD');
mutate('swapped fixture blob refused',m=>m.pin.fixtureBlob='b'.repeat(40),'STALE_HEAD');
mutate('run head different',m=>m.run.head='a'.repeat(40),'STALE_HEAD');
mutate('run attempt mismatch',m=>m.job.attempt=1);
mutate('receipt attempt mismatch',m=>m.receipt.attempt=1);
mutate('receipt job mismatch',m=>m.receipt.jobId=999);
mutate('receipt tree mismatch',m=>m.receipt.tree='f'.repeat(40));
mutate('receipt fixture mismatch',m=>m.receipt.fixtureBlob='e'.repeat(40));
mutate('workflow pending instead of completed',m=>m.run.status='queued');
mutate('workflow red',m=>m.run.conclusion='failure');
mutate('job red despite a succeeded step',m=>m.job.conclusion='failure','EXECUTED_NONPASS');
mutate('duplicate step ordinals',m=>m.job.steps.push({number:1,name:'duplicate',conclusion:'success'}));
mutate('invalid step number',m=>m.job.steps[0].number=0);
mutate('step failed',m=>m.job.steps[1].conclusion='failure','EXECUTED_NONPASS');
mutate('compiler command omitted',m=>m.receipt.commands.compiler='');
mutate('linker command omitted',m=>m.receipt.commands.linker='');
mutate('guest command omitted',m=>m.receipt.commands.guest='');
mutate('artifact digest wrong shape',m=>m.receipt.artifact.sha256='fake');
mutate('compiler exit nonzero',m=>m.receipt.compile.exitCode=2);
mutate('compile emitted no IR',m=>m.receipt.compile.emittedIR=false);
mutate('link failed',m=>m.receipt.link.exitCode=1);
mutate('guest exit wrong',m=>m.receipt.guest.exitCode=0);
mutate('guest marker omitted',m=>m.receipt.guest.stderr='producer_on_carrier=1');
mutate('carrier marker omitted',m=>m.receipt.guest.stderr='SOURCE_TASK_RUNTIME_PASS');
mutate('guest stderr modified without matching digest',m=>m.receipt.guest.stderr+=' altered');
mutate('guest digest wrong',m=>m.receipt.guest.traceSha256='1'.repeat(64));
mutate('unsupported receipt kind',m=>m.receipt.kind='host');
test('semantic compiler reject candidate never promotes',()=>{
  const m=copy(base);m.receipt={runId:m.run.id,attempt:2,jobId:m.job.id,tree:T,fixtureBlob:POSITIVE_FIXTURE_BLOB,kind:'negative',compile:{exitCode:1,emittedIR:false,emittedFiles:0,stderr:'TaskLocal<int>.get requires preceding set'}};
  assert.equal(evaluateCandidate(m,PIN).classification,'UNATTESTED_NEGATIVE_RECEIPT_CANDIDATE');
  assert.equal(evaluateCandidate(m,PIN).canPromote,false);
});
for(const [name,change] of [
  ['crash as semantic reject',r=>r.compile.stderr='internal compiler error'],
  ['signal instead of semantic exit one',r=>r.compile.exitCode=139],
  ['leaked IR on rejection',r=>r.compile.emittedIR=true],
  ['negative emitted a file',r=>r.compile.emittedFiles=1],
  ['empty diagnostic',r=>r.compile.stderr='  '],
  ['unexpected guest on negative',r=>r.guest={exitCode:0}],
  ['unexpected link on negative',r=>r.link={exitCode:0}],
  ['unexpected artifact on negative',r=>r.artifact={path:'oops'}]
])test('reject negative mutation: '+name,()=>{
  const m=copy(base);m.receipt={runId:m.run.id,attempt:2,jobId:m.job.id,tree:T,fixtureBlob:POSITIVE_FIXTURE_BLOB,kind:'negative',compile:{exitCode:1,emittedIR:false,emittedFiles:0,stderr:'semantic reject'}};change(m.receipt);
  assert.equal(evaluateCandidate(m,PIN).canPromote,false);
  assert.equal(evaluateCandidate(m,PIN).classification,'EVIDENCE_REJECTED');
});
test('five fake backend receipts never establish parity',()=>{
  const result=parityVerdict(['java','llvm','net','wasm','forge'].map(backend=>({backend,status:'success'})));
  assert.equal(result.classification,'PARITY_UNPROVEN'); assert.equal(result.canPromote,false);
});
test('even malformed and absent receipt sets remain unproven',()=>{
  for(const evidence of [null,undefined,[],[{},null],['llvm']]) assert.equal(parityVerdict(evidence).canPromote,false);
});
test('invalid canonical pin itself fails closed',()=>{
  for(const pin of [{...PIN,head:'invalid'},{...PIN,tree:'invalid'},{...PIN,pr:23},{...PIN,fixtureBlob:'x'}])
    assert.equal(evaluateCandidate(base,pin).classification,'EVIDENCE_REJECTED');
});

mutate('unassigned runner denied even with success metadata',m=>m.job.runner_id=0,'RUNNER_ADMISSION_FAILURE');
mutate('null runner denied even with success metadata',m=>m.job.runner_id=null,'RUNNER_ADMISSION_FAILURE');
mutate('conflicting runner identities are not trusted',m=>m.job.runnerId=999);
mutate('job still running cannot be a success candidate',m=>m.job.status='in_progress','PENDING_NO_EVIDENCE');
mutate('step still running cannot be a success candidate',m=>m.job.steps[1].status='in_progress');
mutate('unknown step conclusion cannot be a success candidate',m=>m.job.steps[1].conclusion=null);
mutate('blank step names are rejected',m=>m.job.steps[1].name=' ');
mutate('trailing newline in artifact SHA256 rejected',m=>m.receipt.artifact.sha256+='\n');
mutate('traversal artifact path rejected',m=>m.receipt.artifact.path='../guest');
mutate('absolute artifact path rejected',m=>m.receipt.artifact.path='/tmp/guest');
mutate('Windows artifact path rejected',m=>m.receipt.artifact.path='C:\\temp\\guest');
mutate('empty artifact path segment rejected',m=>m.receipt.artifact.path='out//guest');
test('newline-suffixed pin SHA and tree fail closed',()=>{
  for(const change of [p=>{p.head+='\n';},p=>{p.tree+='\n';}]){
    const pin={...PIN};change(pin);
    assert.equal(evaluateCandidate(base,pin).classification,'EVIDENCE_REJECTED');
  }
});
test('a legitimate skipped step is tolerated only alongside completed work',()=>{
  const m=copy(base);
  m.job.steps.push({number:3,name:'optional',status:'completed',conclusion:'skipped'});
  const verdict=evaluateCandidate(m,PIN);
  assert.equal(verdict.classification,'UNATTESTED_GUEST_RECEIPT_CANDIDATE');
  assert.equal(verdict.canPromote,false);
});

for(const status of ['queued','waiting','in_progress']){
  test('nonterminal '+status+' is pending, not admission failure',()=>{
    const m=copy(base);m.job.status=status;m.job.steps=null;m.job.runner_id=0;
    const v=evaluateCandidate(m,PIN);
    assert.equal(v.classification,'PENDING_NO_EVIDENCE');
    assert.equal(v.canPromote,false);
  });
}
test('completed and unassigned with zero steps is a runner-admission failure',()=>{
  const m=copy(base);m.job.status='completed';m.job.steps=[];m.job.runner_id=0;
  assert.equal(evaluateCandidate(m,PIN).classification,'RUNNER_ADMISSION_FAILURE');
});

mutate('newline in artifact path rejected',m=>m.receipt.artifact.path='out\nforged');
mutate('carriage return in artifact path rejected',m=>m.receipt.artifact.path='out\rforged');
mutate('NUL in artifact path rejected',m=>m.receipt.artifact.path='out\0forged');
