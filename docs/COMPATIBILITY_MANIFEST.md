# Oreslang compatibility candidate lockfile

The single lockfile is [`integration/compatibility-candidate.v1.json`](../integration/compatibility-candidate.v1.json), paired with [`integration/org-repositories.v1.json`](../integration/org-repositories.v1.json).

The candidate's `inventoryGitBlobSha` binds it to the **entire exact canonical inventory Git blob** (all nodes, edges, visibility and `nextGate` text), not merely the list of 56 names. Loaders require canonical 2-space JSON with a terminal newline and reject duplicate keys, reordering/alternate formatting and oversized JSON before structural validation. Any intentional inventory change requires a reviewed new candidate with a matching inventory digest; this hash does not replace access control or independent review.

This is a **private, non-promotable candidate snapshot**, not a claim that the whole Oreslang stack passes tests. It records **56 full Git commit SHAs and 56 stable numeric GitHub repository IDs**, one pair per repository: 52 original historical candidate pins plus four verified newly discovered `main` snapshot pins for Tensor, Autograd, ML and ML Conformance. Candidate #2 is not a claim of current branch heads or execution. A commit-search match is not a signed statement of branch tip or approval. These pins are immutable object identifiers, *not* proof of dependency compatibility, correct checked-out code, compiled guest execution, functional correctness, or permission to transfer any private repository.

## Validate

```sh
npm test
node bin/check-org-integration.mjs
node bin/check-compatibility-release.mjs

# This is expected to fail with exit code 3 until a reviewed release
# promotion flow with full evidence has been implemented:
node bin/check-compatibility-release.mjs --require-ready
```

Output includes `CANDIDATE_ONLY_NOT_COMPATIBILITY_PROOF`, `releaseReady: false`, and zero verified integrations. The validators run locally, read JSON only, make **no network calls** and do not copy Git source. The `--require-ready` guard prevents downstream release automation from silently treating this snapshot as a tested release.

## Consumer pinning contract

- Identify a repository in the lockfile by **both exact organization/repo name and stable numeric GitHub repository ID**, then use its **full commit SHA**, never floating `main`, to select the intended source revision. At promotion time, re-query the authenticated GitHub repository metadata and compare its stable ID to reject a deleted/recreated or renamed-name impostor.
- Consumers should hold their own SHA pins or Git submodule commit pins until the explicit compatibility receipt is approved; the snapshot does *not* replace independently versioned consumer dependency locks.
- For every dependency edge, exercise the actual consumer against the pinned provider. Record exact compiler binary/source identity, source fixture blob SHAs, the guest executed outcome, deterministic oracle, target profile, host permissions, runtime artifact and test-run URL. Unsupported backends must reject unsupported source features without pretending execution.
- Promotion requires independent review of both semantics and security. The validator **intentionally does not accept** manually added `VERIFIED` labels or self-authored CI URLs as proof. A future signed/verifiable evidence schema and executor must be reviewed before `BLOCKED_UNVERIFIED` can change.
- The proposed registry and lockfile live on PR #79, **not** on `main`. Until the PR is reviewed and merged, the lockfile is a review candidate only.

## Authenticated provenance audit (metadata only)

The optional `npm run audit:pin-provenance` requires an explicitly provisioned `ORESLANG_REPOSITORY_READ_TOKEN` with read-only repository metadata access across **all 56 repos**. The ordinary per-repository `GITHUB_TOKEN` must **not** be assumed to have access to 44 other private repositories. Do **not** add the token to the workflow by default.

The auditor calls only GitHub's REST API on `api.github.com`, disables redirects, and fetches repo identity, default `main` Git ref, and commit comparison metadata. For ancestor pins, a successful comparison must have `status=ahead`, `behind_by=0`, `base_commit.sha` equal to the pinned SHA **and** `merge_base_commit.sha` equal to the pinned SHA; a high-level comparison status alone is insufficient. It **never fetches raw source, trees, contents, or private artifacts**, and exits nonzero on missing authority, mismatch, rewritten history, or GitHub API failure.

```sh
# Only after an administrator explicitly authorizes a read-only org-wide token:
ORESLANG_REPOSITORY_READ_TOKEN="$READ_ONLY_GITHUB_APP_TOKEN" npm run audit:pin-provenance
```

A `READ_ONLY_PIN_PROVENANCE_NOT_COMPATIBILITY` result proves the listed commit IDs remain reachable from authorized repo heads and the exact repository identity/visibility matches. It is **not** compiler correctness, CI execution, release readiness, independent security approval, or evidence that a pin remains current `main`; historical ancestors are allowed.

For the **earlier 52-repo candidate only**, authenticated GitHub metadata was checked on 2026-10-18: 45 pins equaled `main`, while seven were proven ancestors with GitHub compare `status=ahead` and `behind_by=0`. The seven are `html-js-css-syntax-highlighter`, `ores-truffle-oreslang.github.io`, `oreslang-serialization-and-validation`, `oreslang-target-profiles`, `rx-ores`, `rx-ores-callbacks`, and `vscode-plugins`. This is a historical review-time observation, NOT proof that all 56 candidate #2 pins currently match or descend from `main`. Do not treat it as a permanent attestation.

