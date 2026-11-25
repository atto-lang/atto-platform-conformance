# Two-wave post-merge intake: November 6, 2026

**Status: SOURCE-FREE / READ-ONLY / NON-PROMOTING.** This module audits the two separately recorded five-PR waves in [#485](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/485) and [#488](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/488): ten immutable PR-head/merge-SHA pairs, nine distinct repositories. It does not modify the merged code, private Git trees, policies, workflow runs, reviewers, or merges.

## Run (Node.js 22+)

From a trusted workstation using a GitHub token with *read-only* access to the source repositories' PR, Actions, branch and (when authorized) protection metadata:

```sh
node --test tests/wave-two-postmerge-intake-20261106.test.mjs
GH_TOKEN=<read-only-token> node bin/wave-two-postmerge-intake-20261106.mjs > postmerge-intake.json
```

The CLI returns **exit 1** when a report was produced (intentionally blocked), **exit 2** on invalid/unreadable execution, **never exit 0**. Keep credentials out of tickets and artifacts. It sends GET only to `api.github.com`, rejects redirects/errors, limits responses to 2 MiB, and does not request source code or repository contents. The locally run test suite has 24 independently executed Node 22 test cases at this authoring revision; the private source-org GitHub Actions execution remains **NOT_EXECUTED** until a runner is actually allocated.

## What the report checks

- Original same-repository PR/head/base identities, merged state and pinned merge commit SHA; GitHub compare ancestry against **current** main.
- Protection boolean and, where accessible, exact review counts/CODEOWNERS, stale-dismissal, issuer-bound required checks, strict mode, zero bypass and force-push/deletion settings. A 403 protection-read is not accepted as proof.
- Submitted independent exact-head PR approvals, not review requests. It fails closed for missing/unreadable/truncated review pages. This is **not a complete supersession-aware review-timeline attestation**.
- Exact original PR-head, run ID, run attempt and job binding; allocated runner and completed meaningful steps. `steps=[]`, `steps=null`, setup-only jobs, changed run attempts, and failed jobs are not test successes.
- Positive job execution is labelled `STEPFUL_UNCLASSIFIED`, **not** proof of named test assertions, canonical source bytes, guest execution, AOT or cross-backend parity.

All records retain `POSTMERGE_RELEASE_ATTESTATION_REQUIRED`. The report always sets `status=BLOCKED`, `merge_authorized=false`, `release_authorized=false`, and `guest_parity_certified=false`, including on synthetic positive fixtures. For release, separately obtain administrator policy readback, independently submitted current-head reviews, required exact-landed-tree checks, full source-owned native/guest conformance receipts, and human authorization.

The existing [runner-admission P0 #315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315) and [private-source control hold #170](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/170) remain in force. Never move private source to another organization merely to acquire CI capacity. This checker does not enable branch protection; only authorized repository administrators can do so.
