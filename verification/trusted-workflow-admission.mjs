// Source-free GitHub API job/run provenance gate. Not a native guest attestation,
// security approval, source export permit, or release certification.
const SHA40 = /^[0-9a-f]{40}$/;
const BACKENDS = new Set(['java', 'llvm', 'wasm', 'cranelift', 'net']);
const POSITIVE_INT = x => Number.isSafeInteger(x) && x > 0;
const fail = reason => { throw new Error(`workflow admission: ${reason}`); };
const validLine = s => typeof s === 'string' && s.length > 0 &&
  Buffer.byteLength(s, 'utf8') <= 4096 && s.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u.test(s);
// Date.parse normalizes impossible Gregorian dates and truncates fractional
// seconds to milliseconds. Validate the canonical calendar/clock prefix, then
// compare exact UTC nanoseconds so sub-millisecond ordering cannot be forged.
const instant = s => {
  if (typeof s !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(s)) return null;
  const ms=Date.parse(s);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,19) !== s.slice(0,19))
    return null;
  const fraction=s.match(/\.(\d{1,9})Z$/)?.[1] ?? '';
  return BigInt(Math.floor(ms/1000))*1000000000n + BigInt(fraction.padEnd(9,'0'));
};
const requireInterval = (start, end, label) => {
  const a=instant(start), b=instant(end);
  if (a===null || b===null || b<a) fail(`invalid ${label} interval`);
  return [a,b];
};

/**
 * Trust contract: readRun, readCommit, readJobs and readPullRequest MUST be authenticated,
 * independently retrieved GitHub REST API reads using an approved source-org
 * credential. Never provide fields copied from the untrusted claim/receipt.
 * Required jobs must be a verifier-owned allowlist, not selected by the claim.
 * The returned record is only a job/step provenance observation, never a
 * compiler, guest, review, sandbox or source-transfer certification.
 */
