#!/usr/bin/env node
/**
 * Read-only, fail-closed GitHub Actions diagnostic. A run conclusion is NOT a
 * substitute for observed completed execution steps, nor proof of test/parity.
 * Never equate steps:null to steps:[] or assume quota/runner cause.
 */
import {pathToFileURL} from "node:url";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;
const STEP_CONCLUSIONS = new Set(["success", "failure", "cancelled", "timed_out", "neutral"]);
const HOUSEKEEPING = new Set(["Set up job", "Complete job", "Initialize containers", "Start containers", "Stop containers"]);
// Setup and artifact transfers are runner activity, not substantive test execution.
const isHousekeeping = name => {
  if (typeof name !== "string" || !name.trim()) return true;
  const normalized = name.trim();
  return HOUSEKEEPING.has(normalized) ||
    /^(?:Pre |Post )/i.test(normalized) ||
    /^(?:Run )?actions\/(?:checkout|cache|setup-[a-z0-9_-]+|upload-artifact|download-artifact)(?:@[^ ]+)?$/i.test(normalized) ||
    /^(?:Checkout(?: repository| source| code)?|Set up (?:Node|Java|Python|Go|Rust|Ruby|Gradle|Maven)|Cache(?: dependencies)?|Upload artifact|Download artifact)$/i.test(normalized);
};
const isExecuted = step => step && typeof step === "object" &&
  step.status === "completed" && STEP_CONCLUSIONS.has(step.conclusion);
const isFailed = step => step && step.status === "completed" && ["failure", "timed_out"].includes(step.conclusion);

