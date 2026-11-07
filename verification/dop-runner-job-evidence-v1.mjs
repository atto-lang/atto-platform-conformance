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
  const targetJobId = posint(own(expected,'jobId'),'expectedJobId');
  const event = own(expected,'event');
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw Error('E_REPO');
  if (typeof head !== 'string' || !/^[0-9a-f]{40}$/.test(head)) throw Error('E_SHA');
  if (typeof name !== 'string' || !name.trim() || name.length > 256)
    throw Error('E_NAME');
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
    // Every job record in this attempt's full inventory must refer to the
    // identical run, immutable PR head, and attempt. Otherwise even a valid
    // selected job can be laundered through a contradictory API response.
    if (typeof n !== 'string' || n.length > 256 ||
        own(item,'run_id') !== id ||
        own(item,'run_attempt') !== attempt ||
        own(item,'head_sha') !== head) throw Error('E_JOB_IDENTITY');
    names.add(n); ids.add(j);
    if (n === name) selected = item;
  }
  if (!selected) throw Error('E_EXPECTED_JOB_MISSING');
  if (own(selected,'id') !== targetJobId) throw Error('E_JOB_IDENTITY');
  // Validate requirements before handling a missing runner.
  const required=own(expected,'requiredSteps');
  if (!Array.isArray(required) || !required.length || required.length > 64 ||
      new Set(required).size !== required.length ||
      required.some(n=>typeof n!=='string'||!n.trim()||n.length>256))
    throw Error('E_REQUIRED_STEPS');
  const runner=own(selected,'runner_id'), runnerName=own(selected,'runner_name');
  const steps=own(selected,'steps');
  const runStatus=own(run,'status'), runConclusion=own(run,'conclusion');
  const jobStatus=own(selected,'status'), jobConclusion=own(selected,'conclusion');
  const beginRaw=own(selected,'started_at'), endRaw=own(selected,'completed_at');
  if (runner === 0 || runner === null) {
    if (steps !== null && (!Array.isArray(steps) || steps.length !== 0) ||
        (runnerName !== '' && runnerName !== null)) throw Error('E_CONTRADICTORY_RUNNER');
    let validTimes=false;
    if (beginRaw != null && endRaw != null) {
      const begin=stamp(beginRaw,'jobStart'), end=stamp(endRaw,'jobEnd');
      if (end < begin) throw Error('E_JOB_TIME');
      validTimes=true;
    }
    // Only explicit zero-runner, empty-step, completed failure records establish
    // a negative admission observation. Null and incomplete API data do not.
    const confirmed=runner===0 && Array.isArray(steps) && validTimes &&
      runStatus==='completed' && runConclusion==='failure' &&
      jobStatus==='completed' && jobConclusion==='failure';
    return {classification:confirmed?'RUNNER_NOT_ADMITTED':'RUNNER_ADMISSION_UNVERIFIED',
      runId:id,runAttempt:attempt,jobId:own(selected,'id'),headSha:head,
      executedStepCount:0,reportedStepCount:Array.isArray(steps)?steps.length:0,
      evidence:'API_METADATA_ONLY_NOT_GUEST_PARITY'};
  }
  posint(runner,'runnerId');
  if (typeof runnerName !== 'string' || !runnerName.trim()) throw Error('E_RUNNER_NAME');
  if (Array.isArray(steps) && steps.length > 256) throw Error('E_STEP_INVENTORY');
  if (!Array.isArray(steps) || steps.length === 0) return {
    classification:'STEP_RECORDS_MISSING',runId:id,runAttempt:attempt,
    jobId:own(selected,'id'),headSha:head,executedStepCount:0,
    reportedStepCount:Array.isArray(steps)?steps.length:0,
    evidence:'API_METADATA_ONLY_NOT_GUEST_PARITY'
  };
  const jobStart=stamp(beginRaw,'jobStart'), jobEnd=stamp(endRaw,'jobEnd');
  if (jobEnd < jobStart) throw Error('E_JOB_TIME');
  const byName=new Map();
  let lastNumber=0, executed=0;
  for (const step of steps) {
    const name=own(step,'name'), number=posint(own(step,'number'),'stepNumber');
    if (typeof name!=='string'||!name.trim()||name.length>256||
        byName.has(name)||number<=lastNumber)
      throw Error('E_STEP_ORDER');
    lastNumber=number;
    const status=own(step,'status'), conclusion=own(step,'conclusion');
    const rawStart=own(step,'started_at'), rawEnd=own(step,'completed_at');
    if ((rawStart==null)!==(rawEnd==null)) throw Error('E_STEP_TIME');
    let hasTimes=false;
    if (rawStart!=null) {
      const st=stamp(rawStart,'stepStart'),en=stamp(rawEnd,'stepEnd');
      if (en<st||st<jobStart||en>jobEnd) throw Error('E_STEP_TIME');
      hasTimes=true;
    }
    // Count timestamped completed work, not API step records or skipped steps.
    const executedStep=hasTimes && status==='completed' &&
      ['success','failure','cancelled','timed_out'].includes(conclusion);
    if(executedStep)executed++;
    byName.set(name,{step,executedStep});
  }
  const all=required.every(n=>{
    const entry=byName.get(n);
    return entry?.executedStep && own(entry.step,'status')==='completed' &&
      own(entry.step,'conclusion')==='success';
  });
  const success=runStatus==='completed'&&runConclusion==='success'&&
    jobStatus==='completed'&&jobConclusion==='success'&&all;
  return {classification:success?'STEPFUL_RECORD_REQUIRES_INDEPENDENT_ATTESTATION':'STEPFUL_FAILED_OR_INCOMPLETE',
    runId:id,runAttempt:attempt,jobId:own(selected,'id'),headSha:head,
    executedStepCount:executed,reportedStepCount:steps.length,
    evidence:'API_METADATA_ONLY_NOT_GUEST_PARITY'};
}
export const validateRunnerTimestamp = stamp;
