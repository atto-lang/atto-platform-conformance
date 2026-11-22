# atto-platform-conformance

Cross-platform conformance tests for AttoLang compiler and runtime implementations.

## Purpose

Execute portable language fixtures and record target-specific results.

## Repository responsibilities

- Keep interfaces, schemas, and behavior documented in a backend-neutral form where applicable.
- Use test fixtures and reproducible evidence to distinguish proposed behavior from implemented behavior.
- Record breaking changes, migration notes, and dependencies on other AttoLang components.

## Proposed implicit argument borrowing

[Target registry](contracts/implicit-argument-borrow-v1.json): `python3 bin/validate_implicit_argument_borrow.py` validates the 30 source-only fixture expectations and registry paths against all 11 active atto-source.* repositories, including same-call borrow/move exclusions, inferred borrowed-return and named `lt!` lifetime cases. Run `python3 -O tests/implicit_argument_borrow_validator_smoke.py` to confirm invalid manifests fail closed even with assertions disabled (eight deliberate tamper variants). Neither command compiles or executes AttoLang guests. Each compiler/backend needs independent exact-head guest and no-artifact evidence; backend states remain `NOT_EXECUTED`.

## Ownership-bang interpretation for implicit-call fixtures

Treat a normal nonprimitive call `inspect(owner)` as an implicit readonly
`borrow!` under the target language contract. The paired spelling
`inspect(borrow! owner)` must yield identical scoped loan rights and retain
the original owner; neither permits mutation or an owned return. Mutable
`update(mut owner)` and explicit `update(borrow! mut owner)` require unique
write authority. Consuming calls must use `take!` at the formal and caller.

Related operations remain separate: `share!` requires frozen or guarded
shared authority; `copy!` is a proven shallow copy and `copy!!` an
independent deep graph; `pin! take!` fixes pointee storage but does not
extend borrows across await/actor boundaries; `drop!` consumes only after
loans end. Add paired negative guests for every authority change instead of
promoting host-only manifest validation as compiler evidence. The existing
implicit-borrow registry's status stays `NOT_EXECUTED` until actual guests
compile and run on exact compiler + fixture trees.

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
