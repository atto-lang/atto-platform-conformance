import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const root = new URL('../contracts/logical-punctuation-v1/', import.meta.url);
const pinned = {
  "scalar-parity.atto": "f7e1e082572a0d63483acca44ee7b61a9e6e9032",
  "reject-int-and.atto": "4be2c295d99055b2059effc4863e38e35672abb5",
  "reject-int-or.atto": "ba18f5ad8293d3a4f7ae9a8b69192100e10ac444",
  "reject-int-xor.atto": "d2eb4363303146ecef01c52d0d5c8f00e91f17f0",
  "reject-bare-pipe.atto": "5cb6054a906af4e4b8d0e5c84ab24c71483d044e",
  "reject-bare-ampersand.atto": "0e8315035e8ab1604a928f3dc9dde96d8defdbd4",
  "reject-single-caret.atto": "ce52c19810222d67a84d6c0a6cf84c4cd20febe0",
  "reject-spaced-caret.atto": "a4906d6473fa93f3f5cfce1b6af0a6b45a5b2955"
};
const bytes = name => readFileSync(new URL(name,root));
const gitBlobSha1 = buffer => createHash('sha1')
  .update(Buffer.from('blob '+buffer.length+'\0'))
  .update(buffer).digest('hex');

test('v1 source fixtures have exact canonical Git blob identity', () => {
  for (const [name,expected] of Object.entries(pinned))
    assert.equal(gitBlobSha1(bytes(name)),expected,name);
});

test('canonical punctuation semantics and rejection list cannot drift', () => {
  const contract=JSON.parse(bytes('contract.json').toString('utf8'));
  assert.equal(contract.schema_version,'logical-punctuation-v1');
  assert.equal(contract.status,'TARGET_NOT_VERIFIED');
  assert.deepEqual(Object.keys(contract.semantics).sort(),['&&','^^','||'].sort());
  for(const op of ['&&','^^','||']){
    assert.equal(contract.semantics[op].operand_type,'bool');
    assert.equal(contract.semantics[op].result_type,'bool');
    assert.equal(contract.semantics[op].associativity,'left');
  }
  assert.equal(contract.semantics['&&'].precedence>contract.semantics['^^'].precedence,true);
  assert.equal(contract.semantics['^^'].precedence>contract.semantics['||'].precedence,true);
  assert.match(contract.semantics['&&'].evaluation,/short-circuit/);
  assert.match(contract.semantics['||'].evaluation,/short-circuit/);
  assert.match(contract.semantics['^^'].evaluation,/eager-exactly-once/);
  assert.equal(contract.positive_fixture,'scalar-parity.atto');
  assert.equal(contract.positive_expected_exit_code,42);
  assert.deepEqual([...contract.negative_fixtures].sort(),
    Object.keys(pinned).filter(name=>name!==contract.positive_fixture).sort());
  for(const forbidden of ['&','|','^','and','or','xor',','])
    assert.ok(contract.not_logical_operators.includes(forbidden),forbidden);
  assert.match(contract.evidence_required,/zero-step/);
});

test('positive source uses all three operators without relying on word aliases', () => {
  const src=bytes('scalar-parity.atto').toString('utf8');
  for (const op of ['&&','||','^^']) assert.ok(src.includes(op),op);
  assert.match(src,/\? 42 : 7/);
  assert.ok(!/\b(?:and|or|xor)\b/.test(src));
});