export function assessRun(run, jobsResponse) {
  if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 ||
      !jobsResponse || !Array.isArray(jobsResponse.jobs)) {
    throw Error("invalid GitHub run or jobs response");
  }
  const jobs = jobsResponse.jobs;
  // Duplicate or malformed job identities are not independent executions.
  const ids = new Set();
  for (const job of jobs) {
    if (!job || !Number.isSafeInteger(job.id) || job.id <= 0 || ids.has(job.id))
      throw Error("invalid or duplicate GitHub job identity");
    ids.add(job.id);
  }
  const complete = Number.isSafeInteger(jobsResponse.total_count) &&
    jobsResponse.total_count === jobs.length;
  const runHeadValid = typeof run.head_sha === "string" && SHA.test(run.head_sha);
  const normalized = jobs.map(job => {
    const steps = Array.isArray(job?.steps) ? job.steps : null;
    const executed = steps?.filter(isExecuted) ?? null;
    const failing = steps?.filter(isFailed) ?? null;
    const cancelled = steps?.filter(step => step?.status === "completed" && step.conclusion === "cancelled") ?? null;
    const runnerAllocated = Number.isSafeInteger(job?.runner_id) && job.runner_id > 0;
    const jobHeadMatch = job?.head_sha == null ? "UNKNOWN" :
      runHeadValid && job.head_sha === run.head_sha ? "VERIFIED" : "MISMATCH";
    const jobRunMatch = job?.run_id == null ? "UNKNOWN" :
      job.run_id === run.id ? "VERIFIED" : "MISMATCH";
    const jobAttemptMatch = job?.run_attempt == null ? "UNKNOWN" :
      Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0 &&
      job.run_attempt === run.run_attempt ? "VERIFIED" : "MISMATCH";
    const meaningfulExecution = runnerAllocated &&
      (executed?.some(step => step.conclusion === "success" && !isHousekeeping(step.name)) ?? false) &&
      cancelled?.length === 0;
    let classification;
    if (!job?.status) classification = "UNKNOWN_JOB_STATUS";
    else if (job.status !== "completed") classification = "PENDING_OR_QUEUED";
    else if (job?.conclusion === "skipped") classification = "SKIPPED";
    else if (job?.conclusion === "cancelled") classification = "CANCELLED";
    else if (!steps) classification = job?.conclusion === "failure" ? "UNOBSERVED_FAILURE" : "STEPS_UNAVAILABLE";
    else if (failing.length) classification = failing.some(s => s.conclusion === "failure")
      ? "EXECUTED_STEP_FAILURE" : "EXECUTED_STEP_TIMEOUT";
    else if (cancelled?.length) classification = "EXECUTED_STEP_CANCELLED";
    else if (job?.conclusion === "failure" && steps.length === 0) classification = "OBSERVED_NO_STEP_FAILURE";
    else if (job?.conclusion === "failure" && executed.length === 0) classification = "FAILED_JOB_WITH_NO_EXECUTED_STEP";
    else if (job?.conclusion === "failure") classification = "FAILED_JOB_WITHOUT_FAILED_STEP";
    else if (job?.conclusion === "timed_out") classification = "TIMED_OUT_UNATTRIBUTED";
    else if (job?.conclusion === "success" && meaningfulExecution) classification = "EXECUTED_STEPS_SUCCEEDED";
    else if (job?.conclusion === "success") classification = "SUCCESS_WITHOUT_EXECUTION_EVIDENCE";
    else classification = "OTHER_STATUS";
    return {
      id:job?.id ?? null, name:job?.name ?? null, status:job?.status ?? null,
      conclusion:job?.conclusion ?? null, runner_allocated:runnerAllocated,
      step_count:steps?.length ?? null,
      executed_step_count:executed?.length ?? null,
      failed_step_count:failing?.length ?? null,
      failed_steps:failing?.map(step => ({number:step.number ?? null, name:step.name ?? null,
        conclusion:step.conclusion, housekeeping:isHousekeeping(step.name)})) ?? null,
      head_sha_match:jobHeadMatch,
      run_id_match:jobRunMatch,
      run_attempt_match:jobAttemptMatch,
      meaningful_executed_step_count:executed?.filter(s=>s.conclusion === "success" && !isHousekeeping(s.name)).length ?? null,
      classification,
    };
  });
  const kinds = new Set(normalized.map(j => j.classification));
  const priority = ["EXECUTED_STEP_FAILURE", "EXECUTED_STEP_TIMEOUT", "EXECUTED_STEP_CANCELLED", "UNOBSERVED_FAILURE",
    "OBSERVED_NO_STEP_FAILURE", "FAILED_JOB_WITHOUT_FAILED_STEP", "FAILED_JOB_WITH_NO_EXECUTED_STEP",
    "PENDING_OR_QUEUED", "CANCELLED", "SKIPPED", "STEPS_UNAVAILABLE", "TIMED_OUT_UNATTRIBUTED",
    "SUCCESS_WITHOUT_EXECUTION_EVIDENCE", "UNKNOWN_JOB_STATUS", "OTHER_STATUS"];
  let classification = !complete ? "INCOMPLETE_JOB_LIST" : jobs.length === 0 ? "NO_JOBS_RECORDED" :
    priority.find(x => kinds.has(x)) || (kinds.size === 1 && kinds.has("EXECUTED_STEPS_SUCCEEDED")
      ? "EXECUTED_STEPS_SUCCEEDED" : "MIXED_OR_UNKNOWN");
  // Never attribute an observed failure OR apparent success to the requested
  // commit/attempt when GitHub's job records explicitly identify another one.
  // Preserve per-job classifications so the mismatch does not hide raw evidence.
  const conflictingIdentity = normalized.some(j =>
    j.head_sha_match === "MISMATCH" ||
    j.run_id_match === "MISMATCH" ||
    j.run_attempt_match === "MISMATCH");
  if (complete && conflictingIdentity) classification = "JOB_IDENTITY_MISMATCH";
  else if (classification === "EXECUTED_STEPS_SUCCEEDED" &&
      (run.status !== "completed" || run.conclusion !== "success")) classification = "RUN_JOB_STATE_MISMATCH";
  const observedExecuted = normalized.reduce((sum,j)=>sum+(j.executed_step_count??0),0);
  const observedFailed = normalized.reduce((sum,j)=>sum+(j.failed_step_count??0),0);
  const unknownStepJobs = normalized.filter(j=>j.step_count===null).length;
  return {
    run_id:run.id, run_attempt:run.run_attempt ?? null,
    run_status:run.status ?? null, run_conclusion:run.conclusion ?? null,
    head_sha:run.head_sha ?? null, workflow_path:run.path ?? null,
    exact_run_head_sha_valid:runHeadValid,
    all_job_head_shas_verified:runHeadValid && jobs.length > 0 &&
      normalized.every(j => j.head_sha_match === "VERIFIED"),
    all_job_run_ids_verified:jobs.length > 0 &&
      normalized.every(j => j.run_id_match === "VERIFIED"),
    all_job_run_attempts_verified:jobs.length > 0 &&
      normalized.every(j => j.run_attempt_match === "VERIFIED"),
    classification, job_classifications:[...kinds].sort(),
    job_list_complete:complete, job_count:jobs.length,
    executed_step_count:unknownStepJobs ? null : observedExecuted,
    failed_step_count:unknownStepJobs ? null : observedFailed,
    observed_executed_step_count:observedExecuted,
    observed_failed_step_count:observedFailed,
    unobserved_job_count:unknownStepJobs,
    jobs:normalized, root_cause_established:false,
    guidance:"Use exact head SHA, job/step details, run banner and independent billing evidence. No runner, quota, native compiler, or test result may be inferred from a workflow conclusion alone.",
    permits_merging:false,
  };
}

