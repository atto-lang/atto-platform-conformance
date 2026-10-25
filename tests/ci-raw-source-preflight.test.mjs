import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ci=readFileSync(fileURLToPath(new URL('../.github/workflows/ci.yml',import.meta.url)),'utf8');
const step=ci.indexOf('name: Verify exact Git source bytes before oracle checks');
const setup=ci.indexOf('actions/setup-node@');
const npm=ci.indexOf('run: npm test');

test('CI pins checkout to the requested immutable commit',()=>{
  assert.match(ci,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(ci,/persist-credentials: false/);
  assert.match(ci,/EXPECTED_SOURCE_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
});

test('CI installs pinned Node before exact-source preflight and npm tests',()=>{
  assert.ok(setup>=0 && step>setup && npm>step);
  assert.match(ci,/node-version: '22'/);
});

test('CI passes absolute workspace, commit and tree to strict raw checkout verifier',()=>{
  assert.match(ci,/node bin\/verify-source-checkout\.mjs/);
  assert.match(ci,/"--source-dir=\$GITHUB_WORKSPACE"/);
  assert.match(ci,/"--commit=\$EXPECTED_SOURCE_SHA"/);
  assert.match(ci,/"--tree=\$EXPECTED_SOURCE_TREE"/);
  assert.match(ci,/git rev-parse --verify 'HEAD\^\{tree\}'/);
});

test('CI does not trust Git status or filtered diff as execution evidence',()=>{
  assert.doesNotMatch(ci,/\bgit (?:diff|status)\b/);
  assert.doesNotMatch(ci,/\bgit ls-files\b/);
  assert.ok(ci.indexOf('node bin/verify-source-checkout.mjs')<npm);
});
