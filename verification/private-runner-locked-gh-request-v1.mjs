// Pure construction of read-only, pinned GitHub.com requests for a
// SOURCE-FREE runner canary. Never print or serialize returned env values.
import { PRIVATE_RUNNER_CONTROL as p } from './qualify-private-runner-admission-v1.mjs';

export function pinnedRunnerApiRequest(suffix, inputEnvironment) {
  if (typeof suffix !== 'string' || !inputEnvironment ||
      typeof inputEnvironment !== 'object' || Array.isArray(inputEnvironment)) {
    throw new TypeError('untrusted GitHub API request');
  }
  const allowed = [
    '/actions/runs/' + p.runId,
    '/contents/' + p.workflowPath + '?ref=' + p.sourceHead
  ];
  const jobs = new RegExp('^/actions/runs/' + p.runId +
    '/attempts/([0-9]+)/jobs\\?per_page=100$');
  const detail = /^\/actions\/jobs\/([1-9][0-9]*)$/;
  const log = /^\/actions\/jobs\/([1-9][0-9]*)\/logs$/;
  let matches = allowed.includes(suffix);
  const jobList = jobs.exec(suffix), jobDetail = detail.exec(suffix), jobLog = log.exec(suffix);
  if (jobList) {
    const attempt = Number(jobList[1]);
    matches = Number.isSafeInteger(attempt) && attempt > p.lastKnownFailedAttempt;
  }
  for (const result of [jobDetail,jobLog]) {
    if (result) {
      const id = Number(result[1]);
      matches = Number.isSafeInteger(id) && id > 0;
    }
  }
  if (!matches) throw new Error('unlisted GitHub API endpoint');
  const token = typeof inputEnvironment.GH_TOKEN === 'string' &&
    inputEnvironment.GH_TOKEN.length > 0 ? inputEnvironment.GH_TOKEN :
    inputEnvironment.GITHUB_TOKEN;
  if (typeof token !== 'string' || token.length === 0 ||
      token.length > 16384 || /[\r\n\0]/.test(token)) {
    throw new Error('read-only GitHub token required in GH_TOKEN or GITHUB_TOKEN');
  }
  // Do NOT inherit GH_HOST, GH_REPO, GH_CONFIG_DIR, http(s)_proxy,
  // GIT_CONFIG_* or other host redirect / credential configuration.
  // Each request is explicit github.com REST via /usr/bin/gh.
  return {
    argv: ['api', '--hostname', 'github.com', '-X', 'GET',
      '-H', 'Accept: application/vnd.github+json',
      '/repos/' + p.repository + suffix],
    environment: {
      GH_TOKEN: token,
      GH_HOST: 'github.com',
      GH_PROMPT_DISABLED: '1',
      GH_PAGER: 'cat',
      NO_COLOR: '1',
      PATH: '/usr/bin:/bin',
      LANG: 'C',
      LC_ALL: 'C'
    }
  };
}