async function github(path,token) {
  let res;
  try {
    res = await fetch("https://api.github.com" + path, {
      headers:{Accept:"application/vnd.github+json",Authorization:"Bearer " + token,
        "X-GitHub-Api-Version":"2022-11-28", "User-Agent":"oreslang-actions-readiness"},
      redirect:"error", signal:AbortSignal.timeout(10000),
    });
  } catch { throw Error("GitHub API read-only request failed"); }
  if (!res?.ok) throw Error("GitHub API HTTP " + (res?.status ?? "unknown") + " for read-only run metadata");
  try { return await res.json(); } catch { throw Error("GitHub returned invalid run metadata JSON"); }
}

// Require a stable run snapshot before and after fetching paginated job records.
export function verifyStableRunSnapshot(before,after) {
  if (!before || !after || !Number.isSafeInteger(before.id) || before.id <= 0 ||
      !Number.isSafeInteger(before.run_attempt) || before.run_attempt <= 0 ||
      typeof before.head_sha !== "string" || !SHA.test(before.head_sha) ||
      !Number.isSafeInteger(before.workflow_id) || before.workflow_id <= 0 ||
      typeof before.path !== "string" || before.path.length===0)
    throw Error("invalid initial GitHub run identity");
  for (const key of ["id","run_attempt","head_sha","workflow_id","path","status","conclusion"]) {
    if (before[key]!==after[key]) throw Error("GitHub run changed during read-only evidence collection");
  }
  for (const nested of ["repository","head_repository"]) {
    if (before[nested]?.id !== after[nested]?.id ||
        !Number.isSafeInteger(before[nested]?.id) || before[nested].id<=0)
      throw Error("GitHub run repository identity changed or is unobserved");
  }
  return true;
}

export async function readAllJobs(path,fetcher=github) {
  let total=null;
  const jobs=[];
  for (let page=1;page<=10;page++) {
    const data=await fetcher(path + "/jobs?filter=latest&per_page=100&page=" + page);
    if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 ||
        !Array.isArray(data.jobs) || data.jobs.length>100 ||
        (total!==null && total!==data.total_count)) throw Error("invalid or changing GitHub jobs pagination");
    total=data.total_count;
    jobs.push(...data.jobs);
    const ids=new Set();
    for (const job of jobs) {
      if (!job || !Number.isSafeInteger(job.id) || job.id<=0 || ids.has(job.id))
        throw Error("invalid or duplicate GitHub jobs pagination identity");
      ids.add(job.id);
    }
    if(jobs.length===total) return {total_count:total,jobs};
    if(jobs.length>total || data.jobs.length!==100) throw Error("incomplete GitHub jobs pagination");
  }
  throw Error("GitHub jobs pagination exceeded the supported page bound");
}

async function main() {
  const [repo,runInput]=process.argv.slice(2);
  const runId=Number(runInput);
  if (process.argv.length!==4 || !REPO.test(repo??"") ||
      repo.split("/").some(x => x==="." || x==="..") ||
      !Number.isSafeInteger(runId) || runId<=0) {
    throw Error("usage: node bin/diagnose-actions.mjs owner/repo positive-run-id");
  }
  const token=process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if(!token) throw Error("GITHUB_TOKEN or GH_TOKEN must be set for private run metadata");
  const path="/repos/" + repo + "/actions/runs/" + runId;
  const run=await github(path,token);
  if(run.id!==runId) throw Error("GitHub run identity mismatch");
  const jobs=await readAllJobs(path,p=>github(p,token));
  verifyStableRunSnapshot(run,await github(path,token));
  const result=assessRun(run,jobs);
  console.log(JSON.stringify(result,null,2));
  if(result.classification!=="EXECUTED_STEPS_SUCCEEDED" ||
      !result.all_job_head_shas_verified ||
      !result.all_job_run_ids_verified ||
      !result.all_job_run_attempts_verified) process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error("Actions readiness: "+error.message);process.exitCode=2;});
}
