import test from "node:test";
import assert from "node:assert/strict";
import {loadCandidateInventory, loadCompatibilityCandidate} from "../src/compatibility-release.mjs";
import {auditPinnedProvenance, createGitHubReadonlyRequester} from "../src/pin-provenance.mjs";

const candidate = loadCompatibilityCandidate();
const inventory = loadCandidateInventory();
const byName = new Map(candidate.pins.map(p => [p.name, p]));
const visibility = new Map(inventory.repositories.map(r => [r.name, r.visibility]));
const differentHead = "f".repeat(40);

function canned(options = {}) {
  const accessed = [];
  async function requestJson(path) {
    accessed.push(path);
    const match = /^\/repos\/ores-truffle-oreslang\/(\.github|[a-z0-9][a-z0-9._-]*)(.*)$/.exec(path);
    assert.ok(match, "only same-org repo metadata requested");
    const [ , name, suffix ] = match;
    const pin = byName.get(name);
    assert.ok(pin, "only inventory members requested");
    if (suffix === "") return {
      id: options.badRepoId && name === candidate.pins[0].name ? 999 :
        options.idAsString && name === candidate.pins[0].name ? pin.repositoryId :
        options.unsafeId && name === candidate.pins[0].name ? Number.MAX_SAFE_INTEGER + 1 :
        Number(pin.repositoryId),
      full_name: "ores-truffle-oreslang/" + name,
      default_branch: "main", archived: options.badArchive && name === candidate.pins[0].name ? undefined : false,
      private: options.badPrivacy && name === candidate.pins[0].name
        ? visibility.get(name) !== "private" : visibility.get(name) === "private"
    };
    if (suffix === "/git/ref/heads/main") return {
      object: {type: options.badRefType && name === candidate.pins[0].name ? "blob" : "commit",
        sha: options.badRef && name === candidate.pins[0].name
        ? "invalid" : options.moved && name === candidate.pins[0].name
        ? differentHead : pin.commit}
    };
    if (suffix.startsWith("/compare/")) return {
      status: options.diverged ? "diverged" : "ahead",
      behind_by: options.diverged ? 1 : 0, ahead_by: 2,
      base_commit: {sha: options.badBase ? differentHead : pin.commit},
      merge_base_commit: {sha: options.badMergeBase ? differentHead : pin.commit}
    };
    throw Error("unexpected GitHub request " + path);
  }
  return {requestJson, accessed};
}

