# AttoLang merge-wave evidence composition v1

This is a **read-only, fail-closed integration contract** for the five-PR / three-repository merge train. The integration module reuses the existing verification functions through explicit dependency injection; it **does not clone, fork, or modify** the independently owned draft implementations. It is stacked on the live collector in draft PR #483.

## Versioned dependencies

```js
import { bindMergeWaveGates } from './tools/merge-wave-integrated-gates-v1.mjs';
import { collectLiveEvidence, readPages } from './tools/merge-wave-live-evidence-v1.mjs';
// Only import the following when their independently reviewed parent PRs have landed:
import { qualifyReviewTimeline } from './tools/merge-wave-review-timeline.mjs';
import { collectExactHeadEvidence } from './lib/pr-blocker-ledger-v1.mjs';
import { qualifyCandidate } from './tools/merge-wave-qualifier.mjs';

const audit = bindMergeWaveGates({
  collectLiveEvidence, readPages, qualifyReviewTimeline,
  collectExactHeadEvidence, qualifyCandidate
});
const result = await audit.auditPR({
  repo: 'ores-truffle-oreslang/oreslang-source.java',
  number: 2570,
  get: trustedReadOnlyGithubGet,
  readReviewerPolicy: trustedAdminPolicyAndEligibleReviewerReadback,
  trustedStepNames: ['reviewed exact-head test step']
});
// Always BLOCKED, never a merge permission.
```

The example imports from #477, #467/#481, and #470/#474 are **not yet resolvable in the parent #483 branch** because those PRs remain independent drafts. They are shown as the intended integration path after review and landing, not a claim that the composite stack already runs against the actual independent modules. `bindMergeWaveGates` itself has no static dependency on those three files, so it is immediately Node-testable using injected conformance fixtures. No untrusted dynamic network import is used.

## Contract

Required pure/read-only dependency functions: `collectLiveEvidence`, `readPages`, `qualifyReviewTimeline`, `collectExactHeadEvidence`, `qualifyCandidate`. The host supplies only a reviewed **GET-only** GitHub API adapter and, if available, an independently authorized reviewer-policy/eligible-reviewer readback. The adapter never calls GitHub write actions, authorizes source mirrors, or inspects private code.

`auditPR` reads current PR identity; calls the live collector; fetches complete review pages; maps user IDs and exact-head approvals for the review timeline; constructs run/job/step pagination adapters for the blocker ledger; reads branch protection and assembles a deliberately **unqualified** candidate for the merge qualifier (no invented receipt assertions, no assumed agent lease); finally re-reads the PR to detect drift. All five subgate outcomes and blockers appear in one `schema_version:1` result with pinned repo, PR number, head SHA, base SHA, tree SHA and observation time.

`auditWave` requires exactly **five unique PRs across three or more repositories** and runs read-only `auditPR` sequentially. It never returns a merge-ready result, even if injected mock gates all appear favorable.

## Security boundaries

- Caller-supplied review roster, status-check metadata or CI receipts are not trusted merely because they have the expected shape. Protected-main policy might be **unreadable** with this GitHub integration (HTTP 403). Treat unreadable and absent evidence as blocking; there is no `assumeSuccess` option.
- An unverified review timeline may not satisfy independent CODEOWNERS/security review. Operator-controlled identities cannot self-certify. A favorable source-free check is **not** compiler-backed `.atto` guest parity.
- The integration intentionally passes `test_receipts: []`, `checks: []`, and an unknown/invalid agent lease to the offline qualifier. This prevents a synthetic `SNAPSHOT_QUALIFIED` result from becoming authorization before a future signed-receipt + lease verifier exists.
- The run/job adapter uses exact workflow run attempt paths and job-by-ID readback. The ledger still independently decides whether those steps actually represent trusted execution.
- PR HEAD/base and all relevant identities must be rechecked live before a future separately governed, SHA-fenced merge executor; this proposal contains **no merge executor** and does not claim to close the review/runner gap.

## Tests and merge hold

```sh
node --test tests/merge-wave-integrated-gates-v1.test.mjs
```

30 Node 22 local tests exercised the **actual composite module** with mocked existing dependency functions and a fake read-only GET source. They cover missing/inconsistent dependency implementations, changed PR heads/authors, reviewer identity and pagination provenance, ledger errors, job-attempt joins, stale protection, unverified receipt/agent-lease, malformed targets, and five/three wave validation. Tests do **not** demonstrate a live private-repo adapter, compiler guest parity, GitHub-hosted CI, or end-to-end execution with the independently owned draft source modules. All must be verified after the parent PRs land and source-owned runners execute real steps.

Keep this PR **DRAFT** until parent #483 and the other component PRs receive independent review, source-owned stepful exact-head CI, and administrator-enforced protected-main policies. No cross-organization private source transfer is authorized by this module.
