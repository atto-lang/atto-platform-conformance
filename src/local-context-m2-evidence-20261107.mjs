/** AttoLang local-context M2: fail-closed, SOURCE-FREE receipt admission.
 * No object returned here attests a compiler execution or establishes parity.
 * The trusted CI verifier must fetch GitHub metadata and artifact bytes itself.
 */
import { createHash } from 'node:crypto';
export const REPO = 'ores-truffle-oreslang/oreslang-source.llvm';
export const PR = 1389;
export const POSITIVE_FIXTURE_PATH = 'tests/fixtures/tasklocal-i64-source.atto';
export const POSITIVE_FIXTURE_BLOB = '7d3fe3b57154f0c780e26283a7467b31f3782561';
// JS "$" can match before a trailing newline: check digest lengths too.
const hex40 = x => typeof x==='string' && x.length===40 && /^[0-9a-f]{40}$/.test(x);
const hex64 = x => typeof x==='string' && x.length===64 && /^[0-9a-f]{64}$/.test(x);
const safeArtifactPath = x => typeof x==='string' && x.length>0 && x.length<=512 &&
    !x.startsWith('/') && !/^[A-Za-z]:/.test(x) && !x.includes('\\') &&
    !x.includes('\0') && x.split('/').every(part => part && part!=='.' && part!=='..');
const safeInt = value => Number.isSafeInteger(value) && value > 0;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (reason, classification='EVIDENCE_REJECTED') => ({classification,reason,canPromote:false});

/** Never treat skipped/pending/unscheduled steps as executed proof. */
export function classifyJob(job) {
  if(!isObject(job) || !safeInt(job.id) || typeof job.name !== 'string') return failure('malformed-job');
  if(job.steps === null || Array.isArray(job.steps) && job.steps.length===0)
    return failure('zero-executed-steps','RUNNER_ADMISSION_FAILURE');
  if(!Array.isArray(job.steps)) return failure('missing-step-list');
  const runnerId=job.runner_id ?? job.runnerId;
  if(!safeInt(runnerId)) return failure('unassigned-runner','RUNNER_ADMISSION_FAILURE');
  if(job.runner_id!==undefined && job.runnerId!==undefined && job.runner_id!==job.runnerId)
    return failure('conflicting-runner-ids');
  if(job.status!=='completed') return failure('job-not-terminal');
  const numbered=new Set();
  for(const step of job.steps){
    if(!isObject(step) || !safeInt(step.number) || typeof step.name!=='string' ||
       !step.name.trim() || numbered.has(step.number)) return failure('invalid-or-duplicate-step');
    numbered.add(step.number);
    if(step.status!=='completed' ||
       !['success','failure','cancelled','timed_out','skipped'].includes(step.conclusion))
      return failure('unfinished-or-unknown-step');
  }
  const executed=job.steps.filter(s=>['success','failure','cancelled','timed_out'].includes(s.conclusion));
  if(!executed.length) return failure('no-concluded-execution','RUNNER_ADMISSION_FAILURE');
  if(job.conclusion!=='success' || executed.some(s=>s.conclusion!=='success'))
    return failure('runner-executed-but-job-not-passing','EXECUTED_NONPASS');
  return {classification:'STEPFUL_JOB_CANDIDATE',executedSteps:executed.length,canPromote:false};
}

const validHead = pin => isObject(pin) && pin.repository===REPO && pin.pr===PR &&
    hex40(pin.head) && hex40(pin.tree) && pin.fixturePath===POSITIVE_FIXTURE_PATH &&
    pin.fixtureBlob===POSITIVE_FIXTURE_BLOB;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exactRun = (run,job,pin) => isObject(run) && safeInt(run.id) && safeInt(run.runAttempt) &&
    run.head===pin.head && run.status==='completed' && run.conclusion==='success' &&
    job.runId===run.id && job.attempt===run.runAttempt;
