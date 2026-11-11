# atto-platform-conformance

Cross-platform conformance tests for AttoLang compiler and runtime implementations.

## Purpose

Execute portable language fixtures and record target-specific results.

## Repository responsibilities

- Keep interfaces, schemas, and behavior documented in a backend-neutral form where applicable.
- Use test fixtures and reproducible evidence to distinguish proposed behavior from implemented behavior.
- Record breaking changes, migration notes, and dependencies on other AttoLang components.

## Validation

Validation should rely on checked-in tests and exact-commit CI results. When reporting parity, distinguish **passed**, **failed**, **unsupported**, and **not executed**. Avoid inferring guest-runtime support from host-only tests.

## Status and development

This README records the intended role of this repository; it is not a claim of feature completeness. Consult the source tree and workflow files for actual implementation and verified build commands. Contributions should preserve compatibility with the canonical language contract.

## Ecosystem

- [AttoLang](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Cross-platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Pull/push collections (target-only candidate)

The [pull/push admission v1 manifest](contracts/pull-push-admission-v1.json) defines 19 candidate checks
covering lazy iterators, reactive demand, bounded channels, failed-send ownership,
cancellation, actor generations, and compiler/allocator safety. Its [Node model integrity
tests](tests/pull-push-admission.test.mjs) intentionally **reject all unattended PASS
claims**. They are **not** guest tests, source implementation, or five-backend parity.
The normative [language amendment](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/35)
and [source-free model](https://github.com/atto-lang/atto-rx-channels/pull/3) track semantics.
