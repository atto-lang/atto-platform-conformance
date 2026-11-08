// Read-only GitHub REST adapter and strict manifest validation for the advisory gate.
import {validRepoName, assessPullRequest, assessWave} from './merge-wave-readiness-v1.mjs';
import {readBoundedProviderJson} from './merge-wave-bounded-json-v1.mjs';
const shaPattern = /^[a-f0-9]{40}$/i;
const resourcePattern = /^\/repos\/([^/?#]+)\/([^/?#]+)\/(.+)$/;
const namePattern = /^[A-Za-z0-9_.-]+$/;
const shaValid = x => typeof x === 'string' && shaPattern.test(x);

export function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.prs) || manifest.prs.length < 1 || manifest.prs.length > 20)
    throw new Error('Manifest must contain 1–20 PRs');
  const known = new Set();
  for (const s of manifest.prs) {
    if (!validRepoName(s?.repo) || !Number.isSafeInteger(s?.number) || s.number < 1 ||
      !shaValid(s?.expectedHead) || !shaValid(s?.expectedBaseSha) ||
      !Array.isArray(s?.requiredStepNames) || s.requiredStepNames.length === 0 ||
      s.requiredStepNames.some(n => typeof n !== 'string' || n.trim().length === 0 || n.length > 160) ||
      new Set(s.requiredStepNames).size !== s.requiredStepNames.length ||
      !Array.isArray(s.requiredWorkflows) || s.requiredWorkflows.length < 1 ||
      s.requiredWorkflows.some(w => !w || !Number.isSafeInteger(w.workflowId) || w.workflowId < 1 ||
        !['workflowName','jobName','testStepName'].every(k => typeof w[k] === 'string' &&
          w[k].trim().length > 0 && w[k].length <= 160)) ||
      new Set(s.requiredWorkflows.map(w => `${w?.workflowId}:${w?.jobName}:${w?.testStepName}`)).size !== s.requiredWorkflows.length ||
      (s.dependsOn != null && (!Number.isSafeInteger(s.dependsOn) || s.dependsOn < 1 || s.dependsOn === s.number || !shaValid(s.expectedParentHead))))
      throw new Error('Invalid pinned PR identity');
    const key = s.repo+'#'+s.number;
    if (known.has(key)) throw new Error('Duplicate PR identity in manifest');
    known.add(key);
  }
  return manifest;
}

export function makeGitHubReadOnlyClient({token, fetchImpl = globalThis.fetch, maxPages = 10, pageSize = 100} = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('Missing GitHub token');
  if (typeof fetchImpl !== 'function') throw new TypeError('Expected fetch implementation');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new RangeError('Invalid pagination bounds');
  async function get(path, shape = 'object') {
    const parsed = resourcePattern.exec(path);
    const suffix = parsed?.[3]?.split('?')[0];
    if (!parsed || !namePattern.test(parsed[1]) || !namePattern.test(parsed[2]) ||
        !validRepoName(parsed[1]+'/'+parsed[2]) ||
        !/^[A-Za-z0-9_./-]+$/.test(suffix || '') ||
        suffix.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('Invalid GitHub repository resource');
    const field = ({array:null,runs:'workflow_runs',jobs:'jobs',checks:'check_runs',object:null})[shape];
    if (!['array','runs','jobs','checks','object'].includes(shape)) throw new Error('Unknown provider response kind');
    const found = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL('https://api.github.com'+path);
      if (url.origin !== 'https://api.github.com') throw new Error('Unexpected provider origin');
      url.searchParams.set('per_page', String(pageSize));
      url.searchParams.set('page', String(page));
      const response = await fetchImpl(url.toString(), {method:'GET',redirect:'error',headers:{
        Accept:'application/vnd.github+json',Authorization:'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28'}});
      if (!response?.ok) { const error = new Error('GitHub provider error '+String(response?.status));
        if (Number.isInteger(response?.status)) error.status = response.status;
        throw error;
      }
      const body = await readBoundedProviderJson(response);
      if (shape === 'object') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Malformed provider object response');
        return body;
      }
      const batch = shape === 'array' ? body : body?.[field];
      if (!Array.isArray(batch)) throw new Error('Malformed provider pagination response');
      found.push(...batch);
      if (batch.length < pageSize) return found;
    }
    throw new Error('Provider pagination limit exceeded');
  }
  return {get}; // No POST/PATCH/PUT/DELETE operation is exported.
}

