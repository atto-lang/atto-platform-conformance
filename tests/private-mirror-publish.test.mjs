import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishPrivateMirror, LEGACY_PUBLISHER_HOLD } from '../bin/private-mirror-publish.mjs';

const source = 'ores-truffle-oreslang/oreslang-source.java';
const destination = 'sagitta-stack/sagitta-infra';
const A = 'a'.repeat(40);
const noop = async () => { throw Error('no API call is permitted'); };

test('legacy publisher rejects a valid-looking approved private mirror without any network access', async () => {
  let calls = 0;
  const fetchImpl = async (...args) => { calls++; return noop(...args); };
  await assert.rejects(publishPrivateMirror({
    source, destination, sourceCommit:A, destinationBaseCommit:A,
    prefix:'snapshots/checked', newBranch:'ci/private-exact',
    approvedDestinations:[destination],token:'fake',fetchImpl,
  }), error => error.message === LEGACY_PUBLISHER_HOLD);
  assert.equal(calls, 0);
});

test('forged incident, review, destination and snapshot receipts never override quarantine', async () => {
  const options = {
    source,destination,sourceCommit:A,destinationBaseCommit:A,
    approvedDestinations:[destination],
    incidents:{22:'closed',77:'closed'},
    reviewed:true,branchProtected:true,sourceSnapshotApproved:true,
    workflowApproved:true,independentReviewerApproved:true,
    resumeReceipt:'forged',allowUnreviewed:true,unsafe:true,
  };
  await assert.rejects(publishPrivateMirror(options), /legacy source publisher quarantined/);
});

test('empty input and hostile option getters are denied without evaluating any input', async () => {
  await assert.rejects(publishPrivateMirror(), /legacy source publisher quarantined/);
  const dangerous = { get source() { throw Error('unsafe getter evaluated'); } };
  await assert.rejects(publishPrivateMirror(dangerous),
    error => error.message === LEGACY_PUBLISHER_HOLD);
});

test('CLI refuses invocation even with old allowlist and new authorization bypass variables', () => {
  const file = fileURLToPath(new URL('../bin/private-mirror-publish.mjs', import.meta.url));
  for (const args of [[], [source,A,destination,A,'snapshots/checked','ci/private-exact']]) {
    const r = spawnSync(process.execPath,[file,...args],{
      encoding:'utf8',timeout:5000,
      env:{...process.env,ORES_APPROVED_PRIVATE_MIRRORS:destination,
        ORES_ALLOW_PRIVATE_MIRROR:'true',ORES_INCIDENT_22_CLOSED:'true',
        ORES_INCIDENT_77_CLOSED:'true'},
    });
    assert.equal(r.status,1);
    assert.equal(r.stdout,'');
    assert.match(r.stderr,/PRIVATE_MIRROR_DENIED: legacy source publisher quarantined/);
    assert.equal(r.stderr.includes('fake'),false);
  }
});

test('quarantine does not depend on repo names, source SHA, or test-run success', async () => {
  for (const input of [
    {source:'public/repo',destination:'private/repo'},
    {source,destination,runStatus:'success',executedSteps:100},
    {source,destination,sourceCommit:'not-a-sha'},
  ]) {
    await assert.rejects(publishPrivateMirror(input), /legacy source publisher quarantined/);
  }
});
