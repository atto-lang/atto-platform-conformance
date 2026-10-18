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
const isHousekeeping = name => HOUSEKEEPING.has(name) || (typeof name === "string" && /^(Pre |Post )/.test(name));
const isExecuted = step => step && typeof step === "object" &&
  step.status === "completed" && STEP_CONCLUSIONS.has(step.conclusion);
const isFailed = step => step && step.status === "completed" && ["failure", "timed_out"].includes(step.conclusion);

export function assessRun(run, jobsResponse) {
  if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 ||
      !jobsResponse || !Array.isArray(jobsResponse.jobs)) {
    throw Error("invalid GitHub run or jobs response");
  }
  const jobs = jobsResponse.jobs;
  const complete = Number.isSafeInteger(jobsResponse.total_count) &&
    jobsResponse.total_count === jobs.length;
  const runHeadValid = typeof run.head_sha === "string" && SHA.test(run.head_sha);
  const normalized = jobs.map(job => {
    const steps = Array.isArray(job?.steps) ? job.steps : null;
    const executed = steps?.filter(isExecuted) ?? null;
    const failing = steps?.filter(isFailed) ?? null;
    const runnerAllocated = Number.isSafeInteger(job?.runner_id) && job.runner_id > 0;
    const jobHeadMatch = job?.head_sha == null ? "UNKNOWN" :
      runHeadValid && job.head_sha === run.head_sha ? "VERIFIED" : "MISMATCH";
    let classification;
    if (job?.status !== "completed") classification = "PENDING_OR_QUEUED";
    else if (job?.conclusion === "skipped") classification = "SKIPPED";
    else if (job?.conclusion === "cancelled") classification = "CANCELLED";
    else if (!steps) classification = job?.conclusion === "failure" ? "UNOBSERVED_FAILURE" : "STEPS_UNAVAILABLE";
    else if (failing.length) classification = failing.some(s => s.conclusion === "failure")
      ? "EXECUTED_STEP_FAILURE" : "EXECUTED_STEP_TIMEOUT";
    else if (job?.conclusion === "failure" && steps.length === 0) classification = "OBSERVED_NO_STEP_FAILURE";
    else if (job?.conclusion === "failure" && executed.length === 0) classification = "FAILED_JOB_WITH_NO_EXECUTED_STEP";
    else if (job?.conclusion === "failure") classification = "FAILED_JOB_WITHOUT_FAILED_STEP";
    else if (job?.conclusion === "timed_out") classification = "TIMED_OUT_UNATTRIBUTED";
    else if (job?.conclusion === "success" && executed.length) classification = "EXECUTED_STEPS_SUCCEEDED";
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
      classification,
    };
  });
  const kinds = new Set(normalized.map(j => j.classification));
  const priority = ["EXECUTED_STEP_FAILURE", "EXECUTED_STEP_TIMEOUT", "UNOBSERVED_FAILURE",
    "OBSERVED_NO_STEP_FAILURE", "FAILED_JOB_WITHOUT_FAILED_STEP", "FAILED_JOB_WITH_NO_EXECUTED_STEP",
    "PENDING_OR_QUEUED", "CANCELLED", "SKIPPED", "STEPS_UNAVAILABLE", "TIMED_OUT_UNATTRIBUTED",
    "SUCCESS_WITHOUT_EXECUTION_EVIDENCE", "OTHER_STATUS"];
  let classification = !complete ? "INCOMPLETE_JOB_LIST" : jobs.length === 0 ? "NO_JOBS_RECORDED" :
    priority.find(x => kinds.has(x)) || (kinds.size === 1 && kinds.has("EXECUTED_STEPS_SUCCEEDED")
      ? "EXECUTED_STEPS_SUCCEEDED" : "MIXED_OR_UNKNOWN");
  if (classification === "EXECUTED_STEPS_SUCCEEDED" &&
      (run.status !== "completed" || run.conclusion !== "success")) classification = "RUN_JOB_STATE_MISMATCH";
  const observedExecuted = normalized.reduce((sum,j)=>sum+(j.executed_step_count??0),0);
  const observedFailed = normalized.reduce((sum,j)=>sum+(j.failed_step_count??0),0);
  const unknownStepJobs = normalized.filter(j=>j.step_count===null).length;
  return {
    run_id:run.id, run_attempt:run.run_attempt ?? null,
    run_status:run.status ?? null, run_conclusion:run.conclusion ?? null,
    head_sha:run.head_sha ?? null, workflow_path:run.path ?? null,
    exact_run_head_sha_valid:runHeadValid,
    all_job_head_shas_verified:runHeadValid && normalized.every(j => j.head_sha_match === "VERIFIED"),
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

export async function readAllJobs(path,fetcher=github) {
  let total=null;
  const jobs=[];
  for (let page=1;page<=10;page++) {
    const data=await fetcher(path + "/jobs?per_page=100&page=" + page);
    if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 ||
        !Array.isArray(data.jobs) || data.jobs.length>100 ||
        (total!==null && total!==data.total_count)) throw Error("invalid or changing GitHub jobs pagination");
    total=data.total_count;
    jobs.push(...data.jobs);
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
  const result=assessRun(run,jobs);
  console.log(JSON.stringify(result,null,2));
  if(result.classification!=="EXECUTED_STEPS_SUCCEEDED" ||
      !result.all_job_head_shas_verified) process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error("Actions readiness: "+error.message);process.exitCode=2;});
}