/** Security-relevant, order-independent provider snapshot; never a merge authorization. */
export function evidenceFingerprint({pr, reviews, runs, jobsByRun, parent}) {
  if (!Array.isArray(reviews) || !Array.isArray(runs)) throw new Error('Incomplete evidence snapshot');
  const id = x => x && typeof x === 'object' ? {
    number:x.number, state:x.state, merged:x.merged, merged_at:x.merged_at,
    draft:x.draft, mergeable:x.mergeable, author:x.user?.login,
    head:x.head?.sha, headRepo:x.head?.repo?.full_name, baseRef:x.base?.ref, baseSha:x.base?.sha,
    baseRepo:x.base?.repo?.full_name
  } : null;
  const normalizeList = items => items.map(x => JSON.stringify(x)).sort();
  const reviewEvidence = normalizeList(reviews.map(r => ({id:r?.id, reviewer:r?.user?.login,
    state:r?.state, commit:r?.commit_id, submitted:r?.submitted_at, dismissed:r?.dismissed_at})));
  const runEvidence = normalizeList(runs.map(r => ({id:r?.id, status:r?.status,
    conclusion:r?.conclusion, head:r?.head_sha, event:r?.event, attempt:r?.run_attempt,
    workflow:r?.workflow_id, workflowName:r?.name,
    repository:r?.repository?.full_name, headRepository:r?.head_repository?.full_name,
    prs:r?.pull_requests?.map(x => JSON.stringify({number:x?.number,
      baseRepo:x?.base?.repo?.full_name, headRepo:x?.head?.repo?.full_name})).sort(),
    jobs:normalizeList(Array.isArray(jobsByRun?.[String(r?.id)]) ? jobsByRun[String(r.id)].map(j => ({
      id:j?.id, name:j?.name, runId:j?.run_id, attempt:j?.run_attempt,
      runner:j?.runner_id, conclusion:j?.conclusion, status:j?.status,
      steps:Array.isArray(j?.steps) ? j.steps.map(step => ({name:step?.name, number:step?.number,
        status:step?.status, conclusion:step?.conclusion})) : null
    })) : [])
  })));
  return JSON.stringify({pr:id(pr), reviews:reviewEvidence, runs:runEvidence, parent:id(parent)});
}

/** Pin the parent's original source head separately from squash-merged main. */
export function verifyStackedParent(spec,parent) {
  if (spec?.dependsOn == null) return true;
  return parent?.number === spec.dependsOn &&
    parent?.head?.sha === spec.expectedParentHead &&
    parent?.merged === true && typeof parent.merged_at === 'string' && parent.merged_at.length > 0 &&
    parent?.base?.ref === 'main' && parent?.base?.repo?.full_name === spec.repo &&
    (parent?.head?.repo?.full_name === undefined || parent.head.repo.full_name === spec.repo);
}

export async function collectWave(manifest, client) {
  validateManifest(manifest);
  if (typeof client?.get !== 'function') throw new TypeError('Missing read-only provider');
  const entries = [];
  const initialSnapshots = [];
  for (const spec of manifest.prs) {
    const path = '/repos/'+spec.repo;
    const [pr, reviews, runs] = await Promise.all([
      client.get(path+'/pulls/'+spec.number,'object'), client.get(path+'/pulls/'+spec.number+'/reviews','array'),
      client.get(path+'/actions/runs?head_sha='+spec.expectedHead+'&event=pull_request','runs')]);
    const current = runs.filter(r => r?.head_sha === spec.expectedHead && r?.event === 'pull_request');
    const jobsByRun = Object.create(null);
    for (const r of current) {
      if (!Number.isSafeInteger(r.id) || r.id < 1) throw new Error('Malformed provider run identity');
      jobsByRun[String(r.id)] = await client.get(path+'/actions/runs/'+r.id+'/jobs?filter=latest','jobs');
    }
    const parent = spec.dependsOn == null ? null : await client.get(path+'/pulls/'+spec.dependsOn,'object');
    const expectedParentMerged = verifyStackedParent(spec,parent);
    initialSnapshots.push(evidenceFingerprint({pr,reviews,runs:current,jobsByRun,parent}));
    entries.push(assessPullRequest({repository:spec.repo, number:spec.number, expectedHead:spec.expectedHead,
      expectedBase:'main', expectedBaseSha:spec.expectedBaseSha, requiredStepNames:spec.requiredStepNames,
      requiredWorkflows:spec.requiredWorkflows,
      pr, reviews, runs:current, jobsByRun, expectedParentMerged}));
  }
  // Final separate pass covers the complete wave, not just each PR in isolation.
  // A push, dismissal, workflow rerun, retarget or parent merge during collection
  // invalidates the snapshot and forces a fresh run of this read-only preflight.
  for (let i=0; i<manifest.prs.length; i++) {
    const spec=manifest.prs[i], path='/repos/'+spec.repo;
    const [pr,reviews,runs] = await Promise.all([
      client.get(path+'/pulls/'+spec.number,'object'), client.get(path+'/pulls/'+spec.number+'/reviews','array'),
      client.get(path+'/actions/runs?head_sha='+spec.expectedHead+'&event=pull_request','runs')]);
    const current=runs.filter(r=>r?.head_sha===spec.expectedHead && r?.event==='pull_request');
    const jobsByRun=Object.create(null);
    for (const run of current) {
      if (!Number.isSafeInteger(run?.id) || run.id < 1) throw new Error('Malformed provider run identity');
      jobsByRun[String(run.id)]=await client.get(path+'/actions/runs/'+run.id+'/jobs?filter=latest','jobs');
    }
    const parent=spec.dependsOn == null ? null : await client.get(path+'/pulls/'+spec.dependsOn,'object');
    if (initialSnapshots[i]!==evidenceFingerprint({pr,reviews,runs:current,jobsByRun,parent})) {
      entries[i]={...entries[i],readyForIndependentMergeDecision:false,
        blockers:[...new Set([...entries[i].blockers,'PROVIDER_SNAPSHOT_CHANGED'])]};
    }
  }
  return assessWave(entries);
}
