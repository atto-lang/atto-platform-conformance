/** Verify real Node TAP summary, not merely a child process exit code. */
const deny = reason => { throw new Error('wave8-test-evidence: ' + reason); };
function single(summary, key) {
  const lines = summary.split(/\r?\n/);
  const matches = lines.filter(line => line.startsWith('# '+key+' '));
  if (matches.length !== 1 || !/^# [a-z]+ [0-9]+$/.test(matches[0])) deny('missing/duplicate/non-numeric TAP summary '+key);
  const n = Number(matches[0].slice(('# '+key+' ').length));
  if (!Number.isSafeInteger(n) || n < 0) deny('invalid TAP count '+key);
  return n;
}
export function assessTap(stdout, { minimumTests = 1 } = {}) {
  if (typeof stdout !== 'string' || stdout.length > 2*1024*1024 || !stdout.startsWith('TAP version 13\n')) deny('missing/bounded TAP v13 output');
  if (!Number.isSafeInteger(minimumTests) || minimumTests < 1 || minimumTests > 2000) deny('invalid required tests');
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(k => [k, single(stdout,k)]));
  if (counts.tests < minimumTests || counts.pass !== counts.tests || counts.fail !== 0 || counts.cancelled !== 0 || counts.skipped !== 0 || counts.todo !== 0) deny('tests absent, failed, skipped, cancelled or TODO');
  return Object.freeze({ status: 'EXECUTED_NODE_TESTS', counts, hostOnly: true, compilerParityVerified: false });
}
export function assessProcess(result, { minimumTests = 1 } = {}) {
  if (!result || result.error || result.signal || result.status !== 0) deny('Node process did not finish successfully');
  if (typeof result.stderr !== 'string' || result.stderr.length !== 0) deny('unexpected stderr from test runner');
  return assessTap(result.stdout, {minimumTests});
}
