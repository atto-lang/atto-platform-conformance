// Read-only, opt-in REST adapter: GitHub API GET only, no source-file or Actions dispatch endpoints.
// A complete inventory is contingent on stable canonical PR pagination and complete repo access.
export const sha40 = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const validRepo = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const issue = (kind, context = {}) => ({kind, ...context});
const isoSecond = ms => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAX_BODY = 8 * 1024 * 1024;

export class GithubReadError extends Error {
  constructor(kind, status, retryable = false) {
    super(`${kind} (HTTP ${status ?? 'unavailable'})`);
    this.name = 'GithubReadError'; this.kind = kind; this.status = status; this.retryable = retryable;
  }
}

async function boundedJson(response) {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > MAX_BODY) throw new GithubReadError('BODY_TOO_LARGE', response.status);
  if (!response.body) throw new GithubReadError('BODY_UNOBSERVED', response.status);
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY) throw new GithubReadError('BODY_TOO_LARGE', response.status);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let string;
  try { string = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { throw new GithubReadError('INVALID_UTF8', response.status); }
  try { return JSON.parse(string); }
  catch { throw new GithubReadError('INVALID_JSON', response.status); }
}

export function githubReadClient({token, fetcher = fetch, sleep = sleepDefault,
  maxRequests = 12000, maxRetryDelayMs = 15000, now = () => Date.now()} = {}) {
  if (typeof token !== 'string' || token.length < 1) throw Error('GITHUB_TOKEN required');
  if (typeof fetcher !== 'function' || typeof sleep !== 'function') throw Error('invalid read adapters');
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) throw Error('invalid maxRequests');
  const stats = {requests: 0, retries: 0, rateLimits: 0};
  async function get(path, params = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('..'))
      throw Error('invalid GitHub REST path');
    const url = new URL(path, 'https://api.github.com');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    for (let attempt = 0; attempt < 3; attempt++) {
      if (++stats.requests > maxRequests) throw new GithubReadError('REQUEST_BUDGET_EXHAUSTED', null);
      let response;
      try { response = await fetcher(url.toString(), {
        method: 'GET', redirect: 'error', headers: {
          'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          'Authorization': `Bearer ${token}`, 'User-Agent': 'atto-pr-readonly-evidence-v1'
        }
      }); } catch { throw new GithubReadError('NETWORK_UNOBSERVED', null); }
      if (response.ok) return boundedJson(response);
      const remaining = response.headers.get('x-ratelimit-remaining');
      const retryValue = response.headers.get('retry-after');
      const resetValue = response.headers.get('x-ratelimit-reset');
      const retryAfter = retryValue === null ? null : Number(retryValue);
      const reset = resetValue === null ? null : Number(resetValue);
      const limited = response.status === 429 ||
        (response.status === 403 && (remaining === '0' || retryAfter !== null && Number.isFinite(retryAfter) && retryAfter > 0));
      if (limited) stats.rateLimits++;
      const retryable = limited || response.status === 502 || response.status === 503 || response.status === 504;
      if (retryable && attempt < 2) {
        const wait = retryAfter !== null && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 :
          limited && reset !== null && Number.isFinite(reset) && reset > 0 ? Math.max(0, reset * 1000 - now()) :
          250 * (2 ** attempt);
        if (wait <= maxRetryDelayMs) { stats.retries++; await sleep(wait); continue; }
      }
      const kind = limited ? 'RATE_LIMIT' : response.status === 403 ? 'PERMISSION_DENIED' :
        response.status === 404 ? 'NOT_FOUND' : retryable ? 'HTTP_TRANSIENT' : 'HTTP_FAILURE';
      throw new GithubReadError(kind, response.status, retryable);
    }
    throw new GithubReadError('RETRY_EXHAUSTED', null);
  }
  return {get, stats};
}

