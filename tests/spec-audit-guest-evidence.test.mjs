import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSpecAuditGuestClaim as validate} from '../lib/spec-audit-guest-evidence.mjs';
const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40), d = 'd'.repeat(40);
const digest = 'e'.repeat(64);
const manifest = {schema:'atto.spec-audit-candidates/1',cases:[
  {id:'guard-scalar-positive',kind:'positive',source_git_blob_sha1:a,expected_guest_i64:'42'},
  {id:'guard-else-negative',kind:'negative',source_git_blob_sha1:b,
   control_git_blob_sha1:a,expected_diagnostic_class:'GUARD_ELSE_FORBIDDEN'},
  {id:'statement-linebreak',kind:'decision-candidate',source_git_blob_sha1:c}
]};
const expected = () => ({backend:'llvm',compilerHead:a,compilerTree:b,
  conformanceHead:c,conformanceTree:d,
  requiredCaseIds:['guard-scalar-positive','guard-else-negative'],
  requiredSteps:['Compile AttoLang candidates','Execute compiled guest']});
const claim = () => ({schema:'atto.spec-audit-guest-claim/1',backend:'llvm',
  compilerRepository:'ores-truffle-oreslang/oreslang-source.llvm',
  compilerHead:a,compilerTree:b,compilerSha256:digest,conformanceHead:c,
  conformanceTree:d,runId:11,runAttempt:2,jobId:12,runnerId:13,
  jobConclusion:'success',steps:[
    {number:1,name:'Compile AttoLang candidates',status:'completed',conclusion:'success'},
    {number:2,name:'Execute compiled guest',status:'completed',conclusion:'success'}],
  cases:[
    {id:'guard-scalar-positive',kind:'positive',sourceBlob:a,compileExit:0,
      guestExecuted:true,resultI64:'42',resultChannel:'native-return',runExit:0,guestArtifactSha256:digest},
    {id:'guard-else-negative',kind:'negative',sourceBlob:b,compileExit:1,
      guestExecuted:false,failureStage:'semantic',diagnosticClass:'GUARD_ELSE_FORBIDDEN',
      control:{sourceBlob:a,compileExit:0,guestExecuted:false}}
  ]});
function mutator(name, mutate, expectedMessage) {
  test('mutation: '+name, () => {
    const x=claim(), e=expected(); mutate(x,e);
    assert.throws(()=>validate(manifest,x,e),expectedMessage);
  });
}
test('complete synthetic claim stays REVIEW_REQUIRED, never verified parity',()=>{
  const result=validate(manifest,claim(),expected());
  assert.equal(result.classification,'REVIEW_REQUIRED');
  assert.equal(result.independentlyAuthenticated,false);
  assert.equal(result.guestParityCertified,false);
  assert.equal(result.caseCount,2);
});
mutator('missing executed steps',x=>x.steps=null,/missing or unbounded/);
mutator('runner ID zero',x=>x.runnerId=0,/runnerId must be positive/);
mutator('housekeeping step instead of guest execution',x=>x.steps[1].name='Complete job',/required step/);
mutator('duplicate step number',x=>x.steps[1].number=1,/duplicate step/);
mutator('failed job',x=>x.jobConclusion='failure',/failed workflow/);
mutator('wrong compiler head',x=>x.compilerHead='f'.repeat(40),/source identity/);
mutator('wrong conformance tree',x=>x.conformanceTree='f'.repeat(40),/source identity/);
mutator('wrong compiler repository',x=>x.compilerRepository='attacker/compiler',/source identity/);
mutator('wrong fixture hash',x=>x.cases[1].sourceBlob='f'.repeat(40),/source blob/);
mutator('fake positive runtime',x=>x.cases[0].guestExecuted=false,/positive guest did not run/);
mutator('wrong typed return',x=>x.cases[0].resultI64='43',/typed guest value/);
mutator('noncanonical i64',x=>x.cases[0].resultI64='042',/canonical signed i64/);
mutator('stale positive artifact',x=>x.cases[0].guestArtifactSha256=null,/guest artifact/);
mutator('misread process-exit',x=>{x.cases[0].resultChannel='process-exit';x.cases[0].runExit=0},/observed run exit/);
mutator('missing negative paired control',x=>x.cases[1].control=null,/paired control/);
mutator('negative control also rejected',x=>x.cases[1].control.compileExit=2,/paired control did not compile/);
mutator('parser-only error cannot prove semantic rejection',x=>x.cases[1].failureStage='parser',/nonsemantic/);
mutator('wrong diagnostic class',x=>x.cases[1].diagnosticClass='UNKNOWN_NAME',/nonsemantic/);
mutator('fake candidate promoted to positive', (x,e)=>{e.requiredCaseIds=['statement-linebreak']; x.cases=[{...x.cases[0],id:'statement-linebreak'}]},/unapproved/);
mutator('duplicate case ID',x=>x.cases[1].id='guard-scalar-positive',/unapproved/);
mutator('unknown receipt field',x=>x.authenticated=true,/fields differ/);
mutator('mismatched control source',x=>x.cases[1].control.sourceBlob='f'.repeat(40),/paired control did not compile/);
