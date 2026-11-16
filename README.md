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

## Repository ownership and contribution routing

**Belongs here:** Portable positive and negative guest fixtures, five-backend matrix, evidence schemas and reproducible run receipts.

**Belongs elsewhere:** Backend implementations belong in atto-source.*; differential comparators in atto-compilers-parity-testing; normative rules in atto-spec.

**Security and portability boundary:** Report real executed guest programs pinned to SHA/tree and toolchain; zero-step workflows, host-only tests and source-free canaries are NOT_EXECUTED for guest parity.

AttoLang is the public name; preserve existing Oreslang/.ores compatibility and use canonical .atto for new portable library source. This README defines scope, not feature readiness.

**Acceptance:** name the exact source SHA/tree, runtime/toolchain, positive and negative checks and execution receipt before claiming support. Host-only tests and empty CI steps do not prove guest execution.

## Channel / return-position match conformance v1

- [Contract and backend evidence matrix](contracts/channel-return-ownership-v1.json)
- Fixtures: `fixtures/channel-return/{pass,fail,pending}`
- Metadata validator: `python3 -m unittest tests/test_channel_return_ownership_contract.py`

Rust/Wasm browser guest execution has an exact-tree CI receipt, but its
`abandon_read` cleanup helper is **host-only**. Automatic guest cleanup
on `^`/`return`, thrown errors, and actor termination is not yet implemented.
The `pending` case is a **known unimplemented ownership diagnostic**, not a
passing fixture. Java, LLVM, .NET, independent Wasm, and Forge require their
own compiled-guest receipts before any parity claim.