export async function paged(client, path, params = {}, {field, maxPages = 100} = {}) {
  const items = []; const gaps = []; const ids = new Set(); let expected = null; let complete = false;
  for (let page = 1; page <= maxPages; page++) {
    let payload;
    try { payload = await client.get(path, {...params, per_page: 100, page}); }
    catch (error) { gaps.push(issue('PAGE_ERROR', {path, page, reason: error.kind ?? 'UNKNOWN', status: error.status ?? null})); break; }
    const list = field ? payload?.[field] : payload;
    if (!Array.isArray(list)) { gaps.push(issue('PAGE_UNOBSERVED', {path, page})); break; }
    if (list.length > 100) gaps.push(issue('PAGE_OVERSIZED', {path, page}));
    if (Number.isSafeInteger(payload?.total_count) && payload.total_count >= 0) {
      if (expected !== null && expected !== payload.total_count)
        gaps.push(issue('TOTAL_CHANGED', {path, page, previous: expected, current: payload.total_count}));
      expected = payload.total_count;
    }
    for (const obj of list) {
      if (!obj || !Number.isSafeInteger(obj.id) || obj.id < 1) {
        gaps.push(issue('INVALID_PAGE_ITEM', {path, page})); continue;
      }
      if (ids.has(obj.id)) { gaps.push(issue('DUPLICATE_PAGE_ITEM', {path, page, id: obj.id})); continue; }
      ids.add(obj.id); items.push(obj);
    }
    if (expected !== null && items.length >= expected) { complete = items.length === expected; break; }
    if (list.length < 100) { complete = expected === null || items.length === expected; break; }
    if (page === maxPages) gaps.push(issue('PAGE_CAP', {path, page}));
  }
  if (!complete) gaps.push(issue('PAGINATION_INCOMPLETE', {path, received: items.length, expected}));
  return {items, gaps, complete: complete && gaps.length === 0, totalCount: expected};
}

// Search partition is half-open in UTC seconds; split recursively on the GitHub 1000-item ceiling.
export async function searchWindow(client, repo, startMs, stopMs, {maxDepth = 24, maxPages = 10} = {}) {
  if (!validRepo(repo) || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(stopMs) ||
      stopMs <= startMs || startMs % 1000 || stopMs % 1000) throw Error('invalid search interval');
  const items = new Map(), gaps = [], partitions = [];
  async function visit(start, stop, depth) {
    const label = {repo, start: isoSecond(start), end: isoSecond(stop - 1000)};
    const q = `is:pr is:open repo:${repo} created:${label.start}..${label.end}`;
    let first;
    try { first = await client.get('/search/issues', {q, sort:'created', order:'asc', per_page:100, page:1}); }
    catch (error) { gaps.push(issue('SEARCH_ERROR', {...label, reason:error.kind??'UNKNOWN', status:error.status??null})); return; }
    const count = first?.total_count;
    if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(first?.items)) {
      gaps.push(issue('SEARCH_UNOBSERVED', label)); return;
    }
    if (count >= 1000 || first.incomplete_results === true) {
      if (stop - start <= 1000 || depth >= maxDepth) {
        gaps.push(issue('SEARCH_1000_CAP_OR_INCOMPLETE', {...label, count, depth})); return;
      }
      const midpoint = start + Math.floor((stop - start) / 2000) * 1000;
      await visit(start, midpoint, depth + 1); await visit(midpoint, stop, depth + 1);
      return;
    }
    const pageCount = Math.ceil(count / 100), local = new Set(), responses = [first];
    for (let page = 2; page <= pageCount && page <= maxPages; page++) {
      try { responses.push(await client.get('/search/issues', {q, sort:'created', order:'asc', per_page:100, page})); }
      catch (error) { gaps.push(issue('SEARCH_PAGE_ERROR', {...label, page, reason:error.kind??'UNKNOWN'})); break; }
    }
    for (const [index, response] of responses.entries()) {
      if (!Array.isArray(response?.items) || response.total_count !== count || response.incomplete_results === true) {
        gaps.push(issue('SEARCH_PAGE_CHANGED', {...label, page:index+1})); continue;
      }
      for (const pr of response.items) {
        if (!pr || !Number.isSafeInteger(pr.number) || pr.number < 1 || !pr.pull_request) {
          gaps.push(issue('INVALID_SEARCH_PR', {...label, page:index+1})); continue;
        }
        if (local.has(pr.number)) { gaps.push(issue('DUPLICATE_SEARCH_PR', {...label, number:pr.number})); continue; }
        local.add(pr.number); items.set(pr.number, {number:pr.number, url:`https://github.com/${repo}/pull/${pr.number}`});
      }
    }
    const good = local.size === count && pageCount <= maxPages;
    partitions.push({...label, count, seen:local.size, complete:good});
    if (!good) gaps.push(issue('SEARCH_PARTITION_INCOMPLETE', {...label, count, seen:local.size}));
  }
  await visit(startMs, stopMs, 0);
  return {items:[...items.values()], partitions, gaps, complete:gaps.length === 0};
}

