import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPrivateMirror, LEGACY_PUBLISHER_HOLD } from '../bin/private-mirror-publish.mjs';

// Keep this file separate from tests/private-mirror-publish.test.mjs: other
// draft bootstrap PRs modify that older file and could replace its assertions.
// This check must continue to fail if a subsequent merge resurrects the
// legacy publisher, even if the other suite is overwritten or deleted.
test('legacy private-source publisher remains irrevocably disabled after later merges', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; throw Error('network must remain untouched'); };
  const candidate = {
    source:'ores-truffle-oreslang/oreslang-source.java',
    destination:'sagitta-stack/sagitta-infra',
    sourceCommit:'a'.repeat(40),
    destinationBaseCommit:'b'.repeat(40),
    prefix:'snapshot/synthetic',newBranch:'ci/private-synthetic',
    approvedDestinations:['sagitta-stack/sagitta-infra'],token:'synthetic-only',
    fetchImpl,
  };
  await assert.rejects(publishPrivateMirror(candidate),
    error => error?.message === LEGACY_PUBLISHER_HOLD);
  assert.equal(requests,0,'the legacy publisher must reject BEFORE first API request');
});

test('approval-like environment variables cannot reactivate quarantined publisher', async () => {
  const old = process.env.ORES_APPROVED_PRIVATE_MIRRORS;
  process.env.ORES_APPROVED_PRIVATE_MIRRORS='sagitta-stack/sagitta-infra';
  try {
    await assert.rejects(publishPrivateMirror({reviewer:'independent',approved:true}),
      /legacy source publisher quarantined/);
  } finally {
    if(old===undefined) delete process.env.ORES_APPROVED_PRIVATE_MIRRORS;
    else process.env.ORES_APPROVED_PRIVATE_MIRRORS=old;
  }
});
