import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base = new URL('../contracts/v1/option-question-ergonomics/', import.meta.url);
const contract = JSON.parse(await readFile(new URL('option-question-ergonomics-v1.json', base), 'utf8'));
const source = await readFile(new URL('option-fallbacks.ores', base), 'utf8');

function reference(v) {
  let calls = 0;
  const fallback = () => { calls++; return v.fallback; };
  let actual;
  switch (v.operation) {
    case 'option_unwrap_or_else':
      actual = {value: v.receiver.tag === 'Some' ? v.receiver.value : fallback()};
      break;
    case 'option_or_else':
      actual = v.receiver.tag === 'Some' ? v.receiver : fallback();
      break;
    case 'option_ok_or': {
      // Function argument evaluation precedes the method invocation, even for Some.
      const error = fallback();
      actual = v.receiver.tag === 'Some'
        ? {tag: 'Ok', value: v.receiver.value}
        : {tag: 'Err', value: error};
      break;
    }
    case 'result_unwrap_or_else':
      actual = {value: v.receiver.tag === 'Ok' ? v.receiver.value : ((error) => {
        calls++;
        assert.equal(v.fallbackMode, 'error-identity');
        return error;
      })(v.receiver.value)};
      break;
    case 'result_or_else':
      actual = v.receiver.tag === 'Ok' ? v.receiver : fallback();
      break;
    default:
      throw new Error('Unknown operation: ' + v.operation);
  }
  return {actual, calls};
}

test('manifest is explicitly experimental, versioned and does not claim target execution', () => {
  assert.equal(contract.schema, 'oreslang.option-question-ergonomics.v1');
  assert.match(contract.status, /not a compiler-executed conformance receipt/);
  assert.deepEqual(contract.domains, ['Option<int>', 'Result<int,int>']);
  assert.equal(Object.keys(contract.backendAttestations).length, 5);
  for (const evidence of Object.values(contract.backendAttestations)) {
    assert.match(evidence, /not claimed|draft/);
  }
  assert.ok(contract.requiredEvidence.some(x => x.includes('ownership')));
  assert.ok(contract.requiredEvidence.some(x => x.includes('panic')));
});

test('reference model agrees on eager/lazy evaluation and tagged results', () => {
  const ids = new Set();
  const operations = new Set();
  for (const v of contract.vectors) {
    assert.equal(ids.has(v.id), false, v.id);
    ids.add(v.id);
    operations.add(v.operation);
    assert.ok(['Some', 'None', 'Ok', 'Err'].includes(v.receiver.tag));
    const {actual, calls} = reference(v);
    assert.deepEqual(actual, v.expected, v.id);
    assert.equal(calls, v.invocations, v.id);
    assert.ok(calls === 0 || calls === 1, v.id);
  }
  assert.equal(ids.size, 12);
  assert.deepEqual([...operations].sort(), [
    'option_ok_or', 'option_or_else', 'option_unwrap_or_else',
    'result_or_else', 'result_unwrap_or_else',
  ]);
  assert.ok(ids.has('some-ok-or-eager'));
  assert.ok(ids.has('none-ok-or-eager'));
  assert.ok(ids.has('none-to-none-preserves-T'));
});

test('question-mark spellings are independently represented and gated', () => {
  assert.deepEqual(contract.syntaxAdmission.map(x => x.source), [
    'bool? a', 'string b?', 'bool? a?', 'value?', 'flag ? 1 : 2',
  ]);
  const [typed, omittable, both, propagation, ternary] = contract.syntaxAdmission;
  assert.equal(typed.type, 'Option<bool>');
  assert.equal(typed.omittable, false);
  assert.equal(omittable.requiresExplicitDefault, true);
  assert.equal(both.omittable, true);
  assert.equal(both.defaultIfOmitted, 'None');
  assert.equal(propagation.execution, 'unmerged-draft');
  assert.equal(ternary.kind, 'conditional-expression');
  assert.equal(contract.rejectionCases.length, 4);
});

test('source fixture is pure Oreslang without host assumptions', () => {
  assert.match(source, /define module core as/);
  for (const operation of [
    'unwrap_or_else', 'or_else', 'ok_or',
  ]) assert.ok(source.includes('.' + operation + '('), operation);
  assert.match(source, /or_else\(\(\) -> None\)/);
  assert.doesNotMatch(source, /\b(?:stdio|process|network|fs|spawn|await|http|fetch|Worker)\b/);
  assert.equal((source.match(/define module core/g) || []).length, 1);
});
