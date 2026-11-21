# Atto source-repository parity inventory (11 repositories)

**Status: AUDIT BASELINE ONLY — NO COMPILER/GUEST PARITY CERTIFIED.** Captured 2026-11-21. The machine-readable inventory is [atto-source-repository-parity-audit-v1.json](../contracts/atto-source-repository-parity-audit-v1.json). Every source baseline SHA was read from the authenticated GitHub `main` branch endpoint during this audit, but a commit recorded then may become stale immediately. Re-read source and merge-group SHAs for each actual test or merge.

## Coverage boundary

The eleven `atto-lang/atto-source.*` repositories are: `.atto`, `.net`, `.hdl`, `.java`, `.realtime`, `.rs`, `.llvm`, `.js`, `.forge`, `.wasm`, and `.cranelift`. Do not omit self-hosting or realtime source repositories simply because a historical nine-backend contract omitted them. This inventory deliberately records unknown capability profiles rather than assuming that restricted RTL, realtime and self-hosted profiles expose all general-purpose language/runtime features.

The previously authored [value blocks/ranges inventory #501](https://github.com/atto-lang/atto-platform-conformance/pull/501) is a **historical legacy Oreslang-source snapshot**, with nine backend rows and ten guest lanes. Its old immutable blob/source pins must not be silently relabeled as current Atto compiler receipts. [Ref32 growth #461](https://github.com/atto-lang/atto-platform-conformance/pull/461) has a different feature-specific seven-implementation heap gate and eleven NOT_EXECUTED hybrid compatibility statuses. Retain both narrower contracts. This inventory is independent of their exact source and feature-specific contracts.

## Required completion per feature and backend

1. Confirm if the feature is supported by the backend's **defined capability profile**. For unsupported hardware/realtime/restricted profiles, require a real exact-head compiler rejection with the required diagnostic and no output artifact; a skipped job is not success.
2. Reconcile current Atto spec, formatter, borrow checker, CLI, the canonical legacy-to-Atto migration crosswalk, and relevant competing Ready/Draft PR patches before coding or merging. Prefer the existing implementation branch and preserve unique work.
3. Pin the current Atto source commit and Git tree; run actual frontend/compiler tests, negative permission/ownership tests and real native/AOT/browser/RTL guest execution appropriate to the profile. Distinguish an interpreter, Wasm wrapper, host JS oracle, provenance probe, and real compiled guest.
4. Independently verify GitHub Actions run ID, exact source/merge-group SHA, actual job/step execution, exit status, guest stdout/return/diagnostics and artifact digests. Current mandatory **source** checks and GitHub protection remain binding. An alternate-org run, if independently authorized and privacy-safe, is supplemental only.
5. Record one evidence receipt for each applicable feature/backend pair before asserting parity. No receipt exists in this baseline. Never promote an authored test, job name, or self-attested JSON receipt to verified execution without external checks.

Run the registry integrity and negative/adversarial tests with:

```sh
node --test tests/atto-source-repository-parity-audit-v1.test.mjs
```

**This executes only a source-free inventory validator. It cannot typecheck or run an Atto program.** Cross-organization private-source mirroring remains blocked without destination-specific confidentiality authorization and reviewed carrier policy; Actions minutes must not be inferred exhausted from a zero-step failure without its explicit admission reason.
