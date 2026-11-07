#!/usr/bin/env node
// Read-only provider fetcher. This intentionally has no PUT/POST/PATCH/DELETE capabilities.
import {readFile} from 'node:fs/promises';
import {assessPullRequest, assessWave} from '../src/merge-wave-readiness-v1.mjs';
const base = 'https://api.github.com';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const ident = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function pages(path) {
  const all = [];
  for (let p = 1; p <= 10; p++) {
    const response = await fetch(base+path+(path.includes('?') ? '&' : '?')+'per_page=100&page='+p, {
      headers: {Accept:'application/vnd.github+json',Authorization:'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28'}, redirect:'error'});
    if (!response.ok) throw new Error('GitHub provider error '+response.status+' for '+path);
    const body = await response.json();
    if (Array.isArray(body)) { all.push(...body); if (body.length < 100) return all; }
    else if (Array.isArray(body.workflow_runs)) {
      all.push(...body.workflow_runs); if (body.workflow_runs.length < 100) return all;
    } else if (Array.isArray(body.jobs)) {
      all.push(...body.jobs); if (body.jobs.length < 100) return all;
    } else return body;
  }
  throw new Error('Provider pagination limit exceeded for '+path);
}

async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error('Usage: node bin/merge-wave-readiness.mjs path/to/manifest.json');
  if (!token) throw new Error('Missing GITHUB_TOKEN or GH_TOKEN; no unauthenticated fallback');
  const manifest = JSON.parse(await readFile(path,'utf8'));
  if (!Array.isArray(manifest.prs) || manifest.prs.length < 1 || manifest.prs.length > 20) throw new Error('Manifest must contain 1–20 PRs');
  const entries = [];
  for (const spec of manifest.prs) {
    if (!ident.test(spec.repo || '') || !Number.isSafeInteger(spec.number) || spec.number < 1 ||
        !/^[a-f0-9]{40}$/i.test(spec.expectedHead || '') ||
        !/^[a-f0-9]{40}$/i.test(spec.expectedBaseSha || '') ||
        !Array.isArray(spec.requiredStepNames) || spec.requiredStepNames.length === 0)
      throw new Error('Invalid pinned PR identity');
    const path = '/repos/'+spec.repo;
    const [pr, reviews, runs] = await Promise.all([
      pages(path+'/pulls/'+spec.number), pages(path+'/pulls/'+spec.number+'/reviews'),
      pages(path+'/actions/runs?head_sha='+spec.expectedHead+'&event=pull_request')]);
    const current = runs.filter(r => r.head_sha === spec.expectedHead && r.event === 'pull_request');
    const jobsByRun = {};
    for (const r of current) {
      if (!Number.isSafeInteger(r.id)) throw new Error('Malformed run id');
      jobsByRun[String(r.id)] = await pages(path+'/actions/runs/'+r.id+'/jobs?filter=latest');
    }
    const parent = spec.dependsOn ? await pages(path+'/pulls/'+spec.dependsOn) : null;
    const expectedParentMerged = parent === null || (parent.merged === true &&
      typeof parent.merged_at === 'string' && parent.base?.ref === 'main');
    entries.push(assessPullRequest({repository:spec.repo, number:spec.number, expectedHead:spec.expectedHead,
      expectedBase:'main', expectedBaseSha:spec.expectedBaseSha, requiredStepNames:spec.requiredStepNames,
      pr, reviews, runs:current, jobsByRun, expectedParentMerged}));
  }
  const result = assessWave(entries);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if (!result.readyForHumanFinalReview) process.exitCode = 1;
}
main().catch(e=>{console.error('merge-wave preflight refused: '+e.message);process.exitCode=2;});
