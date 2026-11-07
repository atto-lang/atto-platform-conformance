// Source-free GitHub Actions run/job evidence classifier.
// A positive classification is NOT proof of compiler-backed guest execution.
const own = (obj, key) => {
  if (obj === null || typeof obj !== 'object') throw Error('E_OBJECT');
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (!d || !Object.hasOwn(d, 'value')) throw Error('E_OWN_DATA:'+key);
  return d.value;
};
const posint = (n, field) => {
  if (!Number.isSafeInteger(n) || n <= 0) throw Error('E_INTEGER:'+field);
  return n;
};
const stamp = (s, field) => {
  if (typeof s !== 'string') throw Error('E_TIME:'+field);
  const x = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?Z$/.exec(s);
  if (!x) throw Error('E_TIME:'+field);
  const [y,mo,d,h,mi,se] = x.slice(1,7).map(Number);
  if (y < 1970 || y > 2100 || mo < 1 || mo > 12 || h > 23 || mi > 59 || se > 59)
    throw Error('E_TIME:'+field);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31,30,31,30,31,31,30,31,30,31];
  if (d < 1 || d > days[mo-1]) throw Error('E_TIME:'+field);
  return Date.UTC(y,mo-1,d,h,mi,se,Number((x[7]||'').padEnd(3,'0')));
};
export function classifyRunnerJobEvidence(run, response, expected) {
  if (typeof expected !== 'object' || expected === null) throw Error('E_EXPECTED');
  const repo = own(expected,'repo'), head = own(expected,'headSha');
  const id = posint(own(expected,'runId'),'runId');
  const attempt = posint(own(expected,'attempt'),'attempt');
  const name = own(expected,'jobName');
  const event = own(expected,'event');
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw Error('E_REPO');
  if (typeof head !== 'string' || !/^[0-9a-f]{40}$/.test(head)) throw Error('E_SHA');
  if (typeof name !== 'string' || !name.trim()) throw Error('E_NAME');
  if (!['pull_request','workflow_dispatch'].includes(event)) throw Error('E_EVENT');
  if (own(run,'id') !== id || own(run,'run_attempt') !== attempt || own(run,'head_sha') !== head ||
      own(run,'event') !== event || own(own(run,'repository'),'full_name') !== repo ||
      own(own(run,'head_repository'),'full_name') !== repo) throw Error('E_RUN_IDENTITY');
  const jobs = own(response,'jobs');
  if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > 100 ||
      own(response,'total_count') !== jobs.length) throw Error('E_JOB_INVENTORY');
  const names = new Set(), ids = new Set();
  let selected = null;
  for (const item of jobs) {
    const n = own(item,'name'), j = posint(own(item,'id'),'jobId');
    if (typeof n !== 'string' || !n.trim() || names.has(n) || ids.has(j)) throw Error('E_DUPLICATE_JOB');
    names.add(n); ids.add(j);
    if (n === name) selected = item;
  }
  if (!selected) throw Error('E_EXPECTED_JOB_MISSING');
  if (own(selected,'run_id') !== id || own(selected,'run_attempt') !== attempt ||
      own(selected,'head_sha') !== head) throw Error('E_JOB_IDENTITY');
  const runner = own(selected,'runner_id');
  const steps = own(selected,'steps');
  if (runner === 0 || runner === null) {
    if (steps !== null && (!Array.isArray(steps) || steps.length !== 0)) throw Error('E_CONTRADICTORY_RUNNER');
    return { classification:'RUNNER_NOT_ADMITTED', runId:id, runAttempt:attempt,
             jobId:own(selected,'id'), headSha:head, executedStepCount:0,
             evidence:'API_METADATA_ONLY_NOT_GUEST_PARITY' };
  }
  posint(runner,'runnerId');
  if (typeof own(selected,'runner_name') !== 'string' || !own(selected,'runner_name').trim())
    throw Error('E_RUNNER_NAME');
  if (!Array.isArray(steps) || steps.length === 0) return {
    classification:'STEP_RECORDS_MISSING',runId:id,runAttempt:attempt,jobId:own(selected,'id'),
    headSha:head,executedStepCount:0,evidence:'API_METADATA_ONLY_NOT_GUEST_PARITY'
  };
  const jobStart = stamp(own(selected,'started_at'),'jobStart');
  const jobEnd = stamp(own(selected,'completed_at'),'jobEnd');
  if (jobEnd < jobStart) throw Error('E_JOB_TIME');
  const byName = new Map();
  let lastNumber = 0;
  for (const step of steps) {
    const stepName=own(step,'name'), number=posint(own(step,'number'),'stepNumber');
    if (typeof stepName !== 'string' || !stepName.trim() || byName.has(stepName) || number <= lastNumber)
      throw Error('E_STEP_ORDER');
    lastNumber=number;
    const start=stamp(own(step,'started_at'),'stepStart');
    const end=stamp(own(step,'completed_at'),'stepEnd');
    if (end < start || start < jobStart || end > jobEnd) throw Error('E_STEP_TIME');
    byName.set(stepName,step);
  }
  const required=own(expected,'requiredSteps');
  if (!Array.isArray(required) || required.length === 0 ||
      new Set(required).size !== required.length || required.some(n=>typeof n!=='string'||!n))
    throw Error('E_REQUIRED_STEPS');
  const all = required.every(n => byName.has(n) && own(byName.get(n),'status') === 'completed' &&
                                   own(byName.get(n),'conclusion') === 'success');
  const success = own(run,'status')==='completed' && own(run,'conclusion')==='success' &&
                  own(selected,'status')==='completed' && own(selected,'conclusion')==='success' && all;
  return {classification:success?'STEPFUL_RECORD_REQUIRES_INDEPENDENT_ATTESTATION':'STEPFUL_FAILED_OR_INCOMPLETE',
          runId:id,runAttempt:attempt,jobId:own(selected,'id'),headSha:head,
          executedStepCount:steps.length,evidence:'API_METADATA_ONLY_NOT_GUEST_PARITY'};
}
export const validateRunnerTimestamp = stamp;
