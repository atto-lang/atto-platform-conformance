// Read-only GitHub REST adapter and strict manifest validation for the advisory gate.
import {validRepoName, assessPullRequest, assessWave} from './merge-wave-readiness-v1.mjs';
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
      (s.dependsOn != null && (!Number.isSafeInteger(s.dependsOn) || s.dependsOn < 1 || s.dependsOn === s.number)))
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
    const field = ({array:null,runs:'workflow_runs',jobs:'jobs',object:null})[shape];
    if (!['array','runs','jobs','object'].includes(shape)) throw new Error('Unknown provider response kind');
    const found = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL('https://api.github.com'+path);
      if (url.origin !== 'https://api.github.com') throw new Error('Unexpected provider origin');
      url.searchParams.set('per_page', String(pageSize));
      url.searchParams.set('page', String(page));
      const response = await fetchImpl(url.toString(), {method:'GET',redirect:'error',headers:{
        Accept:'application/vnd.github+json',Authorization:'Bearer '+token,
        'X-GitHub-Api-Version':'2022-11-28'}});
      if (!response?.ok) throw new Error('GitHub provider error '+String(response?.status));
      const body = await response.json();
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

export async function collectWave(manifest, client) {
  validateManifest(manifest);
  if (typeof client?.get !== 'function') throw new TypeError('Missing read-only provider');
  const entries = [];
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
    const expectedParentMerged = parent === null || (parent.merged === true &&
      typeof parent.merged_at === 'string' && parent.base?.ref === 'main');
    entries.push(assessPullRequest({repository:spec.repo, number:spec.number, expectedHead:spec.expectedHead,
      expectedBase:'main', expectedBaseSha:spec.expectedBaseSha, requiredStepNames:spec.requiredStepNames,
      pr, reviews, runs:current, jobsByRun, expectedParentMerged}));
  }
  return assessWave(entries);
}
