// HOST-ONLY REFERENCE ORACLE. This is not an Atto guest execution receipt.
// See atto-lang/atto-spec language/trap-result-v1.md and the separate
// browser compiler fail-closed gate in atto-lang/atto-source.rs PR #275.
import test from 'node:test';
import assert from 'node:assert/strict';

const Ok = value => Object.freeze({ kind: 'Ok', value });
const Err = error => Object.freeze({ kind: 'Err', error });
const Some = value => Object.freeze({ kind: 'Some', value });
const None = Object.freeze({ kind: 'None' });
const isResult = value => value?.kind === 'Ok' || value?.kind === 'Err';

// This is a reference model, NEVER a source compiler or guest runtime.
class OrdinaryThrow extends Error {
  constructor(error) { super('ordinary source throw'); this.error = error; }
}
class Raise extends Error {}
class Panic extends Error {}
class Cancel extends Error {}

function trap_reference(operation) {
  try {
    const value = operation(); // exactly once
    return isResult(value) ? value : Ok(value);
  } catch (signal) {
    if (signal instanceof OrdinaryThrow) {
      // Preserve exact nominal Error object and its message/trace.
      if (!(signal.error instanceof Error)) throw new TypeError('non-Error source throw');
      return Err(signal.error);
    }
    throw signal; // raise, panic, cancellation, host failures bypass
  }
}

test('T succeeds as Ok(T), with no Option wrapper', () => {
  assert.deepEqual(trap_reference(() => 42), Ok(42));
});
test('ordinary source throw becomes Err(original Error), preserving identity', () => {
  const error = new Error('bad input');
  const result = trap_reference(() => { throw new OrdinaryThrow(error); });
  assert.equal(result.kind, 'Err');
  assert.strictEqual(result.error, error);
});
test('already-Result Ok and Err preserve exact value/container identity', () => {
  const good = Ok(42);
  const err = new Error('already returned');
  const bad = Err(err);
  assert.strictEqual(trap_reference(() => good), good);
  assert.strictEqual(trap_reference(() => bad), bad);
  assert.strictEqual(trap_reference(() => bad).error, err);
});
test('an Err with non-Error E stays an Err; type joining is a static compiler obligation', () => {
  const error = 'validation failed';
  const bad = Err(error);
  assert.strictEqual(trap_reference(() => bad), bad);
  // A backend must reject impossible E/Error joins with E_TRAP_ERROR_JOIN
  // or implement an explicit lossless sum; it may not silently erase E.
});
test('Option<T> becomes Result<Option<T>, Error> with None intact', () => {
  const present = Some(42);
  assert.deepEqual(trap_reference(() => present), Ok(present));
  assert.deepEqual(trap_reference(() => None), Ok(None));
  assert.notEqual(trap_reference(() => None).kind, 'Err');
});
test('Result<Option<T>, E> remains one Result, no extra wrapper', () => {
  const present = Ok(Some(42));
  const missing = Ok(None);
  const failed = Err(new Error('database unavailable'));
  assert.strictEqual(trap_reference(() => present), present);
  assert.strictEqual(trap_reference(() => missing), missing);
  assert.strictEqual(trap_reference(() => failed), failed);
});
test('intentional nested Result as payload is not recursively flattened', () => {
  const nested = Ok(Err(new Error('inner domain error')));
  assert.strictEqual(trap_reference(() => nested), nested);
  assert.equal(trap_reference(() => nested).value.kind, 'Err');
});
test('operand is evaluated precisely once on success and throw', () => {
  let successCount = 0, failureCount = 0;
  trap_reference(() => { successCount++; return 7; });
  trap_reference(() => { failureCount++; throw new OrdinaryThrow(new Error('bad')); });
  assert.equal(successCount, 1);
  assert.equal(failureCount, 1);
});
test('raise, panic, cancellation and host faults bypass trap', () => {
  for (const signal of [new Raise(), new Panic(), new Cancel(), new TypeError('host')]) {
    assert.throws(() => trap_reference(() => { throw signal; }), e => e === signal);
  }
});
test('only properly tagged ordinary source Error is captured', () => {
  assert.throws(() => trap_reference(() => { throw new OrdinaryThrow('not an Error'); }), TypeError);
});
