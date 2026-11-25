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

## Typed std.pattern fragment targets (NOT EXECUTED)

[Typed pattern-fragments v1 registry](contracts/typed-pattern-fragments-v1.json) records 38 prospective cases (16 semantic matches, 22 rejection targets). Every listed backend is NOT_EXECUTED; [Node integrity tests](tests/typed-pattern-fragments-v1-registry.test.mjs) check provenance and case structure only. The canonical proposal is on [atto-spec #59](https://github.com/atto-lang/atto-spec/pull/59). This is not stdlib implementation, compiler parsing, formatter equivalence or compiled guest execution.

The registry also pins **14 exact `.atto` guest source blobs**: two 60-result equivalence fixtures, six additional native-rest successes (0/30/7/1/3/32), one checked-overflow panic (code 1), and five compiler-reject cases. Seven new native-rest files are byte-identical to [Rust #415](https://github.com/atto-lang/atto-source.rs/pull/415) source fixtures. Rust's restricted List<int> guest compiler path is a **candidate only**; its current-head Actions ran zero steps. All backend guest statuses remain **NOT_EXECUTED** and host-only integrity checks do not establish compilation or semantic parity.

The independent [Forge compiler candidate #43](https://github.com/atto-lang/atto-source.forge/pull/43) now carries **8/8 byte-identical Rust guest `.atto` fixtures**, a restricted real `forge_scalar` source-to-C++ lowering path, and native compile-and-execute tests with ASan/UBSan gates. Neither that candidate nor Rust has a current-head executing CI receipt; **Forge and all other backend roles remain NOT_EXECUTED**, not PASS. Forge's native checked-overflow exit 70 must be normalized against Rust/Wasm's panic code 1 at the semantic contract layer; never conflate their platform ABIs.


### Independent executable Rust/Wasm + Forge native parity gate (NOT EXECUTED)

The versioned `tests/typed-patterns-cross-backend-guests.mjs` is an **actual compiler-generated guest runner**, not the host-only manifest integrity validator or the typed-fragment reference implementation. It selects exactly the eight shared `list-pattern-*.atto` sources (seven positive and one checked-overflow), verifies each pinned Git blob SHA, and requires a clean source checkout with an independently supplied **exact compiler Git tree SHA**. It then invokes the selected compiler using non-shell subprocess arguments and demands the compiled artifact execute successfully.

Rust/Wasm: `attoc` emits Wasm, which must validate, import no host matcher, have guest-owned memory and produce the exact exported `main` result (or checked overflow `panic_code=1`). Forge: `forge_scalar` must emit a C++20 native guest with real list storage, a native C++ compiler must build it, and the binary must print the exact result or exit 70 with `E_OVERFLOW`. These two **target-specific overflow ABIs are normalized only to the shared semantic error**; do not claim the process exit code is a Wasm panic code.

Run from this conformance checkout with the production compiler source present at its exact pinned commit/tree (or an authorized Git-tree-identical private mirror). **The proof runner itself rebuilds the compiler from that pinned tree into a fresh external temporary directory** (Cargo --locked for Rust; CMake for Forge), hashes the new compiler binary, and then compiles/executes the guests. It rejects any ATTOC_RELATIVE/FORGE_RELATIVE prebuilt executable override:

```sh
ATTO_COMPILER_REPO=/absolute/path/to/atto-source.rs \
ATTO_EXPECTED_COMPILER_TREE=<independently-verified-40-character-git-tree-SHA> \
node tests/typed-patterns-cross-backend-guests.mjs rust-wasm

ATTO_COMPILER_REPO=/absolute/path/to/atto-source.forge \
ATTO_EXPECTED_COMPILER_TREE=<independently-verified-40-character-git-tree-SHA> \
node tests/typed-patterns-cross-backend-guests.mjs forge-native
```

The runner produces a machine-readable receipt **only after all eight compiled guests truly execute**. It will reject a missing or failed fresh compiler build, a prebuilt-compiler override, an unpinned or dirty compiler tree, incorrect output, or failed overflow checks. Hashes attest the just-built compiler executable, not merely the source inputs. Java, LLVM, .NET and the other backend roles have not yet supplied a compatible compiler adapter, and must remain `NOT_EXECUTED`. A passing host-only registry integrity test is **not** this execution proof.


## Sequence pattern v2 target registry

[Sequence matching v2 registry](contracts/sequence-pattern-v2-registry.json) pins 40 proposed positive/negative semantics (20 match and 20 parse-reject targets). Every backend result is explicitly **NOT_EXECUTED** until an independent compiler executes its source-derived guest fixture; [the registry integrity suite](tests/sequence-pattern-v2-registry.test.mjs) is host-only and cannot certify parity. Contract [atto-spec #59](https://github.com/atto-lang/atto-spec/pull/59); compiler tracking [atto-source.rs #123](https://github.com/atto-lang/atto-source.rs/issues/123).

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


- [Actor inline/attached state v1](contracts/actor-attached-state-v1.json): exact Counter source variants, 13 portable positive/negative `.atto` fixtures, lifecycle and guard obligations across 11 compiler repositories. **TARGET_NOT_EXECUTED** until real guest/compiler evidence; source-only Node checks are not parity.

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

## Source-free actor fault-claim admission (draft contract)

[Actor fault claim admission v1](docs/ACTOR_FAULT_CLAIM_V1.md) rejects inconsistent actor/tenant containment assertions for native segfaults, host OOM, process termination and VM corruption. It always reports `certified:false` and `releaseReady:false`: model-only checks never prove an executing guest or fault isolation.

## JVM/.NET host import contract (source-only)

The [host-interop-v0 contract](contracts/host-interop-v0/README.md) pins six `.atto` source candidates and ten backend-qualified oracles. All remain **NOT_EXECUTED**; the Node tests verify source identity and non-promoting metadata only.

## Slice and spread candidate contract (Rust-only reference checks)

The [33 proposed collection test vectors](contracts/collection-slice-spread-v1.json) and [Rust semantic-model tests](tests/collection_slice_spread_contract.rs) describe checked indexes, half-open/negative-step slices, Unicode scalar positions, spread and ownership errors. The `collection-slice-spread-contract.yml` workflow uses **Rust**, not Python, for these checks. Every vector and backend is marked `NOT_EXECUTED`: reference-model tests are **not** a compiled AttoLang guest and do not prove cross-backend support.

## Collection layout v1 target fixtures

[`contracts/collection-layout-v1/`](contracts/collection-layout-v1/README.md) defines proposed AoS, SoA and AoSoA named-generic Array fixtures. All backend statuses are **NOT_EXECUTED** until exact-source actual guest tests; the dedicated Node test is registry-only and cannot promote support.

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

## Canonical lambda v1 target fixtures

[`fixtures/lambda-v1/manifest.json`](fixtures/lambda-v1/manifest.json) contains five positive and five rejection `.atto` cases for the canonical `|x| -> expression` syntax (typed arguments, captures, shadowing, `|>`, and rejected captures/placeholders). Their SHA-256 bytes are pinned. The **only** currently implemented check is fixture integrity and fail-closed manifest status validation:

```sh
node bin/validate-lambda-v1.mjs
node --test test/lambda-v1-manifest.test.mjs
python3 scripts/run_lambda_v1.py --check-manifest
python3 -m unittest discover -s tests -p 'test_run_lambda_v1.py' -v
```

`npm test` now discovers both the Node fixture tests and a Node wrapper that runs the six Python AOT harness unit tests. To attempt **real** guest execution, invoke `scripts/run_lambda_v1.py` with an exact Git-tree SHA and checkout, a source commit SHA, a concrete `--compile-command` and `--run-command`, and a target native/WASM `--artifact-format` and `--evidence-file`. The runner refuses missing prerequisites, refuses host-script artifacts and records `RUNNER-CANDIDATE-REQUIRES-INDEPENDENT-CI-PROVENANCE`, not parity certification, even if every guest command succeeds.

This produces `FIXTURE_INTEGRITY_ONLY_NOT_GUEST_EXECUTION` — **not** a compiler pass. Actual five-backend certification still requires immutable tree and compiler provenance, strict AOT artifact inspection, execution of each guest, and independent CI-run verification under the existing parity evidence policy.

## Candidate AttoLang / Erlang-OTP strict-AOT parity (not promoted)

See [the candidate contract](contracts/erl-otp-strict-aot-v1.json) and
[the shared language design](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/261).
The manifest currently tracks **20 feature areas, 34 non-promoted oracles**:
12 source-backed compile candidates and 22 illustrative runtime/AOT scenarios.
All are **NOT_EXECUTED** as guest parity evidence. Function-head clause dispatch
is deferred; `eq`, `neq`, and candidate atomic `!eq` use a versioned strict
AttoLang profile without silently breaking existing `.ores` syntax.

Run host-side manifest and receipt inspector tests only:

```sh
node --test test/erl-otp-strict-aot-contract.test.mjs test/erl-otp-strict-aot-receipt.test.mjs
```

`node bin/verify-erl-otp-aot-receipt.mjs /path/to/claim.json` is **not a
verification or promotion gate**, despite its historical filename. It is a
**read-only, fail-closed structural inspector**, and always exits nonzero
because self-reported JSON cannot independently establish source-tree
identity, a runner attempt's actual executed steps, reviewer independence,
compiler and artifact hashes, or compiler-guest execution. `ok=false` and
`verified=false` are intentional even when `structurallyValid=true`.

Compile-negative fixtures must produce no executable, an expected diagnostic,
and no guest execution; positive fixtures require real compiled AOT guest
execution and an artifact digest. Prose-only scenarios are categorically
ineligible for executed-guest receipts until converted into real fixtures and
a real target harness. Do not use the inspector's schema tests as CI parity
proof, and do not silently substitute a host-only or source-only canary.

## Specification / formatter parity tracking

[Specification-derived formatter matrix](contracts/specification-formatter-conformance-v1.json) tracks rule IDs and negative/positive vectors from atto-spec, separately for atto-format and legacy oreslang-format. **No parser, compiled guest or cross-formatter parity has been executed for this new matrix.** [Protocol](docs/specification-formatter-conformance-v1.md).

## Interface/trait receiver conformance target matrix

[Unified `implements` receiver conformance v1](contracts/implements-receiver-conformance-v1.json) carries 29 proposed AttoLang source programs covering actor/class/struct implementation, out-of-line `mtd`, inherited/default methods and fail-closed contracts. [Host-only Node test](tests/implements-receiver-conformance-v1.test.mjs) validates the registry. **The 29 portable registry cases remain NOT_EXECUTED.** A separately scoped [executed Rust native compiler → WebAssembly guest receipt](evidence/implements-rs-native-guest-20261119.json) records 42 SHA-matched compiler-crate files, 15 isolated Rust tests, 63 real compiler tests, one compiled guest returning 42n, and three negative no-artifact compilations on [successful private runner #44453297940](https://github.com/usa-acc/atto-ci/actions/runs/44453297940). This is **not** actor/struct guest ABI verification or cross-backend parity. See [atto-spec contract](https://github.com/atto-lang/atto-spec/blob/feat/implements-receiver-contract-v1-20261118/language/implements-receiver-conformance-v1.md).

**Actor-local executable milestone:** [Scoped SHA-verified Rust native compiler → actor Wasm receipt](evidence/implements-actor-local-rs-native-guest-20261119.json) documents [real private run #44456387901](https://github.com/usa-acc/atto-ci/actions/runs/44456387901): 45 exact compiler-crate blobs, 42 library + 11 actor receiver + 14 contract + 9 abstract trait + 15 isolated Rust tests passed, real `actor_receive` producing `42\n`, and fail-closed negative checks. **Only stateless, same-source immutable actor-local mtd is demonstrated; struct guest ABI, stateful actors, browser-hosted compiler and independent backend parity remain unverified. The 29 portable registry case statuses are unchanged.**