function validCommands(receipt) {
  return isObject(receipt.commands) &&
    ['compiler','linker','guest'].every(k=>typeof receipt.commands[k]==='string' && receipt.commands[k].trim().length>0);
}
function validArtifact(receipt) {
  return isObject(receipt.artifact) && hex64(receipt.artifact.sha256) &&
    safeArtifactPath(receipt.artifact.path);
}
function positiveEvidence(receipt) {
  if(!validCommands(receipt)||!validArtifact(receipt)) return failure('missing-compiler-link-guest-artifact');
  if(!isObject(receipt.compile) || receipt.compile.exitCode!==0 || receipt.compile.emittedIR!==true ||
      !isObject(receipt.link) || receipt.link.exitCode!==0) return failure('compiler-or-link-not-passing');
  if(!isObject(receipt.guest)||receipt.guest.exitCode!==42 ||
      typeof receipt.guest.stderr!=='string' || !receipt.guest.stderr.includes('SOURCE_TASK_RUNTIME_PASS') ||
      !receipt.guest.stderr.includes('producer_on_carrier=1')) return failure('missing-real-guest-witness');
  if(!hex64(receipt.guest.traceSha256) || hash(Buffer.from(receipt.guest.stderr,'utf8'))!==receipt.guest.traceSha256)
    return failure('guest-trace-digest-mismatch');
  return {classification:'UNATTESTED_GUEST_RECEIPT_CANDIDATE',canPromote:false,reason:'independent-artifact-and-run-readback-required'};
}
function negativeEvidence(receipt) {
  if(!isObject(receipt.compile)||receipt.compile.exitCode!==1 || receipt.compile.emittedIR!==false ||
     receipt.compile.emittedFiles!==0 || typeof receipt.compile.stderr!=='string' ||
     !receipt.compile.stderr.trim()) return failure('invalid-semantic-rejection');
  if(/segmentation fault|internal compiler error|addresssanitizer|threadsanitizer|panicked at|assertion failed|illegal instruction/i.test(receipt.compile.stderr))
    return failure('compiler-crash-not-semantic-rejection');
  if(receipt.guest != null || receipt.artifact != null || receipt.link != null)
    return failure('negative-fixture-must-not-link-or-execute');
  return {classification:'UNATTESTED_NEGATIVE_RECEIPT_CANDIDATE',canPromote:false,reason:'independent-semantic-rejection-readback-required'};
}

/** Evaluate claims for *one* exact source-head GitHub run attempt and fixture.
 * Positive and negative fixture receipts must remain separate. A generated
 * JSON is never independent authority, even if structurally valid.
 */
export function evaluateCandidate(candidate,pin) {
  if(!validHead(pin)) return failure('invalid-canonical-pins');
  if(!isObject(candidate) || !isObject(candidate.pin)) return failure('malformed-receipt');
  if(Object.keys(pin).some(k=>candidate.pin[k]!==pin[k])) return failure('stale-or-substituted-pin','STALE_HEAD');
  if(!isObject(candidate.run) || !isObject(candidate.job)) return failure('missing-run-job');
  if(candidate.run.head!==pin.head) return failure('run-head-mismatch','STALE_HEAD');
  if(!exactRun(candidate.run,candidate.job,pin)) return failure('run-attempt-or-status-mismatch');
  const status=classifyJob(candidate.job);
  if(status.classification!=='STEPFUL_JOB_CANDIDATE') return status;
  if(!isObject(candidate.receipt) || candidate.receipt.runId!==candidate.run.id ||
     candidate.receipt.attempt!==candidate.run.runAttempt || candidate.receipt.jobId!==candidate.job.id ||
     candidate.receipt.tree!==pin.tree || candidate.receipt.fixtureBlob!==pin.fixtureBlob)
     return failure('receipt-provenance-mismatch');
  if(candidate.receipt.kind==='positive') return positiveEvidence(candidate.receipt);
  if(candidate.receipt.kind==='negative') return negativeEvidence(candidate.receipt);
  return failure('unknown-receipt-kind');
}

export function parityVerdict(receipts) {
  // Even five syntactically plausible receipts are not a supply-chain attestation.
  const families=['java','llvm','net','wasm','forge'];
  const counts=Object.fromEntries(families.map(k=>[k,0]));
  if(Array.isArray(receipts))for(const r of receipts)if(r && families.includes(r.backend))counts[r.backend]++;
  return {classification:'PARITY_UNPROVEN',canPromote:false,counts,reason:'require-independent-exact-head-guest-receipts'};
}
