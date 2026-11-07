// Independent runner-execution evidence, strictly narrower than guest
// ownership verification. Read-only GitHub REST resources are fetched
// independently; no receipt self-report can supply steps or tree identity.
// NEVER expose a passing compiler/guest verdict from this module.
const SHA40=/^[a-f0-9]{40}$/;
const REPO=/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const DIGITS=/^[1-9][0-9]{0,15}$/;

function validInt(x) {
  return Number.isSafeInteger(x) && x > 0;
}
function expect(condition, reason) {
  if (!condition) throw new Error(reason);
}
function fail(error) {
  return {
    ok:false, verified:false, runnerExecutionVerified:false,
    sourceTreeVerified:false, guestExecutionVerified:false,
    status:'RUNNER_PROVENANCE_UNVERIFIED',errors:[error]
  };
}
// Caller must authenticate the source GitHub account and provide an
// independently selected expectedHead, not a value from the receipt.
// read(path) MUST perform a fresh read from that repository's GitHub API.
export async function inspectExactHeadRunner({repository, expectedHead, runId,
  attempt, jobId, requiredSteps, read}) {
  try {
    expect(typeof repository==='string' && REPO.test(repository),
      'INVALID_REPOSITORY');
    expect(typeof expectedHead==='string' && SHA40.test(expectedHead),
      'INVALID_EXPECTED_HEAD');
    expect(validInt(runId) && validInt(attempt) && validInt(jobId),
      'INVALID_RUN_OR_JOB_ID');
    expect(Array.isArray(requiredSteps) && requiredSteps.length >= 2 &&
      requiredSteps.length <= 32 && requiredSteps.every(s=>
        typeof s==='string' && s.length>0 && s.length<=120) &&
      new Set(requiredSteps).size===requiredSteps.length,
      'INVALID_REQUIRED_STEPS');
    expect(typeof read==='function','MISSING_INDEPENDENT_READER');

    const base='/repos/'+repository;
    const [commit, run, list] = await Promise.all([
      read(base+'/git/commits/'+expectedHead),
      read(base+'/actions/runs/'+runId+'/attempts/'+attempt),
      read(base+'/actions/runs/'+runId+'/attempts/'+attempt+'/jobs?per_page=100')
    ]);

    expect(commit && commit.sha===expectedHead && commit.tree &&
      typeof commit.tree.sha==='string' && SHA40.test(commit.tree.sha),
      'SOURCE_COMMIT_OR_TREE_UNVERIFIED');
    expect(run && run.id===runId && run.run_attempt===attempt &&
      run.head_sha===expectedHead,'RUN_ATTEMPT_HEAD_MISMATCH');
    expect(run.status==='completed' && run.conclusion==='success',
      'RUN_NOT_SUCCESSFULLY_COMPLETED');
    // The queried endpoint itself identifies the authoritative repo.
    // If the API includes a repository object, it must agree.
    if (run.repository != null)
      expect(run.repository.full_name===repository,'RUN_REPOSITORY_MISMATCH');

    expect(list && Number.isSafeInteger(list.total_count) &&
      list.total_count>=1 && list.total_count<=100 &&
      Array.isArray(list.jobs) && list.jobs.length===list.total_count,
      'INCOMPLETE_ATTEMPT_JOB_LIST');
    const job=list.jobs.find(j=>j && j.id===jobId);
    expect(job && job.run_id===runId && job.run_attempt===attempt,
      'JOB_NOT_IN_EXACT_ATTEMPT');
    expect(job.status==='completed' && job.conclusion==='success',
      'JOB_NOT_EXECUTED_SUCCESSFULLY');
    expect(validInt(job.runner_id) && typeof job.started_at==='string' &&
      Number.isFinite(Date.parse(job.started_at)),
      'NO_ASSIGNED_RUNNER');
    if(job.head_sha!==undefined && job.head_sha!==null)
      expect(job.head_sha===expectedHead,'JOB_HEAD_MISMATCH');
    expect(Array.isArray(job.steps) && job.steps.length>0,
      'ZERO_EXECUTED_STEPS');

    const steps=new Map();
    for(const s of job.steps) {
      expect(s && typeof s.name==='string' && s.name.length>0 &&
        !steps.has(s.name),'DUPLICATE_OR_INVALID_STEP_NAME');
      steps.set(s.name,s);
    }
    for(const name of requiredSteps) {
      const step=steps.get(name);
      expect(step && step.status==='completed' && step.conclusion==='success' &&
        validInt(step.number) && typeof step.started_at==='string' &&
        Number.isFinite(Date.parse(step.started_at)),
        'MISSING_OR_UNEXECUTED_REQUIRED_STEP:'+name);
    }
    return {
      ok:false, verified:false, runnerExecutionVerified:true,
      sourceTreeVerified:true, guestExecutionVerified:false,
      status:'RUNNER_EXECUTION_VERIFIED_GUEST_UNVERIFIED',
      sourceCommit:expectedHead,sourceTree:commit.tree.sha,
      runId,attempt,jobId,executedSteps:job.steps.length,errors:[]
    };
  }catch(e){return fail(e instanceof Error?e.message:'UNTRUSTED_API_ERROR')}
}

// Direct GitHub REST reader; a live caller must run in the SOURCE repository
// with a read-only GitHub token. Reject redirections, non-JSON and failed
// responses. No source blob, artifact, cache or token is exported.
export function githubReadOnlyReader(token, fetchImpl=fetch) {
  expect(typeof token==='string' && token.length>=8, 'MISSING_GITHUB_TOKEN');
  expect(typeof fetchImpl==='function','MISSING_FETCH');
  return async path=>{
    expect(typeof path==='string' && path.startsWith('/repos/') &&
      !path.includes('..') && !path.includes('#'),
      'INVALID_API_PATH');
    const response=await fetchImpl('https://api.github.com'+path,{
      method:'GET', redirect:'error',
      headers:{
        authorization:'Bearer '+token,
        accept:'application/vnd.github+json',
        'x-github-api-version':'2022-11-28'
      }
    });
    expect(response && response.ok===true,'GITHUB_API_NOT_AVAILABLE');
    const json=await response.json();
    expect(json!==null && typeof json==='object','INVALID_GITHUB_RESPONSE');
    return json;
  };
}
