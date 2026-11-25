// Read-only GitHub REST client for conformance evidence. No source or artifact transfer.
// This module is intentionally independent of credential storage or GitHub Actions SDKs.
const repoSyntax = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const runSyntax = /^[1-9][0-9]{0,15}$/;
const maxBytes = 1024 * 1024;
const maxMs = 15000;
const sourceRepos = Object.freeze({
  java: 'ores-truffle-oreslang/oreslang-source.java',
  llvm: 'ores-truffle-oreslang/oreslang-source.llvm',
  wasm: 'ores-truffle-oreslang/oreslang-source.wasm',
  forge: 'ores-truffle-oreslang/oreslang-source.forge',
  net: 'ores-truffle-oreslang/oreslang-source.net'
});

export function requireCanonicalDopSourceRepo(backend, repository) {
  if (!Object.hasOwn(sourceRepos, backend) || sourceRepos[backend] !== repository)
    throw new TypeError('backend-repository-mismatch');
  return repository;
}


export function validateGithubIdentity(repository, runId) {
  if (typeof repository !== 'string' || !repoSyntax.test(repository) ||
      repository.split('/').some(part => part === '.' || part === '..' || part.endsWith('.git')))
    throw new TypeError('invalid-repository');
  const id = String(runId);
  if (!runSyntax.test(id) || !Number.isSafeInteger(Number(id)))
    throw new TypeError('invalid-run-id');
  return {repository, id};
}

// Reject duplicate decoded object keys before native JSON.parse. JSON.parse alone
// silently keeps the last value, which is unsafe for runner/job authority data.
export function parseStrictGithubJson(input) {
  const stack = [];
  let seenKeys = 0;
  for (let i = 0; i < input.length;) {
    const c = input[i];
    if (c === '"') {
      const start = i++;
      let terminated = false;
      while (i < input.length) {
        if (input[i] === '\\') { i += 2; continue; }
        if (input[i++] === '"') { terminated = true; break; }
      }
      if (!terminated) throw new Error('github-malformed-json');
      const top = stack.at(-1);
      if (top?.kind === 'object' && top.expectKey) {
        let key;
        try { key = JSON.parse(input.slice(start, i)); }
        catch { throw new Error('github-malformed-json'); }
        if (top.keys.has(key)) throw new Error('github-duplicate-json-key');
        top.keys.add(key);
        if (++seenKeys > 15000) throw new Error('github-too-many-json-keys');
        top.expectKey = false;
      }
      continue;
    }
    if (c === '{' || c === '[') {
      if (stack.length >= 80) throw new Error('github-over-nested-json');
      stack.push(c === '{' ? {kind:'object', keys:new Set(), expectKey:true} : {kind:'array'});
    } else if (c === '}' || c === ']') {
      stack.pop();
    } else if (c === ',' && stack.at(-1)?.kind === 'object') {
      stack.at(-1).expectKey = true;
    }
    i++;
  }
  try { return JSON.parse(input); }
  catch { throw new Error('github-malformed-json'); }
}

export async function readGithubJson(response, limit = maxBytes) {
  if (response.status !== 200 || !response.ok) throw new Error('github-http-not-200');
  const mediaType = response.headers?.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json' && mediaType !== 'application/vnd.github+json')
    throw new Error('github-not-json');
  const encoding = response.headers.get('content-encoding');
  if (encoding != null && encoding.toLowerCase() !== 'identity')
    throw new Error('github-encoded-response');
  const length = response.headers.get('content-length');
  if (length != null && (!/^[0-9]+$/.test(length) || Number(length) > limit))
    throw new Error('github-invalid-length');
  if (!response.body?.getReader) throw new Error('github-missing-stream');
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('github-invalid-chunk');
      received += value.byteLength;
      if (received > limit) throw new Error('github-oversize-response');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (length != null && Number(length) !== received) throw new Error('github-length-mismatch');
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  let data;
  try { data = parseStrictGithubJson(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch (error) {
    if (String(error?.message || '').startsWith('github-')) throw error;
    throw new Error('github-malformed-json');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    throw new Error('github-not-object');
  return data;
}

export async function fetchDopGithubRun({repository, runId, token, fetchFn = fetch,
  signal = AbortSignal.timeout(maxMs)}) {
  const parsed = validateGithubIdentity(repository, runId);
  if (typeof token !== 'string' || token.length === 0 || /[\r\n]/.test(token))
    throw new TypeError('missing-github-token');
  const base = 'https://api.github.com/repos/' + parsed.repository + '/actions/runs/' + parsed.id;
  const headers = {
    authorization: 'Bearer ' + token,
    accept: 'application/vnd.github+json',
    'accept-encoding': 'identity',
    'x-github-api-version': '2022-11-28'
  };
  const request = async url => {
    const response = await fetchFn(url, {
      method: 'GET', redirect: 'manual', cache: 'no-store', signal, headers
    });
    return readGithubJson(response);
  };
  const run = await request(base);
  const jobs = await request(base + '/jobs?per_page=100');
  // Complete-page requirement is enforced by validateDopGithubSnapshot.
  return {run, jobs};
}

/**
 * Fetch immutable Git-commit metadata for the exact Actions source HEAD.
 * Separate from the Actions run/job API because those records do not expose
 * the Git tree SHA. Never accept a branch name or abbreviated SHA here.
 * This is source-free metadata only, not a guest execution attestation.
 */
export async function fetchDopGithubCommit({backend, repository, headSha, token,
  fetchFn = fetch, signal = AbortSignal.timeout(maxMs)}) {
  requireCanonicalDopSourceRepo(backend, repository);
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha))
    throw new TypeError('github-commit-head-invalid');
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token))
    throw new TypeError('missing-github-token');
  const url = 'https://api.github.com/repos/' + repository + '/git/commits/' + headSha;
  const response = await fetchFn(url, {
    method: 'GET', redirect: 'manual', cache: 'no-store', signal, headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json',
      'accept-encoding': 'identity',
      'x-github-api-version': '2022-11-28'
    }
  });
  return readGithubJson(response);
}
