#!/usr/bin/env node
/**
 * Read-only analysis of an exact GitHub Actions run. No billing API is read,
 * and a zero-step failure does NOT prove its root cause.
 */
import { pathToFileURL } from "node:url";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function assessRun(run, jobsResponse) {
  if (!run || !Number.isSafeInteger(run.id) || run.id <= 0 ||
      !jobsResponse || !Array.isArray(jobsResponse.jobs)) {
    throw Error("invalid GitHub run or jobs response");
  }
  const jobs = jobsResponse.jobs;
  const complete = Number.isSafeInteger(jobsResponse.total_count) &&
    jobsResponse.total_count === jobs.length;
  const isExecuted = step =>
    step && typeof step === "object" &&
    (step.status === "in_progress" ||
      (step.status === "completed" &&
        ["success", "failure", "cancelled", "timed_out", "neutral"].includes(step.conclusion)) ||
      (typeof step.started_at === "string" && step.started_at.length > 0 &&
        step.conclusion !== "skipped"));
  const normalized = jobs.map((job) => {
    const steps = Array.isArray(job.steps) ? job.steps : null;
    const executed = steps?.filter(isExecuted) ?? null;
    return {
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion ?? null,
      runner_allocated: Number.isSafeInteger(job.runner_id) && job.runner_id > 0,
      step_count: steps?.length ?? null,
      executed_step_count: executed?.length ?? null,
      failed_step_count: executed?.filter(step => step.conclusion === "failure").length ?? null,
    };
  });
  const allCompleted = jobs.length > 0 && jobs.every(j => j.status === "completed");
  const allStepsKnown = normalized.every(j => j.step_count !== null);
  const anyExecuted = normalized.some(j => (j.executed_step_count ?? 0) > 0);
  const allNoSteps = allStepsKnown && normalized.every(j => j.executed_step_count === 0);
  let classification;
  if (!complete) classification = "INCOMPLETE_JOB_LIST";
  else if (!allStepsKnown && jobs.length > 0) classification = "UNKNOWN_STEP_DETAILS";
  else if (jobs.length === 0) classification = "NO_JOBS_RECORDED";
  else if (!allCompleted) classification = "IN_PROGRESS_OR_QUEUED";
  else if (allNoSteps) classification = "NO_EXECUTED_STEPS";
  else if (anyExecuted && jobs.some(j => j.conclusion === "failure"))
    classification = "EXECUTED_STEPS_WITH_FAILURE";
  else if (anyExecuted && jobs.every(j => j.conclusion === "success"))
    classification = "EXECUTED_STEPS_SUCCEEDED";
  else classification = "MIXED_OR_UNKNOWN";

  return {
    run_id: run.id,
    run_attempt: run.run_attempt ?? null,
    run_status: run.status ?? null,
    run_conclusion: run.conclusion ?? null,
    head_sha: run.head_sha ?? null,
    workflow_path: run.path ?? null,
    classification,
    job_list_complete: complete,
    job_count: jobs.length,
    executed_step_count: normalized.reduce((sum, j) => sum + (j.executed_step_count ?? 0), 0),
    jobs: normalized,
    root_cause_established: false,
    guidance: classification === "NO_EXECUTED_STEPS"
      ? "Check the workflow-run banner and organization billing, Actions policies, and runner capacity. The API's zero-step jobs do not identify a billing cause."
      : "Inspect failed executed steps and required checks; a job list alone does not prove compiler conformance.",
    permits_merging: false,
  };
}

async function github(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "oreslang-actions-readiness",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw Error(`GitHub API HTTP ${res.status} for read-only run metadata`);
  return res.json();
}

async function main() {
  const [repo, runInput] = process.argv.slice(2);
  const runId = Number(runInput);
  if (process.argv.length !== 4 || !REPO.test(repo ?? "") ||
      repo.split("/").some(x => x === "." || x === "..") ||
      !Number.isSafeInteger(runId) || runId <= 0) {
    throw Error("usage: node bin/diagnose-actions.mjs owner/repo positive-run-id");
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw Error("GITHUB_TOKEN or GH_TOKEN must be set for private run metadata");
  const path = `/repos/${repo}/actions/runs/${runId}`;
  const run = await github(path, token);
  const jobs = await github(`${path}/jobs?per_page=100&page=1`, token);
  if (run.id !== runId) throw Error("GitHub run identity mismatch");
  const result = assessRun(run, jobs);
  console.log(JSON.stringify(result, null, 2));
  if (result.classification !== "EXECUTED_STEPS_SUCCEEDED" || run.conclusion !== "success" || run.status !== "completed")
    process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Never print bearer tokens or raw response bodies.
    console.error("Actions readiness: " + error.message);
    process.exitCode = 2;
  });
}