export async function verifyTrustedWorkflowAdmission({backend, repository, runId, attempt,
    commitSha, treeSha, workflowPath, workflowId, pullRequestNumber, requiredJobs, readRun, readCommit, readJobs, readPullRequest}) {
  if (!BACKENDS.has(backend) || repository !== `ores-truffle-oreslang/oreslang-source.${backend}` &&
      !(backend === 'java' && repository === 'ores-truffle-oreslang/oreslang-source.java'))
    fail('unapproved source repository identity');
  if (!POSITIVE_INT(runId) || !POSITIVE_INT(attempt) || !SHA40.test(commitSha) || !SHA40.test(treeSha))
    fail('missing immutable source/run identity');
  if (typeof workflowPath !== 'string' || !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflowPath))
    fail('invalid workflow path');
  if (!POSITIVE_INT(workflowId) || !POSITIVE_INT(pullRequestNumber))
    fail('missing verifier-owned workflow or pull request identity');
  if (!Array.isArray(requiredJobs) || !requiredJobs.length || requiredJobs.length > 16 ||
      new Set(requiredJobs).size !== requiredJobs.length || !requiredJobs.every(validLine))
    fail('invalid verifier-owned job allowlist');
  if (![readRun, readCommit, readJobs, readPullRequest].every(f => typeof f === 'function'))
    fail('independent API readers required');

  const [run, commit, response, currentPr] = await Promise.all([
    readRun({repository, runId}),
    readCommit({repository, commitSha}),
    readJobs({repository, runId, attempt}),
    readPullRequest({repository, pullRequestNumber}),
  ]);
  if (!run || run.id !== runId || run.run_attempt !== attempt || run.head_sha !== commitSha ||
      run.workflow_id !== workflowId ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      !(run.path === workflowPath || run.path?.startsWith(workflowPath + '@')) ||
      run.event !== 'pull_request' || run.status !== 'completed' ||
      run.conclusion !== 'success') fail('run identity or completion mismatch');
  // GitHub's authenticated workflow run must identify the intended PR, not
  // merely any successful run for the same source commit and workflow path.
  // Require one unambiguous PR association to this exact source head.
  // A matching PR number alone can falsely credit a stale source commit.
  const associated = Array.isArray(run.pull_requests)
    ? run.pull_requests.filter(pr => pr && pr.number === pullRequestNumber) : [];
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length < 1 ||
      run.pull_requests.length > 32 || associated.length !== 1 ||
      associated[0].head?.sha !== commitSha)
    fail('run not associated with the exact-head verifier-owned pull request');
  // Run metadata identifies its historical PR head. A separate current PR
  // read prevents a formerly successful run from being reused after a push.
  if (!currentPr || currentPr.number !== pullRequestNumber ||
      currentPr.state !== 'open' || currentPr.head?.sha !== commitSha ||
      currentPr.head?.repo?.full_name !== repository ||
      currentPr.base?.repo?.full_name !== repository)
    fail('current pull request head or repository mismatch');
  // Exact-head PR CI can become stale even when the source branch does not
  // move: a changed target branch/base commit changes the integration tree.
  // Require the authenticated run's historical PR base to match the current
  // target ref AND commit, not merely the current source head SHA.
  const historicalBase=associated[0].base;
  if (!historicalBase || !SHA40.test(historicalBase.sha) ||
      !SHA40.test(currentPr.base?.sha) ||
      !validLine(historicalBase.ref) || !validLine(currentPr.base?.ref) ||
      historicalBase.ref !== currentPr.base.ref ||
      historicalBase.sha !== currentPr.base.sha)
    fail('run and current pull request base mismatch');
  // A matching SHA can be present on multiple refs. Bind run, run's PR
  // association, and current PR to the same live source branch.
  if (!validLine(currentPr.head?.ref) ||
      run.head_branch !== currentPr.head.ref ||
      associated[0].head?.ref !== currentPr.head.ref)
    fail('run and current pull request branch mismatch');
  if (!commit || commit.sha !== commitSha || commit.tree?.sha !== treeSha)
    fail('unverified exact source Git tree');
  if (!response || !Number.isSafeInteger(response.total_count) || response.total_count < 1 ||
      response.total_count > 32 || !Array.isArray(response.jobs) ||
      response.jobs.length !== response.total_count)
    fail('missing, oversized or truncated jobs API page');

  const byName=new Map(), ids=new Set();
  for (const job of response.jobs) {
    if (!job || !POSITIVE_INT(job.id) || ids.has(job.id) || !validLine(job.name))
      fail('duplicate or malformed job identity');
    ids.add(job.id);
    if (job.run_id !== runId || job.run_attempt !== attempt || job.head_sha !== commitSha)
      fail('job run attempt/head mismatch');
    if (byName.has(job.name)) fail('duplicate job name');
    byName.set(job.name, job);
  }
  const checked=[];
  for (const name of requiredJobs) {
    const job=byName.get(name);
    if (!job || !POSITIVE_INT(job.runner_id) || !validLine(job.runner_name) ||
        job.status !== 'completed' || job.conclusion !== 'success' ||
        !Array.isArray(job.steps) || job.steps.length < 1 || job.steps.length > 256)
      fail('required job unassigned, skipped or unexecuted');
    const [jobStart,jobEnd]=requireInterval(job.started_at,job.completed_at,'job');
    let previousStepEnd=jobStart;
    for (let i=0;i<job.steps.length;i++) {
      const s=job.steps[i];
      if (!s || s.number !== i+1 || !validLine(s.name) || s.status !== 'completed' ||
          s.conclusion !== 'success') fail('required job step missing, failed or out of order');
      const [a,b]=requireInterval(s.started_at,s.completed_at,'step');
      if (a<jobStart || b>jobEnd) fail('step time outside assigned job');
      if (a<previousStepEnd) fail('overlapping or out-of-order job steps');
      previousStepEnd=b;
    }
    checked.push(Object.freeze({name, jobId:job.id, runnerId:job.runner_id,
      executedStepCount:job.steps.length}));
  }
  return Object.freeze({classification:'executed_success_api_metadata_only', repository,
    backend, runId, attempt, commitSha, treeSha, workflowId, pullRequestNumber,
    checkedJobs:Object.freeze(checked),
    nativeVerified:false, sourceTransferAuthorized:false, independentlyReviewed:false});
}


