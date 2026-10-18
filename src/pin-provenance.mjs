import {validateCompatibilityCandidate} from "./compatibility-release.mjs";

// Pure, source-free provenance check. This does NOT test code compatibility or
// authorize access to a private source repository. The injected fetch boundary
// lets unit tests use fake GitHub metadata without network or secrets.
export async function auditPinnedProvenance(candidate, inventory, requestJson) {
  validateCompatibilityCandidate(candidate, inventory);
  if (typeof requestJson !== "function") throw Error("audit: requestJson must be a function");
  const inventoryByName = new Map(inventory.repositories.map(r => [r.name, r]));
  const results = [];
  for (const pin of candidate.pins) {
    const prefix = `/repos/${candidate.organization}/${pin.name}`;
    const info = await requestJson(prefix);
    if (!info || typeof info !== "object" ||
        !Number.isSafeInteger(info.id) || info.id < 1 ||
        String(info.id) !== pin.repositoryId ||
        info.full_name !== `${candidate.organization}/${pin.name}` ||
        info.default_branch !== pin.ref ||
        info.archived !== false ||
        info.private !== (inventoryByName.get(pin.name).visibility === "private")) {
      throw Error(`audit: repository identity, visibility, archive or branch mismatch: ${pin.name}`);
    }
    const ref = await requestJson(`${prefix}/git/ref/heads/${pin.ref}`);
    const head = ref?.object?.sha;
    if (ref?.object?.type !== "commit" || typeof head !== "string" || !/^[a-f0-9]{40}$/.test(head)) {
      throw Error(`audit: missing or invalid main commit: ${pin.name}`);
    }
    let relation = "EXACT_MAIN";
    if (head !== pin.commit) {
      const comparison = await requestJson(`${prefix}/compare/${pin.commit}...${head}`);
      if (comparison?.status !== "ahead" || comparison?.behind_by !== 0 ||
          !Number.isSafeInteger(comparison?.ahead_by) || comparison.ahead_by < 1 ||
          comparison?.base_commit?.sha !== pin.commit ||
          comparison?.merge_base_commit?.sha !== pin.commit) {
        throw Error(`audit: pin is not a proven ancestor of main: ${pin.name}`);
      }
      relation = "ANCESTOR_OF_MAIN";
    }
    results.push({name: pin.name, repositoryId: pin.repositoryId, pinnedSha: pin.commit,
      observedMainSha: head, relation});
  }
  return {result: "READ_ONLY_PIN_PROVENANCE_NOT_COMPATIBILITY",
    repositoriesChecked: results.length,
    exactMain: results.filter(r => r.relation === "EXACT_MAIN").length,
    ancestorOfMain: results.filter(r => r.relation === "ANCESTOR_OF_MAIN").length,
    releaseReady: false, results};
}

// Avoid URL injection, third-party hosts, accidental redirects, and token
// disclosure. Only the GitHub REST API host and hardcoded same-org paths exist.
export function createGitHubReadonlyRequester(token, fetchImpl = globalThis.fetch) {
  if (typeof token !== "string" || token.trim() !== token || token.length < 8 ||
      /[\r\n]/.test(token)) throw Error("audit: explicitly supplied GitHub read token required");
  if (typeof fetchImpl !== "function") throw Error("audit: fetch implementation required");
  return async function requestJson(path) {
    const safePath = typeof path === "string" &&
      /^\/repos\/ores-truffle-oreslang\/(?:\.github|[a-z0-9][a-z0-9._-]*)(?:\/git\/ref\/heads\/main|\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40})?$/.test(path) &&
      !path.includes("%") && !path.includes("?") && !path.includes("#") &&
      !path.includes("\r") && !path.includes("\n") &&
      // Repos cannot have consecutive dots; compare syntax uses exactly three
      // after a SHA, so reject ambiguous dot-dot path segments separately.
      !/\/\.\.(?:\/|$)/.test(path) &&
      !/\/repos\/ores-truffle-oreslang\/[a-z0-9._-]*\.\.(?:\/|$)/.test(path);
    if (!safePath) {
      throw Error("audit: invalid GitHub API path");
    }
    const response = await fetchImpl("https://api.github.com" + path, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: {"Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": "Bearer " + token}
    });
    if (!response.ok) throw Error(`audit: GitHub metadata request failed HTTP ${response.status} at ${path}`);
    const text = await response.text();
    if (text.length > 8_000_000) throw Error("audit: GitHub metadata response too large");
    return JSON.parse(text);
  };
}
