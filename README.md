# atto-platform-conformance

Cross-platform conformance tests for AttoLang compiler and runtime implementations.

## Naming migration and language authority

This repository is maintained at [atto-lang/atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance); use `https://github.com/atto-lang/atto-platform-conformance.git` for Git remotes and canonical `.atto` source examples. The normative language contract is [atto-spec](https://github.com/atto-lang/atto-spec), with executable guest evidence tracked by [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance). Follow current ownership, borrowing, effects, actor, and syntax rules there; do not infer implemented features from a README or unexecuted CI.

## Purpose

Execute portable language fixtures and record target-specific results.

## Repository responsibilities

- Keep interfaces, schemas, and behavior documented in a backend-neutral form where applicable.
- Use test fixtures and reproducible evidence to distinguish proposed behavior from implemented behavior.
- Record breaking changes, migration notes, and dependencies on other AttoLang components.

## Constructor header whitespace target fixtures

`contracts/receiver-constructor-whitespace-v1.json` tracks three equivalent
out-of-line class constructor spellings and one duplicate-header rejection.
Fixtures in `fixtures/receiver-constructors/` are ordinary `.atto` programs
with a target exit of 42; `tests/receiver-constructor-whitespace.test.mjs`
checks **source-only fixture integrity**, not compiler or guest execution.

Every backend is currently marked `NOT_EXECUTED`. Do not turn any entry into
`PASS` without exact-source/compiler SHA, real guest execution, negative
diagnostics, a nonempty test log, and target-specific evidence. Related
proposals: [atto-spec #98](https://github.com/atto-lang/atto-spec/pull/98),
[atto-source.rs #354](https://github.com/atto-lang/atto-source.rs/pull/354),
and [atto-format #16](https://github.com/atto-lang/atto-format/pull/16).

## Validation

Validation should rely on checked-in tests and exact-commit CI results. When reporting parity, distinguish **passed**, **failed**, **unsupported**, and **not executed**. Avoid inferring guest-runtime support from host-only tests.

## Status and development

This README records the intended role of this repository; it is not a claim of feature completeness. Consult the source tree and workflow files for actual implementation and verified build commands. Contributions should preserve compatibility with the canonical language contract.

## Ecosystem

- [AttoLang](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Cross-platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Repository ownership and contribution routing

**Belongs here:** Portable positive and negative guest fixtures, an extensible multi-backend matrix, evidence schemas and reproducible run receipts. Include new backends only when target-specific compiled-guest evidence exists.

**Belongs elsewhere:** Backend implementations belong in atto-source.*; differential comparators in atto-compilers-parity-testing; normative rules in atto-spec.

**Security and portability boundary:** Report real executed guest programs pinned to SHA/tree and toolchain; zero-step workflows, host-only tests and source-free canaries are NOT_EXECUTED for guest parity.

AttoLang is the canonical project name; new source, examples and documentation use `.atto` and the `atto-lang` repository organization. This README defines scope, not feature readiness.

**Acceptance:** name the exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.