## Alternate-organization source-free CI canary

GitHub Actions in the source organization has failed before runner allocation. A **separate private** carrier, [`scintilla-run-test/gleam-runner-conformance`](https://github.com/scintilla-run-test/gleam-runner-conformance), has working runner capacity. As an explicit confinement measure, do **not** copy the conformance repo, private compiler source Git trees, lockfile, inventory, source artifacts, or secrets into this carrier. Issue [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) remains open; carrier visibility alone does not grant permission to mirror.

An **independently authored synthetic** CI evidence classifier and test fixture were created in the carrier, on branch `validation/source-free-oreslang-ci-evidence-20261017`. GitHub-hosted [run #39092687507](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/39092687507), exact head `2c547899152cd8506454cb0c5e25e0136a347f04`, executed checkout, Node 22 setup, tests and isolation steps; job logs report **20/20 tests passed**. The tested blob SHAs were:

- `source-free/runner-evidence.mjs`: `fe1e4793fef1b52ccb64a0a545a369b935bd53a4`
- `source-free/test/runner-evidence.test.mjs`: `4e9deae82ed4a7b9080b806358a6b5005d7ba834`

Those **same blobs were imported into this private review branch, carrier → source organization**, where the ordinary `npm test` discovers the source-free fixture. The synthetic verifier classifies authentic GitHub run/job metadata as `RUNNER_STEPS_OBSERVED` only when the expected SHA, repository ID, workflow, successful job/steps and required named test steps match. It rejects zero-step jobs and wrong revisions. It always reports `sourceCompatibilityVerified:false` and `releaseReady:false`.

**Evidence scope:** exact-blob GitHub-hosted execution of a synthetic **CI evidence classifier only**. It does not verify actual private Oreslang conformance code, source-org runners, compiler behavior, user-code isolation, cross-repo compatibility or mirror authorization. The reviewed conformance PR #79 is still draft and must pass native Node tests on its own exact source-org head once protected CI is restored.

## New ML/tensor integration gate

The compatibility candidate now accounts for the four new private repositories with exact IDs and pins. A separate `oreslang-ml-conformance` review branch holds **same-organization provider contract snapshots** from tensor, autograd and ML, with matching Git blob identifiers. Its independent host-only numerical oracle suite passed 26/26 tests on the private source-free funded carrier ([Actions #39093380746](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/39093380746)); this does **not** prove Oreslang compiler execution. All ML providers remain `NOT_EXECUTED` and do not qualify for release promotion.

## Full 56-repo immutable head-provenance observation

The separate [`integration/head-provenance-snapshot.v1.json`](../integration/head-provenance-snapshot.v1.json) records an authenticated **read-only** GitHub ref/compare observation for all 56 candidate repositories (2026-10-17 US Eastern / 2026-10-18 UTC): **34 frozen pins still equal current `main`; 22 differ but were individually confirmed to be strict ancestors of the then-current `main` via GitHub compare `status=ahead`, `behind_by=0`, `base_commit.sha=pinnedSha`, and `merge_base_commit.sha=pinnedSha`. No missing refs, repository IDs, or divergent histories were observed.

`npm run check:head-snapshot` structurally binds every observed row to the immutable 56-pin candidate. It **does not call GitHub again**, and its output is `SNAPSHOT_STRUCTURE_ONLY_NOT_REMOTE_ATTESTATION`. Later branch updates can make it stale; rerun the authenticated read-only audit before treating the snapshot as a current observation. This file is not a test pass, independent approval, source export permission, or release attestation.

The [`oreslang-ml-conformance`](https://github.com/ores-truffle-oreslang/oreslang-ml-conformance) draft records a separate 3-provider contract lock and independent scalar/tensor/autograd/SGD reference oracles. Corresponding tensor/autograd/ML draft PRs must not be merged as implemented guest behavior based solely on this metadata.

## Security and quality gates

1. Keep [private source exposure incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) open until its independent remediation and authorization gates are genuinely complete. A private destination or GitHub Actions budget alone is not authorization to mirror source.
2. Confirm source-org CI jobs **execute steps** at the exact candidate head. Jobs failing before runner assignment are `NOT_EXECUTED`, not code test failures or passes.
3. Establish compiler/runtime compatibility slices for Java/LLVM/JS/.NET/Forge/WASM/HDL plus core/alloc/actor/OTP separately. Each consumer has a small, runnable acceptance test.
4. Build a **separate** immutable evidence registry bound to this lockfile's Git blob/commit and reviewed exact-head receipts. Only after all required gates pass should a dedicated release promotion PR be considered.
5. Re-check the SHA/reachability of every pinned commit through authenticated GitHub or `git cat-file -t COMMIT` in explicitly permitted local checkouts at promotion time. The baseline search alone does not do this.

No web site, README badge, benchmark, or release automation should call this a tested Oreslang distribution until the promotion gates are in place.
