# Source-free platform carrier receipt triage (non-authorizing)

This tool distinguishes **reported host test results** from actual source-export permission, repository-local canary outcomes, and independent release approvals. It is deliberately read-only, depends only on supplied JSON metadata, and never downloads or copies source files.

The module is `src/platform-carrier-receipt.mjs`; regressions are in `tests/platform-carrier-receipt.test.mjs`. Run the source-local tests with:

```sh
node --test tests/platform-carrier-receipt.test.mjs
```

## Required input

Call `inspectCarrierReceipt(sourcePin, carrierReceipt)` with two separately collected immutable metadata objects. Both need `repository_id` (positive integer), `commit_sha` and `tree_sha` (40 lowercase hexadecimal characters), and `visibility` (`private` or `public`). The carrier receipt additionally needs a bounded `workflows` array containing `name`, `kind` (`test`, `governance`, or `source_identity_canary`), `status`, `conclusion`, and `executed_steps`.

The source pin MUST be verified separately against the source repository Git commit/tree, and carrier job steps MUST be corroborated against actual runner logs. **Metadata equality is not proof of code authenticity or permission to export.** Never derive the trusted source pin solely from an unreviewed carrier or from its labels.

A `source_identity_canary` may be intentionally nonportable: if its job checks `GITHUB_REPOSITORY` against the original repository name, it will fail in a carrier. The classifier can report other test jobs as *reportedly passing* while preserving `reported_all_workflows_successful:false` and the canary failure count. It does not turn the overall Actions suite green.

Missing, cancelled, skipped, zero-step, timed-out or failed substantive test/governance jobs are not counted as passing. Public destination for private source, mismatched trees, duplicate or malformed workflow identities, and unbounded inputs are rejected or marked as security risks.

Every classification returns `authorizes_source_transfer:false`, `authorizes_merge:false`, `certifies_source_free:false`, `authenticated_ci:false`, and `proves_guest_backend_parity:false`. This is a **triage helper**, not a release gate or a proposed exception to one.

## Active security hold

Do **not** create new private-source cross-organization mirrors or rerun unapproved source-bearing carriers. Conformance incident [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) (public-carrier exposure) and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) (private-carrier authorization) remain separate open P0 investigations. Their independent containment, reviewed source/destination snapshot authorization, and the required Java main protection are **not** waived by successful carrier tests.

Preserve existing logs, refs, repository IDs and source-tree metadata for independent incident review. Do not delete evidence merely to make a check appear clean. Prefer canonical source-org CI after the security and funding gates are resolved. Never claim generic host tests or virtual synthesis qualify a device, hard real-time deadline, full native guest, or ASIC signoff.
