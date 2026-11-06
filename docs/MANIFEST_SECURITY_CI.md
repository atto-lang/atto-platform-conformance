# Five-backend manifest security CI evidence (v1)

This verifier is a **read-only, live GitHub evidence gate** for the five stacked
manifest-boundary hardening PRs. It is not a signature verifier, a compiler
parity test, a permission to export private source, or authority to merge.
The candidate JSON supplies IDs only; claims such as `PASSED` and test counts
are intentionally ignored. The verifier independently retrieves the current
GitHub PR, source commit/tree, workflow Git blob, run and job metadata.

## Invocation

Prepare a private candidate file with the following exact shape, containing
one entry for each of `java`, `llvm`, `wasm`, `net`, `forge`:

```json
{
  "schema": "atto.manifest-security-ci/1",
  "candidates": [
    {
      "backend": "java",
      "repository": "ores-truffle-oreslang/oreslang-source.java",
      "repository_id": 1400792274,
      "pr": 2573,
      "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "tree_sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "run_id": 12345678,
      "job_id": 87654321
    }
  ]
}
```

The one-entry example is **not** an admissible receipt. A real input must
contain all five current exact heads with their real source tree SHAs and real
successful run/job IDs. The verifier's version-pinned repository IDs, PRs,
workflow blobs, and expected steps require reviewed code changes to update.
Never use the placeholder SHAs above as source evidence.

```sh
GITHUB_TOKEN=... node bin/verify-manifest-security-ci.mjs /secure/path/candidate.json
node --test test/manifest-security-ci.test.mjs
```

Use a GitHub token scoped for **read-only** access to the five private source
repos' pull requests, contents and Actions metadata. Do not paste the token in
chat or commit it. The reader calls only `https://api.github.com` with a
fixed API version and refuses redirects, errors and oversized responses.
No Git tree, source file, or artifact is transferred to a carrier organization.

## Denial conditions

- Missing, duplicate, unknown or substituted backend/repository/PR IDs.
- Changed PR head/base, foreign head repo, or wrong source Git tree SHA.
- Workflow Git blob differs from the reviewed/pinned definition.
- Run is not a completed successful PR run bound to the exact source head.
- Job has no allocated runner, zero executed steps, stale run linkage,
  mismatched checkout action, or missing/failed/duplicate required test steps.
- GitHub API is inaccessible, private-repo permission is absent, or metadata
  cannot be corroborated. `failure`, `queued`, and `NOT_EXECUTED` never pass.

For GitHub `pull_request` workflows, the run's `head_sha` can refer to a
synthetic merge ref rather than the PR source head on some trigger paths. This
v1 verifier deliberately **fails closed** on such cases. A redesigned
provenance proof must be reviewed before relaxing that equality; a checkout
step's name alone cannot attest the exact compiler source or binary.

## Explicit limits of CI_VERIFIED

`CI_VERIFIED` means GitHub metadata corroborates the named workflow checks;
it is **not** proof of test content, Windows/macOS qualification, artifact
reproducibility, independent reviewer trust, protected `main`, or release
eligibility. A malicious workflow that preserved a pinned job name cannot be
trusted without inspecting the pinned workflow bytes and reviewing policy.

The five current compiler repositories still have zero-step source Actions
failures. Before attempting release, restore runner admission, verify actual
execution on the latest heads, obtain genuinely independent approvals (the
operator-controlled identities are not independent), enforce protected-main
status checks, and merge parent/child PRs in reviewed order. Cross-org private
source movement remains prohibited absent separate, specific authorization.
