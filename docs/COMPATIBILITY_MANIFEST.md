# Oreslang compatibility candidate lockfile

The single lockfile is [`integration/compatibility-candidate.v1.json`](../integration/compatibility-candidate.v1.json), paired with [`integration/org-repositories.v1.json`](../integration/org-repositories.v1.json).

This is a **private, non-promotable candidate snapshot**, not a claim that the whole Oreslang stack passes tests. It records **52 full Git commit SHAs and 52 stable numeric GitHub repository IDs**, one pair per repository, taken from authenticated GitHub repository metadata and **commit-search results** for their default branches on 2026-10-17. A commit-search match is not a signed statement of branch tip or approval. These pins are immutable object identifiers, *not* proof of dependency compatibility, correct checked-out code, compiled guest execution, functional correctness, or permission to transfer any private repository.

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

## Security and quality gates

1. Keep [private source exposure incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) open until its independent remediation and authorization gates are genuinely complete. A private destination or GitHub Actions budget alone is not authorization to mirror source.
2. Confirm source-org CI jobs **execute steps** at the exact candidate head. Jobs failing before runner assignment are `NOT_EXECUTED`, not code test failures or passes.
3. Establish compiler/runtime compatibility slices for Java/LLVM/JS/.NET/Forge/WASM/HDL plus core/alloc/actor/OTP separately. Each consumer has a small, runnable acceptance test.
4. Build a **separate** immutable evidence registry bound to this lockfile's Git blob/commit and reviewed exact-head receipts. Only after all required gates pass should a dedicated release promotion PR be considered.
5. Re-check the SHA/reachability of every pinned commit through authenticated GitHub or `git cat-file -t COMMIT` in explicitly permitted local checkouts at promotion time. The baseline search alone does not do this.

No web site, README badge, benchmark, or release automation should call this a tested Oreslang distribution until the promotion gates are in place.
