import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {publishPrivateMirror} from '../bin/private-mirror-publish.mjs';

const disabled=/PRIVATE_SOURCE_EXPORT_DISABLED/;
const source='ores-truffle-oreslang/oreslang-source.java';
const destination='test-private-org/private-compiler-carrier';
const normal={
  source,destination,sourceCommit:'a'.repeat(40),
  destinationBaseCommit:'b'.repeat(40),
  prefix:'snapshots/exact',newBranch:'ci/private-qualification',
  approvedDestinations:[destination],token:'synthetic-test-token'
};

// Every legacy caller-supplied signal is insufficient. These are all
// source-free inputs. No mock returns confidential source contents.
const scenarios=[
  ['valid-looking private destination and 40-byte Git pins',{}],
  ['caller-controlled destination allowlist',{approvedDestinations:[destination,'second-org/private']}],
  ['empty approval list',{approvedDestinations:[]}],
  ['omitted approval list',{approvedDestinations:undefined}],
  ['wrong private destination',{destination:'some-other-org/private-repo'}],
  ['public organization carrier',{destination:'public-org/source-copy'}],
  ['source organization as destination',{destination:source}],
  ['mismatched source commit',{sourceCommit:'c'.repeat(40)}],
  ['invalid source commit',{sourceCommit:'not-a-commit'}],
  ['source path traversal',{prefix:'../hidden'}],
  ['isolated CI branch name',{newBranch:'ci/private-safe-looking'}],
  ['protected default branch name',{newBranch:'main'}],
  ['token supplied',{token:'forged-test-token'}],
  ['token missing',{token:undefined}],
  ['numeric ID forged by caller',{destinationRepositoryId:123456789}],
  ['source root Git tree forged by caller',{sourceTree:'d'.repeat(40)}],
  ['fake security approval',{incidentClosed:true,securityApproved:true}],
  ['alternate budget claim',{fundedOrganization:true,availableMinutes:100000}],
  ['legacy opt-in flag',{allowPrivateMirror:true,exportApproved:true}]
];
for(const [label,override] of scenarios){
  test('private publisher stays disabled: '+label,async()=>{
    let calls=0;
    const fetchImpl=async()=>{calls++;throw Error('network access MUST NOT occur')};
    await assert.rejects(publishPrivateMirror({
      ...normal,...override,fetchImpl
    }),disabled);
    assert.equal(calls,0,'no metadata, blob, tree, commit or ref HTTP requests');
  });
}
test('hostile caller Proxy cannot trigger property reads or network calls',async()=>{
  let reads=0;
  const input=new Proxy({},{get(){reads++;throw Error('caller getter executed')}});
  await assert.rejects(publishPrivateMirror(input),disabled);
  assert.equal(reads,0);
});
test('exported publisher has no executable GitHub request or source-copy dependency',()=>{
  const path=fileURLToPath(new URL('../bin/private-mirror-publish.mjs',import.meta.url));
  const code=readFileSync(path,'utf8');
  assert.doesNotMatch(code,/https:\/\/api\.github\.com|fetchImpl\s*\(|\bexecFileSync\s*\(/);
  assert.doesNotMatch(code,/from\s+['"]\.\/require-private-mirror\.mjs['"]/);
  assert.match(code,/throw Error\('PRIVATE_SOURCE_EXPORT_DISABLED/);
});
test('CLI exits nonzero without echoing credentials or publishing a snapshot',()=>{
  const path=fileURLToPath(new URL('../bin/private-mirror-publish.mjs',import.meta.url));
  const token='opaque-private-ci-test-token';
  const env={...process.env,GITHUB_TOKEN:token,
    ORES_APPROVED_PRIVATE_MIRRORS:destination};
  const proc=spawnSync(process.execPath,[path,source,'a'.repeat(40),destination,
    'b'.repeat(40),'snapshots/exact','ci/private-qualification'],{
    env,encoding:'utf8',timeout:10000
  });
  assert.equal(proc.status,1);
  assert.equal(proc.stdout,'');
  assert.match(proc.stderr,disabled);
  assert.equal(proc.stderr.includes(token),false);
});
