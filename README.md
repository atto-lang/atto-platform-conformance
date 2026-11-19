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

All eight cross-backend targets remain `NOT_EXECUTED` pending independent
browser/compiler and runtime verification. A **separately scoped native Rust
compiler -> executed WebAssembly guest** receipt now records exact compiler
merge SHA `dbd450f5abde91a2d3a50d193c589a7f77888afc`, 39 matching
source blobs, Rust 1.99.1 focused tests (8/8), three actual guests returning
42 with byte-identical Wasm SHA-256, canonical guest 42, and negative
`E_DUPLICATE` with no guest artifact in
[successful carrier run #44436599781](https://github.com/gha-indie-worker/atto-ci/actions/runs/44436599781).
Source-only Node tests 32/32 passed in
[run #44435810059](https://github.com/gha-indie-worker/atto-ci/actions/runs/44435810059).
These receipts do **not** assert that the Rust compiler itself ran inside
`wasm32` or that Java/LLVM/.NET/Forge/independent Wasm have parity. Related
proposals: [atto-spec #98](https://github.com/atto-lang/atto-spec/pull/98),
[atto-source.rs #354](https://github.com/atto-lang/atto-source.rs/pull/354),
and [atto-format #16](https://github.com/atto-lang/atto-format/pull/16).

- [Class-field binding defaults v2](contracts/class-field-binding-defaults-v2.json): canonical implicit-`val` target, 4 SHA-matched `.atto` fixtures, 422-passing Rust native tests, and executed compiled WebAssembly guest. Cross-package linking and other backends remain NOT_VERIFIED.

## Under-construction self publication guard

`contracts/constructor-self-publication-v1.json` records negative `.atto`
cases for escaping a constructor's under-construction `self` through a function
argument or invoking methods on that object before publication. Valid direct
`self.field` initialization remains permitted. The normative contract is
[atto-spec's constructor design](https://github.com/atto-lang/atto-spec/blob/main/language/out-of-line-receivers-constructors-and-state-v1.md).

The Rust compiler's [PR #359](https://github.com/atto-lang/atto-source.rs/pull/359)
implemented a conservative `E_OWNERSHIP` gate and passed its actual
[private exact-blob Rust / compiled-Wasm run](https://github.com/gha-indie-worker/atto-ci/actions/runs/44444349850).
The two portable negative `.atto` fixtures were independently executed
against the native Rust compiler in
[private exact-blob run #44444993654](https://github.com/gha-indie-worker/atto-ci/actions/runs/44444993654):
49 blobs matched before/after, 10 Rust focused tests passed, 4 positive
compiled WebAssembly guests ran, and both negative cases returned
`E_OWNERSHIP` without creating guest artifacts. This proof is scoped to
the Rust **native-hosted** compiler; the Rust browser-hosted compiler and
independent Java/LLVM/.NET/Wasm/Forge/Cranelift/JS backends remain
`NOT_EXECUTED`.

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
