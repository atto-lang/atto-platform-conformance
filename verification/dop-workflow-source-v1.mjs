// Source-free workflow-content integrity admission. GitHub job identity alone
// cannot prove that the code in a workflow has not changed on a PR branch.
import {createHash} from 'node:crypto';
import {readGithubJson} from './dop-github-api-v1.mjs';

const policies = Object.freeze({
  java: Object.freeze({repository:'ores-truffle-oreslang/oreslang-source.java',
    path:'.github/workflows/dop-scalar-java-guest.yml',
    blobSha:'1e7e45f5b1bb7151d375609fd1ae00d922509f96'}),
  llvm: Object.freeze({repository:'ores-truffle-oreslang/oreslang-source.llvm',
    path:'.github/workflows/dop-atto-soa-native.yml',
    blobSha:'7f4f80705ecf7521dd4790bf3c60b05c371766f8'})
});
const MAX_WORKFLOW_BYTES = 65536;

export function requirePinnedDopWorkflow(backend, repository, headSha) {
  const policy = Object.hasOwn(policies, backend) ? policies[backend] : null;
  if (!policy) throw new Error('workflow-source-backend-not-pinned');
  if (policy.repository !== repository) throw new Error('workflow-source-repository-mismatch');
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha))
    throw new Error('workflow-source-head-invalid');
  return policy;
}

// A pure validation helper accepts a policy so synthetic fixture tests can
// exercise a positive path without copying private source workflow bytes.
export function validateWorkflowContentsObject(file, policy) {
  const errors = [];
  const need = (value, reason) => { if (!value) errors.push(reason); };
  if (!file || typeof file !== 'object' || Array.isArray(file))
    return ['workflow-source-object'];
  if (!policy || typeof policy !== 'object') return ['workflow-source-policy'];
  need(file.path === policy.path, 'workflow-source-path');
  need(file.type === 'file', 'workflow-source-file-type');
  need(file.encoding === 'base64', 'workflow-source-base64-encoding');
  need(typeof file.size === 'number' && Number.isSafeInteger(file.size) &&
    file.size > 0 && file.size <= MAX_WORKFLOW_BYTES, 'workflow-source-file-size');
  need(typeof file.sha === 'string' && /^[0-9a-f]{40}$/.test(file.sha),
    'workflow-source-object-sha');
  need(file.sha === policy.blobSha, 'workflow-source-review-blob');
  if (typeof file.content !== 'string' || file.content.length > 110000)
    return [...errors, 'workflow-source-encoded-size'];
  const encoded = file.content.replace(/\r?\n/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    return [...errors, 'workflow-source-invalid-base64'];
  const bytes = Buffer.from(encoded, 'base64');
  need(bytes.byteLength > 0 && bytes.byteLength <= MAX_WORKFLOW_BYTES &&
    bytes.byteLength === file.size, 'workflow-source-bytes-size');
  const computed = createHash('sha1').update('blob ' + bytes.byteLength + '\0').update(bytes).digest('hex');
  need(computed === file.sha, 'workflow-source-content-hash');
  return errors;
}

export async function fetchAndValidatePinnedWorkflow({backend, repository, headSha, token,
  fetchFn = fetch, signal = AbortSignal.timeout(15000)}) {
  const policy = requirePinnedDopWorkflow(backend, repository, headSha);
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token))
    throw new Error('workflow-source-token-invalid');
  const url = 'https://api.github.com/repos/' + policy.repository +
    '/contents/' + policy.path + '?ref=' + headSha;
  const response = await fetchFn(url, {method:'GET', redirect:'manual', cache:'no-store',
    signal, headers:{authorization:'Bearer ' + token, accept:'application/vnd.github+json',
      'accept-encoding':'identity','x-github-api-version':'2022-11-28'}});
  const contents = await readGithubJson(response);
  return validateWorkflowContentsObject(contents, policy);
}