/** GitHub REST reader factory. The credential stays on the caller's source-org
 * runner; the API returns metadata only. No compiler/source bytes transferred. */
export function createAuthenticatedGitHubReaders({token, fetchImpl=globalThis.fetch}) {
  if (typeof token !== 'string' || token.trim() === '' || /[\r\n]/.test(token) ||
      typeof fetchImpl !== 'function') fail('authenticated GitHub API credential required');
  async function get(repository, path) {
    if (!/^ores-truffle-oreslang\/oreslang-source\.(?:java|llvm|wasm|cranelift|net)$/.test(repository))
      fail('GitHub API source repository not approved');
    if (!/^\/(?:actions\/runs\/|git\/commits\/|pulls\/)/.test(path)) fail('unapproved GitHub API path');
    const url=`https://api.github.com/repos/${repository}${path}`;
    const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json',
        'x-github-api-version':'2022-11-28'}});
    if (!response || response.status !== 200 || typeof response.body?.getReader !== 'function')
      fail(`authoritative GitHub API request rejected (HTTP ${response?.status ?? 'unknown'})`);
    const lengthHeader=response.headers?.get?.('content-length');
    const declared=lengthHeader===null || lengthHeader===undefined ? null : Number(lengthHeader);
    if (declared!==null && (!Number.isSafeInteger(declared) || declared < 0 || declared > 256*1024))
      fail('GitHub API response too large or invalid content length');
    // Do not use Response.arrayBuffer(): a missing Content-Length could make
    // an untrusted HTTP response allocate arbitrarily many bytes.
    const reader=response.body.getReader(), parts=[];
    let size=0, complete=false;
    try {
      for (let i=0;i<1024;i++) {
        const {done,value}=await reader.read();
        if (done) {complete=true;break;}
        if (!(value instanceof Uint8Array)) fail('malformed GitHub API body chunk');
        size+=value.byteLength;
        if (size>256*1024) fail('missing or oversized GitHub API JSON');
        parts.push(value);
      }
      if (!complete || size===0 || (declared!==null && declared!==size))
        fail('missing, truncated or overly fragmented GitHub API JSON');
    } catch (error) {
      try {await reader.cancel();} catch { /* cancellation is best effort */ }
      throw error;
    }
    const bytes=new Uint8Array(size);
    let offset=0;
    for (const part of parts) {bytes.set(part,offset); offset+=part.byteLength;}
    let json;
    try {json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch {fail('invalid authoritative GitHub API JSON');}
    return json;
  }
  return Object.freeze({
    readRun:({repository,runId})=>POSITIVE_INT(runId)
      ? get(repository,`/actions/runs/${runId}`) : Promise.reject(Error('invalid GitHub run ID')),
    readCommit:({repository,commitSha})=>SHA40.test(commitSha)
      ? get(repository,`/git/commits/${commitSha}`) : Promise.reject(Error('invalid Git commit SHA')),
    readJobs:({repository,runId,attempt})=>POSITIVE_INT(runId) && POSITIVE_INT(attempt)
      ? get(repository,`/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`)
      : Promise.reject(Error('invalid GitHub run attempt')),
    readPullRequest:({repository,pullRequestNumber})=>POSITIVE_INT(pullRequestNumber)
      ? get(repository,`/pulls/${pullRequestNumber}`)
      : Promise.reject(Error('invalid GitHub pull request number')), 
  });
}