test("read-only audit verifies all 52 exact main SHAs; never claims compatibility", async () => {
  const {requestJson, accessed} = canned();
  const r = await auditPinnedProvenance(candidate, inventory, requestJson);
  assert.equal(r.repositoriesChecked, 52);
  assert.equal(r.exactMain, 52);
  assert.equal(r.ancestorOfMain, 0);
  assert.equal(r.releaseReady, false);
  assert.equal(r.result, "READ_ONLY_PIN_PROVENANCE_NOT_COMPATIBILITY");
  assert.equal(accessed.length, 104);
});
test("accept pinned ancestor without silently moving frozen snapshot", async () => {
  const {requestJson} = canned({moved: true});
  const r = await auditPinnedProvenance(candidate, inventory, requestJson);
  assert.equal(r.exactMain, 51);
  assert.equal(r.ancestorOfMain, 1);
  assert.equal(r.results[0].pinnedSha, candidate.pins[0].commit);
  assert.equal(r.results[0].observedMainSha, differentHead);
});
test("deny repository-replacement attack even when name and SHA match", async () => {
  await assert.rejects(() => auditPinnedProvenance(candidate, inventory,
    canned({badRepoId: true}).requestJson), /repository identity/);
});
test("deny GitHub IDs represented as strings or unsafe JSON numbers", async () => {
  for (const flag of ["idAsString", "unsafeId"]) {
    await assert.rejects(() => auditPinnedProvenance(candidate, inventory,
      canned({[flag]: true}).requestJson), /repository identity/);
  }
});
test("deny private/public visibility changes", async () => {
  await assert.rejects(() => auditPinnedProvenance(candidate, inventory,
    canned({badPrivacy: true}).requestJson), /repository identity/);
});
test("deny unknown archive status or source repo visibility", async () => {
  await assert.rejects(() => auditPinnedProvenance(candidate, inventory,
    canned({badArchive: true}).requestJson), /repository identity/);
});
test("deny non-commit main Git refs", async () => {
  await assert.rejects(() => auditPinnedProvenance(candidate, inventory,
    canned({badRefType: true}).requestJson), /invalid main commit/);
});
test("deny invalid or missing branch references", async () => {
  await assert.rejects(() => auditPinnedProvenance(candidate, inventory,
    canned({badRef: true}).requestJson), /invalid main commit/);
});
test("deny rewritten history or missing pinned ancestors", async () => {
  await assert.rejects(() => auditPinnedProvenance(candidate, inventory,
    canned({moved: true, diverged: true}).requestJson), /not a proven ancestor/);
});
test("deny GitHub compare mismatch even with status=ahead", async () => {
  for (const flag of ["badBase", "badMergeBase"]) {
    await assert.rejects(() => auditPinnedProvenance(candidate, inventory,
      canned({moved: true, [flag]: true}).requestJson), /not a proven ancestor/);
  }
});
test("deny incomplete requests and forged pin data before network", async () => {
  const corrupted = structuredClone(candidate);
  corrupted.pins[0].compatibility = "VERIFIED";
  const {requestJson, accessed} = canned();
  await assert.rejects(() => auditPinnedProvenance(corrupted, inventory, requestJson),
    /forged evidence/);
  assert.equal(accessed.length, 0);
  await assert.rejects(() => auditPinnedProvenance(candidate, inventory, null),
    /requestJson must be a function/);
});
test("read-only HTTP caller allows only explicit same-org paths and never redirects", async () => {
  const recorded = [];
  const fetchImpl = async (url, options) => {
    recorded.push({url, options});
    return {ok: true, status: 200, text: async () => '{"status":"ahead"}'};
  };
  const requestJson = createGitHubReadonlyRequester("fake-test-only-token", fetchImpl);
  await requestJson("/repos/ores-truffle-oreslang/.github");
  await requestJson("/repos/ores-truffle-oreslang/oreslang-source.llvm/git/ref/heads/main");
  await requestJson("/repos/ores-truffle-oreslang/oreslang-source.java/compare/" +
    "a".repeat(40) + "..." + "b".repeat(40));
  assert.equal(recorded.length, 3);
  for (const {url, options} of recorded) {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/ores-truffle-oreslang\//);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer fake-test-only-token");
  }
  for (const path of ["https://evil.test/repos/a", "/repos/other-org/code",
    "/repos/ores-truffle-oreslang/../private", "/repos/ores-truffle-oreslang/repo?evil=1",
    "/repos/ores-truffle-oreslang/repo#frag", "/repos/ores-truffle-oreslang/repo%2fxxx",
    "/repos/ores-truffle-oreslang/repo/compare/feature...main",
    "/repos/ores-truffle-oreslang/repo/git/ref/heads/feature",
    "/repos/ores-truffle-oreslang/..",
    "/repos/ores-truffle-oreslang/repo..",
    "/repos/ores-truffle-oreslang/."]) {
    await assert.rejects(() => requestJson(path), /invalid GitHub API path/);
  }
  assert.equal(recorded.length, 3);
});
test("reject missing credentials or unsuccessful GitHub responses", async () => {
  assert.throws(() => createGitHubReadonlyRequester(""), /read token required/);
  assert.throws(() => createGitHubReadonlyRequester("bad\nvalue"), /read token required/);
  const fetchImpl = async () => ({ok: false, status: 403});
  const requester = createGitHubReadonlyRequester("fake-test-only-token", fetchImpl);
  await assert.rejects(() => requester("/repos/ores-truffle-oreslang/.github"), /HTTP 403/);
});
