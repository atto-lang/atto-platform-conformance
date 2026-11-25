import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('../contracts/source-unicode-control-v1.json', import.meta.url), 'utf8'));
const expected = [
  '0085', '061C', '200E', '200F', '2028', '2029',
  '202A', '202B', '202C', '202D', '202E',
  '2066', '2067', '2068', '2069',
];

test('source Unicode control v1 defines each rejected codepoint once', () => {
  assert.equal(contract.schema, 'attolang.source-unicode-control.v1');
  assert.deepEqual(contract.forbidden_codepoints, expected);
  assert.equal(new Set(contract.forbidden_codepoints).size, expected.length);
  assert.equal(contract.status, 'SOURCE_CONTRACT_NOT_BACKEND_EXECUTION');
  assert.equal(contract.verdict, 'UNVERIFIED');
  assert.deepEqual(contract.receipts, []);
});

test('negative templates generate actual controls in source comments', () => {
  assert.equal(contract.negative_cases.length, 3);
  for (const code of expected) {
    const control = String.fromCodePoint(Number.parseInt(code, 16));
    for (const fixture of contract.negative_cases) {
      const source = fixture.prefix + control + fixture.suffix;
      assert.equal(source.indexOf(control), fixture.prefix.length);
      assert.equal(Buffer.byteLength(source.slice(0, source.indexOf(control)), 'utf8'),
        Buffer.byteLength(fixture.prefix, 'utf8'));
      assert.ok(source.includes(contract.baseline_source) || fixture.id === 'source-tail');
    }
  }
  assert.ok(contract.permitted_comment_sample.includes('café'));
});

test('no backend is promoted by the presence of an unexecuted fixture', () => {
  assert.ok(Object.keys(contract.backends).length >= 7);
  for (const item of Object.values(contract.backends)) {
    assert.match(item.state, /NOT_EXECUTED|NOT_VERIFIED/);
    assert.ok(!('result' in item));
    assert.ok(item.repo.startsWith('ores-truffle-oreslang/'));
  }
});
