import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {verifyActorServiceReceipt} from '../bin/verify-actor-service-receipt.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(fs.readFileSync(path.resolve(directory, '../contracts/actor-service-v1.json'), 'utf8'));
const hex40 = 'a'.repeat(40), hex64 = 'b'.repeat(64);

// Synthetic data tests the validator only. It is NEVER a claimed GitHub run.
function synthetic(profile='actor-core', backend='llvm') {
  return {
    schema:'oreslang.actor-service/1', backend,
    repository:`ores-truffle-oreslang/oreslang-source.${backend}`,
    profile, sourceCommit:hex40, sourceTree:hex40, compilerSourceCommit:hex40,
    compilerBinarySha256:hex64, guestArtifactSha256:hex64, fixtureSetSha256:hex64,
    ci:{runId:42, jobId:43, runnerId:44, executedSteps:5, conclusion:'success', exactHead:true,
      workflowUrl:`https://github.com/ores-truffle-oreslang/oreslang-source.${backend}/actions/runs/42`},
    guest:{compiledFromOres:true, executedOnTarget:true, hostReferenceOnly:false,
      executedCases:contract.profiles[profile].length, failedCases:0, skippedCases:0, erroredCases:0},
    caseResults:contract.profiles[profile].map(id=>({id,result:'pass',mode:'compiled-guest',guestAssertions:1,
      fixtureBlob:hex40, ...(contract.cases[id].hostEvidence ? {hostAssertions:1,hostEvidenceSha256:hex64}: {})})),
    ...(profile==='protected-faas' ? {security:{enforcedBoundary:'process',ambientFilesystemDenied:true,
      ambientNetworkDenied:true,tenantIdentityBound:true}} : {}),
    ...(profile==='hard-realtime' ? {realtime:{physicalHardware:true,jitDisabled:true,tracingGcDisabled:true,
      admissionEnforced:true,deadlineNs:1_000_000,wcetUpperBoundNs:500_000,fixedMemoryBudgetBytes:65536,
      maxMailboxEntries:64,analysisArtifactSha256:hex64}} : {})
  };
}
const check = (receipt, c=contract) => verifyActorServiceReceipt(receipt,c);
const fails = (name, change, profile='actor-core') => test(`reject ${name}`, () => {
  const r=synthetic(profile); change(r);
  const outcome=check(r);
  assert.equal(outcome.ok,false, `${name} wrongly passed`);
  assert.ok(outcome.errors.length > 0);
});

for (const profile of Object.keys(contract.profiles))
  test(`synthetic ${profile} receipt shape`,()=>assert.deepEqual(check(synthetic(profile)),{ok:true,errors:[]}));

fails('unadmitted runner', r=>r.ci.runnerId=0);
fails('no executed steps', r=>r.ci.executedSteps=0);
fails('pending workflow', r=>r.ci.conclusion='queued');
fails('mismatched workflow URL', r=>r.ci.workflowUrl='https://github.com/other/repo/actions/runs/42');
fails('forged repository/backend mismatch', r=>r.repository='ores-truffle-oreslang/oreslang-source.java');
fails('host reference substituted for guest', r=>r.guest.hostReferenceOnly=true);
fails('guest target not executed', r=>r.guest.executedOnTarget=false);
fails('zero executed guest cases', r=>r.guest.executedCases=0);
fails('skipped guest cases', r=>r.guest.skippedCases=1);
fails('failed guest cases', r=>r.guest.failedCases=1);
fails('missing required guest case', r=>r.caseResults.pop());
fails('duplicate case', r=>r.caseResults.push({...r.caseResults[0]}));
fails('unknown extra case', r=>r.caseResults.push({id:'nonexistent',result:'pass',mode:'compiled-guest',guestAssertions:1,fixtureBlob:hex40}));
fails('incorrect fixture Git blob', r=>r.caseResults[0].fixtureBlob='bad');
fails('unexecuted guest assertion', r=>r.caseResults[0].guestAssertions=0);
fails('host-only case posing as guest', r=>r.caseResults[0].mode='host-stub');
fails('missing physical reclamation evidence', r=>delete r.caseResults.find(x=>x.id==='reclaim-peer-survives').hostEvidenceSha256);
fails('invalid digest', r=>r.compilerBinarySha256='0');
fails('missing tenant OS isolation', r=>r.security.enforcedBoundary='actor-heap', 'protected-faas');
fails('ambient tenant network authority', r=>r.security.ambientNetworkDenied=false, 'protected-faas');
fails('realtime measured-only deadline', r=>delete r.realtime.analysisArtifactSha256, 'hard-realtime');
fails('realtime WCET above deadline', r=>r.realtime.wcetUpperBoundNs=2_000_000, 'hard-realtime');
fails('realtime JIT enabled', r=>r.realtime.jitDisabled=false, 'hard-realtime');

test('reject corrupted contract case registry',()=> {
  const corrupted=structuredClone(contract);corrupted.profiles['actor-core'].push('missing-case');
  assert.equal(check(synthetic(),corrupted).ok,false);
});
test('reject duplicated case registry entries',()=> {
  const corrupted=structuredClone(contract);corrupted.profiles['actor-core'].push('private-state-distinct');
  assert.equal(check(synthetic(),corrupted).ok,false);
});

test('reject downgrade by silently deleting a case from every profile',()=> {
  const corrupted=structuredClone(contract);delete corrupted.cases['supervisor-control-once'];
  for (const ids of Object.values(corrupted.profiles)) ids.splice(ids.indexOf('supervisor-control-once'),1);
  assert.equal(check(synthetic(),corrupted).ok,false);
});