export async function inventoryOrg({client, org, start='2008-01-01T00:00:00Z', stop,
  maxRepos=500, maxPRs=5000, crossCheckSearch=true} = {}) {
  if (!client?.get || !/^[A-Za-z0-9_.-]+$/.test(org??'')) throw Error('read-only client and org required');
  const gaps=[], repos=[], prs=[], partitions=[];
  const startMs=Date.parse(start), stopMs=Date.parse(stop);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(stopMs) || stopMs<=startMs ||
      startMs%1000 || stopMs%1000) throw Error('invalid UTC interval');
  let list;
  try { list = await paged(client, '/installation/repositories', {}, {field:'repositories'}); }
  catch (error) { gaps.push(issue('INSTALLATION_DISCOVERY_ERROR', {reason:error.kind??'UNKNOWN'})); }
  if (!list || !list.complete) gaps.push(issue('REPOSITORY_DISCOVERY_INCOMPLETE'));
  gaps.push(...(list?.gaps??[]));
  for (const item of list?.items??[]) {
    if (item.full_name?.split('/')[0] === org && validRepo(item.full_name)) repos.push(item.full_name);
  }
  if (repos.length > maxRepos) gaps.push(issue('REPOSITORY_BUDGET_EXCEEDED', {count:repos.length,maxRepos}));
  for (const repo of repos.slice(0,maxRepos)) {
    const canon = await paged(client, `/repos/${repo}/pulls`, {state:'open'});
    gaps.push(...canon.gaps.map(g=>({...g,repo})));
    const canonicalNumbers = new Set();
    let prBudgetHit = false;
    for (const item of canon.items) {
      if (prs.length >= maxPRs) {prBudgetHit = true; break;}
      if (!Number.isSafeInteger(item.number) || item.number < 1 || item.state !== 'open') {
        gaps.push(issue('CANONICAL_PR_INVALID', {repo})); continue;
      }
      canonicalNumbers.add(item.number);
      prs.push({repository:repo, number:item.number, url:`https://github.com/${repo}/pull/${item.number}`,
        initialHead:sha40(item.head?.sha)?item.head.sha:null, head:null, headVerified:false,
        base:item.base?.ref??null});
    }
    if (crossCheckSearch) {
      const search = await searchWindow(client,repo,startMs,stopMs);
      partitions.push(...search.partitions); gaps.push(...search.gaps);
      const searched = new Set(search.items.map(x=>x.number));
      for (const n of canonicalNumbers) if (!searched.has(n)) gaps.push(issue('SEARCH_MISSING_CANONICAL_PR',{repo,number:n}));
      for (const n of searched) if (!canonicalNumbers.has(n)) gaps.push(issue('SEARCH_STALE_OR_EXTRA_PR',{repo,number:n}));
    } else gaps.push(issue('SEARCH_DATE_CROSSCHECK_NOT_RUN',{repo}));
    if (prBudgetHit || prs.length >= maxPRs) {gaps.push(issue('PR_BUDGET_REACHED',{maxPRs})); break;}
  }
  return {org, repositories:repos, prs, partitions, gaps,
    complete:gaps.length === 0, stats:{...client.stats}};
}

