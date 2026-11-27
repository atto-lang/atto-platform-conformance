// Receipt validation only; no compiler or guest execution is implied.
export function classifyNegative(f, positivePassed, run, artifact) {
  if (!run || run.error || run.signal !== null || !Number.isSafeInteger(run.status) || run.status === 2) return 'INFRA_ERROR';
  if (artifact === true || run.status === 0) return 'UNSAFE_ACCEPT_OR_ARTIFACT';
  if (artifact !== false) return 'INFRA_ERROR';
  if (run.status !== 1) return 'UNEXPECTED_EXIT';
  if (positivePassed !== true) return 'PAIRED_POSITIVE_NOT_EXECUTED';
  if (typeof run.stderr !== 'string' || typeof f?.path !== 'string' || !Number.isSafeInteger(f.diagnostic_line) || f.diagnostic_line < 1 || typeof f.expect?.compile_reject !== 'string' || !/^E_COPY_READONLY(?:_SLOT)?$/.test(f.expect.compile_reject)) return 'WRONG_DIAGNOSTIC';
  // Remove at most one conventional line terminator, not arbitrary whitespace.
  const line = run.stderr.replace(/\r?\n$/, '');
  const prefix = f.path + ':';
  if (/[\r\n]/.test(line) || !line.startsWith(prefix)) return 'WRONG_DIAGNOSTIC';
  const d = /^ ?([1-9][0-9]*):([1-9][0-9]*): (E_[A-Z0-9_]+): \S[^\r\n]*$/.exec(line.slice(prefix.length));
  if (!d) return 'WRONG_DIAGNOSTIC';
  const row = Number(d[1]), col = Number(d[2]);
  return Number.isSafeInteger(row) && Number.isSafeInteger(col) && row === f.diagnostic_line &&
    d[3] === f.expect.compile_reject ? 'EXPECTED_REJECT' : 'WRONG_DIAGNOSTIC';
}

export function checkInventory(manifest, actualNames) {
  if (manifest.schema !== 'atto.copy-readonly-sharing.v1' || manifest.status !== 'SOURCE_CANDIDATE_ONLY' ||
      manifest.full_parity !== false || !Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw Error('invalid fixture manifest');
  }
  const known = new Map();
  for (const f of manifest.fixtures) {
    if (!f || typeof f.id !== 'string' || !/^[a-z0-9-]+$/.test(f.id) || known.has(f.id) ||
        f.path !== 'fixtures/copy-readonly-sharing-v1/' + f.id + '.atto' || f.status !== 'NOT_EXECUTED') {
      throw Error('bad fixture inventory');
    }
    if (!f.expect || typeof f.expect !== 'object' || Object.keys(f.expect).length !== 1) throw Error('ambiguous expectation');
    const positive = Object.hasOwn(f.expect, 'main_result') && Number.isSafeInteger(f.expect.main_result);
    const negative = Object.hasOwn(f.expect, 'compile_reject') && typeof f.expect.compile_reject === 'string' && /^E_COPY_READONLY(?:_SLOT)?$/.test(f.expect.compile_reject);
    if (positive === negative) throw Error('bad expectation');
    if (negative && (!Number.isSafeInteger(f.diagnostic_line) || f.diagnostic_line < 1 ||
        typeof f.forbidden_statement !== 'string' || !f.forbidden_statement.trim() || typeof f.paired_positive !== 'string')) {
      throw Error('bad rejection witness');
    }
    known.set(f.id, f);
  }
  const expectedNames = [...known.keys()].map(id => id + '.atto').sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify([...actualNames].sort())) throw Error('fixture directory mismatch');
  for (const f of known.values()) if (f.expect.compile_reject) {
    const p = known.get(f.paired_positive);
    if (!p || !Number.isSafeInteger(p.expect.main_result)) throw Error('missing positive control');
  }
  return known;
}
