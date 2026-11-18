# atto-platform-conformance

Cross-platform conformance tests for AttoLang compiler and runtime implementations.

## Purpose

Execute portable language fixtures and record target-specific results.

## Repository responsibilities

- Keep interfaces, schemas, and behavior documented in a backend-neutral form where applicable.
- Use test fixtures and reproducible evidence to distinguish proposed behavior from implemented behavior.
- Record breaking changes, migration notes, and dependencies on other AttoLang components.

## Shared ownership and explicit guard conformance (TARGET)

- [Versioned target registry](contracts/shared-ownership-and-guards-v1.json): 6 proposed positive and 12 proposed negative guest fixtures for `share!`, deep freeze, owner invalidation and explicit `RwLock<T>` guards.
- `python3 bin/validate_shared_ownership_and_guards.py` checks source/manifest integrity **only**. It cannot certify parser, compiler, runtime behavior or backend parity.
- A backend may claim **PASS** only after positive guests execute and negatives reject with zero emitted guest bytes at the exact source SHA, with meaningful stepful CI receipts; guard race/scheduler/cancellation testing is also required.
- [Normative draft specification](https://github.com/atto-lang/atto-spec/pull/90). Until executable implementation catches up, cases are `TARGET_NOT_EXECUTED`.

## Validation

Validation should rely on checked-in tests and exact-commit CI results. When reporting parity, distinguish **passed**, **failed**, **unsupported**, and **not executed**. Avoid inferring guest-runtime support from host-only tests.

## Status and development

This README records the intended role of this repository; it is not a claim of feature completeness. Consult the source tree and workflow files for actual implementation and verified build commands. Contributions should preserve compatibility with the canonical language contract.

## Ecosystem

- [AttoLang](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Cross-platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Repository ownership and contribution routing

**Belongs here:** Portable positive and negative guest fixtures, five-backend matrix, evidence schemas and reproducible run receipts.

**Belongs elsewhere:** Backend implementations belong in atto-source.*; differential comparators in atto-compilers-parity-testing; normative rules in atto-spec.

**Security and portability boundary:** Report real executed guest programs pinned to SHA/tree and toolchain; zero-step workflows, host-only tests and source-free canaries are NOT_EXECUTED for guest parity.

AttoLang is the public name; preserve existing Oreslang/.ores compatibility and use canonical .atto for new portable library source. This README defines scope, not feature readiness.

**Acceptance:** name the exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.