export async function inspectPR(client, repository, number, classify, {trustedStepNames=[],maxAttempts=12}={}) {
  if (!validRepo(repository) || !Number.isSafeInteger(number) || number<1 || typeof classify!=='function')
    throw Error('invalid PR and classifier');
  const gaps=[]; const path=`/repos/${repository}/pulls/${number}`;
  let before;
  try { before=await client.get(path); }
  catch(error){return{repository,number,gaps:[issue('PR_HEAD_UNOBSERVED',{reason:error.kind??'UNKNOWN'})],complete:false};}
  const head=before?.head?.sha;
  if (before.state!=='open' || !sha40(head)) return{repository,number,gaps:[issue('PR_NOT_OPEN_OR_HEAD_INVALID')],complete:false};
  const runPage=await paged(client,`/repos/${repository}/actions/runs`,{head_sha:head}, {field:'workflow_runs'});
  gaps.push(...runPage.gaps);
  const runs=[];
  for(const r of runPage.items) {
    if(r.head_sha!==head){gaps.push(issue('RUN_HEAD_MISMATCH',{runId:r.id}));continue;}
    const attempt=r.run_attempt;
    if(!Number.isSafeInteger(attempt)||attempt<1||attempt>maxAttempts){gaps.push(issue('ATTEMPT_COUNT_UNOBSERVED',{runId:r.id,attempt}));continue;}
    for(let a=1;a<=attempt;a++) runs.push({...r,run_attempt:a});
  }
  const result=await classify({repo:repository,head,
    listRuns:async()=>({items:runs,complete:runPage.complete}),
    listJobs:async(_repo,runId,attempt)=> {
      const jobs=await paged(client,`/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs`,{}, {field:'jobs'});
      gaps.push(...jobs.gaps);return{items:jobs.items,complete:jobs.complete};
    },
    listSteps:async(_repo,jobId)=> {
      const job=await client.get(`/repos/${repository}/actions/jobs/${jobId}`);
      return {steps:job?.steps};
    },trustedStepNames});
  gaps.push(...(result.gaps??[]));
  let reviews={items:[],complete:false};
  try{reviews=await paged(client,`${path}/reviews`);}catch(error){gaps.push(issue('REVIEWS_UNOBSERVED',{reason:error.kind??'UNKNOWN'}));}
  gaps.push(...reviews.gaps);
  const lastByReviewer=new Map();
  for (const review of reviews.items){
    if(!review?.user?.login || !['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state))continue;
    const previous=lastByReviewer.get(review.user.login);
    if(!previous || Date.parse(review.submitted_at)>Date.parse(previous.submitted_at))lastByReviewer.set(review.user.login,review);
  }
  const changeRequests=[...lastByReviewer.values()].filter(r=>r.state==='CHANGES_REQUESTED').map(r=>({
    reviewer:r.user.login, reviewId:r.id, forCurrentHead:r.commit_id===head}));
  let approval='UNKNOWN';
  try {
    const rule=await client.get(`/repos/${repository}/branches/${encodeURIComponent(before.base.ref)}/protection`);
    if(Number.isInteger(rule?.required_pull_request_reviews?.required_approving_review_count) &&
       rule.required_pull_request_reviews.required_approving_review_count>0) approval='REQUIRED_BY_READABLE_BRANCH_PROTECTION';
  }catch(error){gaps.push(issue('APPROVAL_POLICY_UNOBSERVED',{reason:error.kind??'UNKNOWN'}));}
  // GitHub REST review comments do not disclose GraphQL isResolved; never claim all threads resolved.
  gaps.push(issue('REVIEW_THREAD_RESOLUTION_UNOBSERVED'));
  let after;
  try{after=await client.get(path);}catch(error){gaps.push(issue('FINAL_HEAD_UNOBSERVED',{reason:error.kind??'UNKNOWN'}));}
  if(after?.head?.sha!==head || after?.state!=='open')gaps.push(issue('PR_HEAD_CHANGED_DURING_AUDIT'));
  return {repository,number,url:`https://github.com/${repository}/pull/${number}`,head,base:before.base?.ref,
    headVerified:after?.head?.sha===head && after?.state==='open',
    evidence:result.records??[],review:{changeRequests,requestedReviewers:before.requested_reviewers?.map(r=>r.login)??[],
      approvalEnforcement:approval,unresolvedThreads:'UNOBSERVED'},gaps,complete:gaps.length===0};
}
