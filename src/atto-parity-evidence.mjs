/**
 * Cross-check an AttoLang parity receipt against independently retrieved
 * GitHub REST metadata and a separately pinned fixture digest ledger.
 *
 * This only checks internal consistency. It DOES NOT authenticate the caller's
 * metadata, establish CI runner trust, verify compiled artifact bytes, or
 * authorize backend promotion or private-source export.
 */
import {validateParityReceipt} from './atto-parity-receipt.mjs';

const REPOSITORIES = Object.freeze({
  java: Object.freeze({name:'ores-truffle-oreslang/oreslang-source.java', id:1400792274}),
  llvm: Object.freeze({name:'ores-truffle-oreslang/oreslang-source.llvm', id:1410897874}),
  net: Object.freeze({name:'ores-truffle-oreslang/oreslang-source.net', id:1419704375}),
  wasm: Object.freeze({name:'ores-truffle-oreslang/oreslang-source.wasm', id:1419858954}),
  forge: Object.freeze({name:'ores-truffle-oreslang/oreslang-source.forge', id:1419703674})
});
const DIGEST = /^[a-f0-9]{64}$/;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const positiveInt = v => Number.isSafeInteger(v) && v > 0;
function requireEvidence(ok, what) {
  if (!ok) throw Error('parity evidence rejected: ' + what);
}
function validTime(t) {
  // GitHub Actions timestamps are UTC RFC 3339 values. Do not admit
  // timezone-less, truncated, normalized-invalid or suffix-bearing dates.
  if (typeof t !== 'string') return false;
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(t);
  if (!match) return false;
  const millis=Date.parse(t);
  if (!Number.isFinite(millis)) return false;
  return new Date(millis).toISOString() ===
    match[1]+'.'+(match[2]??'').padEnd(3,'0')+'Z';
}

export function crossCheckParityReceiptEvidence(receipt, evidence) {
  const base = validateParityReceipt(receipt);
  requireEvidence(isObject(evidence), 'evidence object required');
  const target = REPOSITORIES[receipt.backend];
  const {run, job, commit, fixture_sha256_by_id: fixtures} = evidence;
  requireEvidence(isObject(run) && isObject(job) && isObject(commit), 'run/job/commit metadata required');
  requireEvidence(isObject(run.repository) && run.repository.full_name === target.name &&
    run.repository.id === target.id, 'immutable repository identity');
  requireEvidence(run.id === receipt.run_id && run.run_attempt === receipt.run_attempt &&
    run.head_sha === receipt.head_sha && positiveInt(run.workflow_id), 'workflow identity');
  requireEvidence(['push','pull_request','workflow_dispatch'].includes(run.event) &&
    run.status === 'completed' && run.conclusion === 'success', 'workflow completion');
  requireEvidence(run.html_url === `https://github.com/${target.name}/actions/runs/${receipt.run_id}`,
    'workflow URL identity');
  requireEvidence(commit.sha === receipt.head_sha && isObject(commit.commit) &&
    isObject(commit.commit.tree) && commit.commit.tree.sha === receipt.tree_sha &&
    commit.html_url === `https://github.com/${target.name}/commit/${receipt.head_sha}`,
    'pinned source commit/tree identity');
  requireEvidence(positiveInt(job.id) && job.run_id === receipt.run_id &&
    job.head_sha === receipt.head_sha, 'job identity');
  requireEvidence(job.status === 'completed' && job.conclusion === 'success' &&
    positiveInt(job.runner_id) && typeof job.runner_name === 'string' && job.runner_name.length > 0,
    'allocated runner and successful job');
  requireEvidence(job.html_url === `https://github.com/${target.name}/actions/runs/${receipt.run_id}/job/${job.id}`,
    'job URL identity');
  requireEvidence(validTime(job.started_at) && validTime(job.completed_at) &&
    Date.parse(job.completed_at) >= Date.parse(job.started_at), 'job timing');
  requireEvidence(Array.isArray(job.steps) && job.steps.length > 0 && job.steps.length <= 500,
    'step metadata required');
  const uniqueNumbers = new Set();
  let expectedStep = 1;
  let completed = 0;
  let actualUserSteps = 0;
  for (const s of job.steps) {
    requireEvidence(isObject(s) && positiveInt(s.number) && !uniqueNumbers.has(s.number) &&
      typeof s.name === 'string' && s.name.length > 0 && s.name.length <= 512,
      'step identity');
    // GitHub job step numbers must form an unbroken, ordered sequence.
    // A missing step could otherwise hide a failed or skipped compiler action.
    requireEvidence(s.number === expectedStep++, 'discontinuous job step sequence');
    requireEvidence(!/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/.test(s.name),
      'unsafe job step name');
    uniqueNumbers.add(s.number);
    // A completed GitHub Actions job cannot certify a still-pending step.
    // A forged extra pending step previously passed when one user step succeeded.
    requireEvidence(s.status === 'completed', 'unfinished step in completed job');
    requireEvidence(s.conclusion === 'success' || s.conclusion === 'skipped' || s.conclusion === 'neutral' ||
      s.conclusion === null, 'step conclusion');
    if (s.status === 'completed' && s.conclusion === 'success') {
      completed++;
      if (!/^(Set up job|Complete job|Post )/.test(s.name)) actualUserSteps++;
    }
  }
  requireEvidence(completed > 0 && actualUserSteps > 0 &&
    actualUserSteps >= receipt.executed_steps, 'nonzero executed user steps');
  requireEvidence(isObject(fixtures), 'pinned fixture digest ledger required');
  const expectedIds = receipt.cases.map(c => c.id).sort();
  const ledgerIds = Object.keys(fixtures).sort();
  requireEvidence(expectedIds.length === ledgerIds.length &&
    expectedIds.every((id, i) => id === ledgerIds[i]), 'fixture ledger case identity');
  for (const c of receipt.cases) {
    requireEvidence(typeof fixtures[c.id] === 'string' && DIGEST.test(fixtures[c.id]) &&
      fixtures[c.id] === c.source_sha256, 'pinned fixture digest mismatch');
  }
  return Object.freeze({
    ...base,
    external_metadata_consistent: true,
    provenance_authenticated: false,
    actual_guest_execution_attested: false,
    publicly_promotable: false
  });
}
