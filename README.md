> **AI agent instructions (organization-wide):** Before working on code, issues, or pull requests, read and follow the [organization `AGENTS.md`](https://github.com/atto-lang/.github/blob/main/AGENTS.md), including its **merge-first stealth-development policy**. Honor any repository-local `AGENTS.md`, explicit holds, and GitHub-enforced rules.

# atto-platform-conformance

Cross-platform conformance tests for AttoLang compiler and runtime implementations.

## Naming migration and language authority

This repository is maintained at [atto-lang/atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance); use `https://github.com/atto-lang/atto-platform-conformance.git` for Git remotes and canonical `.atto` source examples. The normative language contract is [atto-spec](https://github.com/atto-lang/atto-spec), with executable guest evidence tracked by [atto-platform-conformance](https://github.com/atto-lang/atto-platform-conformance). Follow current ownership, borrowing, effects, actor, and syntax rules there; do not infer implemented features from a README or unexecuted CI.

## Java current-main checked-i64 candidate

[Java PR #1736](https://github.com/atto-lang/atto-source.java/pull/1736) is the narrow **current-main** forward-port corresponding to this numerical fixture set. It preserves newer `Result` trap handling rather than overwriting it from stale [Java #1329](https://github.com/atto-lang/atto-source.java/pull/1329). Its source CI [run 44968407111](https://github.com/atto-lang/atto-source.java/actions/runs/44968407111) has zero steps; all target compiler lanes remain `not_executed`, including Java native AOT.

## Numeric guest source candidates — no execution proof

[Manifest](fixtures/numeric-guest-v1/manifest.json) pins eleven canonical `.atto` programs for checked int/i64 division, remainder, zero divisors and MIN / -1 overflow. Each source has an independently verifiable Git blob SHA. Run `node --test tests/numeric-guest-source-v1.test.mjs` to validate the source-only contract (not compiler support).

Required later: compile the same source blob with every declared backend, execute the success case to return 42, prove typed negative diagnostics or guest failures with no illegal artifact, and capture exact compiler/tree/fixture/run/step/AOT provenance. Every backend remains `not_executed` until those receipts are authenticated.

## Numerical semantics v1 (target only)

The [51-case exact numeric registry](contracts/numeric-semantics-v1.json) and [source-free BigInt-based oracle test](tests/numeric-semantics-v1.test.mjs) check proposed integer, decimal, fixed-point, vector and dimensional results. The separate [11-fixture guest-source manifest](fixtures/numeric-guest-v1/manifest.json) pins candidate `.atto` quotient/remainder, `trap`, NaN, signed-zero and exact integer-vs-float comparison cases; [source-integrity tests](tests/numeric-guest-source-v1.test.mjs) reject duplicate IDs and mismatched Git blob identities. Run `node --test tests/numeric-semantics-v1.test.mjs tests/numeric-guest-source-v1.test.mjs`. **These tests do not execute an AttoLang compiler or prove full guest AOT; every backend remains not_executed until authenticated guest evidence is added.**

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

## Tuple destructuring target registry

- [Tuple destructuring v1](contracts/tuple-destructuring-v1.json): 33 acceptance/rejection cases spanning binding modes, aliases, const and ownership. On the **exact final merged Rust/browser-Wasm compiler SHA `026739474d0702d55b02b9772f8b13a7c7b461b0`**, [post-merge CI run 44447960061](https://github.com/usa-acc/atto-ci/actions/runs/44447960061) proved **29 passed** (15 positive compiled-and-executed Wasm guests and 14 expected negative diagnostics), **4 unsupported** (non-Copy object tuples), **0 failed**, using 68/68 exact compiler blobs and 4/4 exact conformance inputs. The earlier [historical receipt](evidence/tuple/rs-browser-wasm-4fd0a231-20261118.json) remains preserved. [Latest machine-readable receipt](evidence/tuple/rs-browser-wasm-02673947-20261118.json) preserves all cases, and [Node contract test](tests/tuple-destructuring-v1.test.mjs) validates receipt provenance and consistency; [guest runner](tests/tuple-destructuring-guest.mjs) performs real compilation and guest execution when provided `ATTOC_BIN` and `ATTO_SOURCE_SHA`. The other five backends remain `not_executed`; case-level aggregate parity stays `not_executed` until independently proven. Do not treat host-only receipt validation as guest execution.


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

## Inline class constructor self-publication conformance v2

`contracts/class-constructor-self-publication-v2.json` extends the out-of-line
constructor safety cases to legacy **inline** class constructors. It includes
two portable compile-negative `.atto` fixtures for `publish(self)` and
`self.peek()` before initialization/publication, plus a positive fixture
executing an initialized `Counter` and returning 42.

The exact checked-in fixtures were executed on the native Rust compiler in
[private token-free 48-source-blob carrier run #44447969540](https://github.com/gha-indie-worker/atto-ci/actions/runs/44447969540):
12 Rust focused tests passed, both negatives returned `E_OWNERSHIP` and
emitted no Wasm, the positive compiled Wasm guest returned 42, and two Node
registry checks passed. This is **native-hosted Rust compiler → Wasm guest**
proof only. The browser-hosted compiler and other independent backends
remain `NOT_EXECUTED`; constructor definite-initialization analysis remains
a separate work item.



## Explicit deferred final class constructor fields

`contracts/constructor-definite-final-v1.json` defines 13 portable Atto
fixtures for the narrow `final int id;` case: three positive constructors
(direct, `if/else`, and out-of-line) and ten compile-negative cases.
All other class fields continue to need declaration initializers in the
current Rust/browser compiler; the accepted v2 implicit `val` default
is unchanged. The constructor checks both **definitely initialized** and
**possibly initialized** branch states, rejecting reads before initialization,
possible double writes and a successful path without all deferred fields set.
Loops, exception regions and deferred callbacks cannot acquire an unproven
exactly-once field write capability.

The exact checked-in fixtures were compiled with the native Rust compiler
and executed in
[private carrier run #44452651416](https://github.com/gha-indie-worker/atto-ci/actions/runs/44452651416):
58 source Git blobs verified; three valid guest Wasm programs returned 42;
all ten negatives failed with expected diagnostics and no Wasm artifacts.
The fully reconciled compiler's
[locked Rust regression #44454006529](https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/44454006529)
passed 547/547 tests on a 697-blob exact source/test Git subtree mirror.
The **actual merged compiler** was independently rebuilt and run against
all 13 exact portable fixtures in
[merged-compiler carrier run #44454811741](https://github.com/gha-indie-worker/atto-ci/actions/runs/44454811741);
the source Git subtree exactly matched merge commit `57ed0e7`,
16 focused constructor tests and three receipt tests passed, all three
compiled guests returned 42, and all ten negatives emitted no artifact.

This proof is restricted to a **native-hosted Rust compiler generating
Wasm guests**. It is not browser-hosted compiler execution or independent
Java/LLVM/.NET/Forge/Wasm backend verification. General required-field,
struct value-layout, and exceptional cleanup proofs are separate milestones.


## Hardened constructor final-field admission v2

`contracts/constructor-definite-final-admission-v2.json` extends the constructor
v1 contract with nine portable `.atto` source cases: two positive compiled
Wasm guest programs using multiple deferred `final` fields and a preinitialized
field, plus seven negative branch, read-before-write, or missing `val`/`let`/
`const` initializer cases. Source-level missing non-`final` initializers are
rejected by the parser; the Rust checker additionally rejects synthesized
invalid AST fields to avoid silently accepting zero-filled storage.

The exact checked-in fixture Git tree was verified and all cases compiled
with the *merged* Rust compiler in
[private carrier run #44458895446](https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/44458895446).
The 20 focused Rust tests and two initial conformance integrity tests passed;
two guests returned 42 and seven negative programs emitted no Wasm.
The corresponding
[full exact-tree run #44458275142](https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/44458275142)
passed 577 Rust tests on 703 matching source/test Git blobs, including a
checker test bypassing the parser.

These results verify the **native-hosted Rust compiler emitting Wasm**. They
do not prove a wasm32-hosted compiler, independent Java/LLVM/.NET/Forge/Wasm
backends, or general exception-cleanup and struct-construction safety.

## Rust-only read-only conformance case and capability planner (draft PR #21)

The standalone `bin/plan-capabilities.rs` replaces the unmerged Node-based AOT planning prototype on this PR, while preserving its seven-profile/six-case source-only inventory. `--aot-contract contracts/aot-gc-tenant-evidence-v1.json` emits 42 NOT_EXECUTED entries, verifying the exact canonical contract Git blob. `--inventory tests/fixtures/capability-inventory-v1.tsv` emits the complete 11-backend/10-feature inventory (110 NOT_EXECUTED entries); `--backend llvm` narrows either output without changing evidence status.

The checked-in TSV is a [pinned draft snapshot](docs/capability-inventory-provenance.md) of `atto-target-profiles` PR #3, not a second normative schema. `rustc --edition=2021 --test bin/plan-capabilities.rs` runs Rust-only adversarial checks. New planner CI verifies exact Git source hashes and runs both CLIs, but **never executes a compiled .atto guest** and never yields an authenticated PASSED result. Existing legacy receipt verifiers remain untouched and are not replaced by this planning tool.

## Legacy provenance and transfer verification

The archived predecessor is `ores-truffle-oreslang/oreslang-platform-conformance`; the current repository is `atto-lang/atto-platform-conformance`. These are distinct repository identities, not evidence of an original-ID transfer or equivalent implementation. Preserve working legacy `.ores` fixtures and historical package/CLI aliases until separately verified replacements exist. Cross-backend guest fixtures, negative-case manifests and executed parity receipts belong here; compiler feature implementation belongs in the backend repositories.

[atto-lang](https://github.com/atto-lang) owns language, runtime and parity tooling; [atto-co](https://github.com/atto-co) separately governs managed infrastructure, deployment, tenancy and billing. Any future original-ID transfer or commercial carve-out requires separate owner authorization and independent security review. Inventory exact SHA/tree, numeric ID, visibility, access, rulesets, PRs, releases, packages, submodules, consumers, runners, secrets, applications, webhooks, Pages and rollback ownership; verify preservation and rerun exact-head tests after an authorized transfer. Never mirror private source without authorization. Zero-step jobs are NOT_EXECUTED; host-only and source-only checks do not establish compiled guest execution or target certification.

## Pull/push collections (target-only candidate)

The [pull/push admission v1 manifest](contracts/pull-push-admission-v1.json) defines 20 candidate checks
covering lazy iterators, reactive demand, bounded channels, failed-send ownership,
cancellation, actor generations, and compiler/allocator safety. Its [Node model integrity
tests](tests/pull-push-admission.test.mjs) intentionally **reject all unattended PASS
claims**. They are **not** guest tests, source implementation, or five-backend parity.
The normative [language amendment](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/35)
and [source-free model](https://github.com/atto-lang/atto-rx-channels/pull/3) track semantics.

## Result/Option payload-discard contract (draft)

- [Versioned six-fixture matrix](contracts/adt-payload-discard-v1.json) with [verification notes](docs/adt-payload-discard-v1.md) tracks `Ok()`, `Err()`, `Ok(_)`, `Err(_)` and guarded binders; only the scoped Rust/Wasm compiled guest suite has PASS evidence. Java, LLVM, .NET and Forge are NOT_EXECUTED.
