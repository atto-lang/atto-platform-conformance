# Read-only organization-wide GitHub PR inventory (draft)

**Engineering proposal only.** This child depends on conformance #467/#481; it does not update the production four-hour watch, trigger GitHub Actions, modify reviews/branches/settings, mirror private source, or make release/transfer decisions. Only GitHub API **GET** calls are issued, and no code/blob source is requested. All data remains in an opt-in local snapshot file (mode 0600 at creation), not sent to another organization.

## Usage (requires review before production integration)

Node >=22 and an installation-scoped GitHub token with repository/pull requests/actions read permissions are required. No sample token or credentials are included.

```
GITHUB_TOKEN=<installation-read-token> node bin/pr-blocker-org-live-v1.mjs \
  --org ores-truffle-oreslang --inspect-ci --output ./private-audit-output.json \
  --max-repos 500 --max-prs 5000 --max-requests 12000
```

This command is **not invoked by a scheduler**. Treat snapshots as confidential organizational metadata; do not commit them or upload them to an external carrier. For offline tests run `node --test tests/pr-blocker-org-live-v1.test.mjs`.

## Evidence boundaries

1. The installation API (`GET /installation/repositories`) is paginated. This covers **repositories accessible to that installation**, not necessarily every repository in the organization; a limited installation cannot establish complete org-wide access. The operator must independently verify installation scope. Missing/denied enumeration is reported as incomplete, never zero PRs.
2. Each visible repository is enumerated through canonical open `/pulls` pagination, then cross-checked against date-partitioned GitHub `/search/issues` results. Saturated 1,000-result search windows split recursively at UTC-second boundaries; a saturated one-second interval becomes an explicit coverage gap. Dynamic search indexing or concurrent PR changes can also cause gaps. `--no-search-crosscheck` is diagnostic-only and always marks coverage incomplete.
3. Each inspected PR is reread by canonical PR GET before and after inspection; changed heads fail closed. Exact-head Actions run attempts, each run's jobs, and each job's steps are individually requested with pagination. #481's classifier enforces exact run/attempt/job/head binding; `[]` on a failed job means OBSERVED_NO_STEP_FAILURE, while `null` means UNOBSERVED, never compiler failure.
4. Submitted CHANGES_REQUESTED are grouped by review author (latest substantive event), requested reviewers retained. REST cannot prove unresolved thread resolution, so the status is UNOBSERVED. Branch-protection 403 is UNKNOWN; only an explicitly readable positive approval requirement is labeled REQUIRED, never inferred from a requested reviewer.
5. All rate-limit retries are bounded (Retry-After or x-ratelimit-reset), and requests honor 403 permission denial without retry when it is not a limit. Body sizes are capped at 8 MiB, UTF-8 fatal-decoded, redirection rejected, and credentials are not included in snapshot output. Explicit budgets prevent runaway API requests.
6. This collector intentionally does not prove five-backend guest execution, source transfer authorization, branch ruleset completeness, code-owner enforcement, signed execution receipts, model checking, or that no PR appeared after the scan. A successful host-only result is not compiler certification.

## Known gaps before deploying the four-hour watch

- An installation scope attestation for *all accessible/expected* repositories, independent of repository pagination.
- Cross-repo transactionality: PRs created during the scan or GitHub search indexing lag can still change an inventory. A stable double-pass sweep or webhook reconciliation is needed for strong snapshot coverage.
- Complete GraphQL review-thread resolution and organization/branch ruleset applicability, with auditable authorized read permissions. Until then, review-thread/approval completeness is **UNKNOWN**.
- CI run matching can be missing when Actions lacks permissions. Unavailable = UNOBSERVED. The library must never treat source-free canaries as compiled guest evidence.
- Durable protected storage, scheduled invocation, PII minimization, retention, alert-delta checkpoints and independent security approval.

This PR is **draft**; initial Node tests exercise mocked READ responses locally. No live installation token, real exact-head GitHub Actions execution, or TLA+ model check has been performed for the new adapter.
