# Canonical merge-wave evidence v1

This source-free advisory module is a child of draft conformance PR #512. The stack is #483 live collector -> #486 integration adapter -> #512 UTC-calendar admission -> this canonical evidence envelope. The original parent branches and existing files are not modified.

## Purpose

Normalize a bounded read-only snapshot from both the actual live collector and the actual integrated adapter. The inputs are not trusted merely because they resemble GitHub data. Return a deterministic, non-authorizing record with pinned primitive repository identity, PR number, head SHA, base SHA, tree SHA, exact UTC observation epoch, review completeness, CI job identity, and explicit evidence class.

The canonicalizeMergeEvidence function consumes an object containing audit (from bindMergeWaveGates.auditPR) and live (from collectLiveEvidence). These two readbacks must have the same source identity and exact observation epoch. The caller must coordinate a shared clock/epoch or accept a BLOCKED mismatch. Missing or contradictory inputs, invalid Gregorian timestamps, object-coercing Git IDs, malformed job IDs, duplicate jobs across attempts and unbounded inventories all block. Dynamic blocker codes have a narrow printable whitelist to avoid laundering control characters into downstream summaries.

## Classes, not certifications

- NOT_EXECUTED: every reported job has zero or absent steps and no allocated runner. This is a runner-admission or missing-execution record, NOT failing compiler tests.
- REPORTED_EXECUTION_UNATTESTED: the collector reported a positive runner and nonzero steps. The envelope cannot authenticate actual check provenance, toolchain, stdout, negative assertions, artifact hashes or guest execution.
- MIXED_OR_INCOMPLETE / UNOBSERVED: evidence lacks a consistent completed execution story.
- contract_valid: internal JSON shape and consistency only; never independently certified provenance.

Every output always has status BLOCKED, merge_authorized false, guest_parity_certified false and ci.execution_verified false. The five-PR canonicalizeMergeWave wrapper additionally validates exact wave size, unique PR identities and at least three repositories, but **never authorizes a merge**.

## Proof boundaries

The test imports the real source files of #483 collector and #512 binder, but uses a controlled GET-only in-memory transport. The other three binder dependencies (review timeline #477, ledger #467/#481 and qualifier #470/#474) are injected stubs because their independently owned draft implementations are not present in this branch ancestry. This is NOT a complete real five-gate integration nor an authenticated live GitHub run.

The focused isolated-V8 Node-test-compatible harness executed 21/21 test groups including real collector+adapter paths. Five deliberate security mutations (runnerless false-success, impossible calendar date, duplicate job, zero-step misclassification, merge authorization) each caused at least one test failure. This is host-only local evidence, not native Node 22, source-owned Actions or AttoLang compiler guest parity.

## Next acceptance sequence

1. Complete independent review and merge the parent components in dependency order, without altering source confidentiality or bypassing governance.
2. Run native Node 22: node --test tests/merge-wave-canonical-evidence-v1.test.mjs, then npm test on the exact source PR head using an admitted same-org private runner with meaningful job steps, expected commit/tree readback and traceable artifacts.
3. Replace remaining injected stubs with the real reviewed components and add job/attempt/step/authenticated policy/eligible reviewer join tests; never infer identities from caller-supplied booleans.
4. Require administrator-enabled protected main, required app-bound CI checks, independently eligible reviewer approvals and full positive/negative compiler-backed receipts before any separate SHA-fenced executor may merge.

No private source export, network writes, approvals, merger or admin changes are implemented here.
