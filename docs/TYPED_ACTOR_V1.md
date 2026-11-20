# Typed actor contracts v1 (source-only)

Canonical language proposal: [atto-spec #28](https://github.com/atto-lang/atto-spec/pull/28).

The 15 fixture files and Rust reference model are **SOURCE_ONLY and NOT_EXECUTED**; no actual compiler, actor runtime, or supervisor lifecycle is exercised. Positive and negative expectations are targets, not measured results. The Rust policy oracle validates that a message is allowed by BOTH the sender's `sends` bound and the particular destination's `receives` contract; supervisor CONTROL is a separate authenticated lane.

```sh
rustc --edition=2021 --test tools/typed_actor_v1.rs -o /tmp/typed_actor_tests
/tmp/typed_actor_tests
rustc --edition=2021 tools/typed_actor_v1.rs -o /tmp/typed_actor_oracle
/tmp/typed_actor_oracle
```

This verifier must never be used to promote Java/LLVM/.NET/Wasm/Forge support. Each backend requires independently executed compile-positive, compile-negative and runtime guest traces with exact compiler SHA, toolchain and target, and real CONTROL/mailbox evidence. Existing Java `ActorRef<ActorClass>` must remain compatible until an explicit migration plan is proven.

## Transitive actor DATA send-effect graph hardening (2026-11-19)

The Rust/Wasm and LLVM-repository Rust frontends now contain one
byte-identical `actor_send_effect_graph.rs` (Git blob
`16b475542987066097e4ce66a06e18603d16f796`), wired into their typed
checkers. They distinguish `ActorSendEffect::Never` from `Type::Void`,
reject forged `Payload(void)`, and audit application DATA sends through
actor handlers, methods, transitive helpers and **calls inside actor field
initializers**. Call-graph cycles terminate via a visited set and malformed
typed call indices fail closed. This intentionally does not authorize
supervisor CONTROL or infer effects for omitted clauses.

The module carries 12 Rust unit test cases and exact-head compile-test
workflows were added/updated in the source PRs. **No current-head executable
Rust test PASS has been observed.** Private carrier runs
[zed-pkg-test #44662398968](https://github.com/zed-pkg-test/atto-ci/actions/runs/44662398968),
[scintilla-run #44662568476](https://github.com/scintilla-run/atto-ci/actions/runs/44662568476)
and [honeypot-r-us-test #44662860268](https://github.com/honeypot-r-us-test/atto-ci/actions/runs/44662860268)
all failed before runner steps. The exact Git blob identity is verified,
not the compiler behavior. See
`evidence/typed-actor-effect-closure-20261119.json` for immutable-source
and test-execution status. The native LLVM/C++ actor compiler and real guest
mailbox execution remain **NOT_EXECUTED**.

## Bounded bool mailbox and `sends never` compiler parity (2026-11-19)

`fixtures/typed-actor-bool-v1/actor-bool-never-parity-v1.atto` is
byte-identical (Git blob `a103999dd9b047e24ae79fedd88398374bc10590`)
in `atto-source.rs`, the Rust-hosted `atto-source.llvm/frontend`,
`atto-source.js` and this conformance repository. It declares
`receives bool sends never`, updates one boolean actor field and
produces no outbound application DATA messages. The accompanying
`contracts/typed-actor-bool-v1.tsv` has one positive and three
negative source cases: mismatched receiver, invalid `sends void`
and duplicate outbound clauses. They target the draft canonical codes
`E_ACTOR_RECEIVES`, `E_ACTOR_SEND_CONTRACT` and
`E_ACTOR_CONTRACT`, respectively.

Rust/Wasm and the LLVM-repository **Rust-hosted Wasm frontend** carry
new compiler acceptance tests on their draft branches, but their
current-head CI has not run executable build/test steps; acceptance
remains **NOT_EXECUTED**. This is not native LLVM/C++ execution evidence.

The JS compiler's earlier exact-source
[funded run 44656352488](https://github.com/bait-bikes-test/atto-ci/actions/runs/44656352488)
executed **10/10 tests passing** on Node 22.23.5 and actually ran
generated JavaScript compiled from the byte-pinned `.atto` fixture.
That receipt is pinned to JS source head
`8f94a4667ba6a77ffac9894c99babbc6fea5cc6f`.
Subsequent diagnostic-alignment edits have **not** received a stepful
CI run; the attempted private carriers in three organizations returned
zero-step infrastructure failures. Thus the prior JS receipt proves
only its exact earlier revision, not an automatic current-head PASS.
Evidence and run IDs are pinned in
`evidence/typed-actor-bool-never-parity-20261119.json`.

Run the standalone **source-only identity gate**:

```sh
rustc --edition=2021 --test -D warnings tools/typed_actor_bool_v1.rs -o /tmp/actor_bool_source_tests
/tmp/actor_bool_source_tests
```

This Rust gate verifies the registry and actual fixture blob SHA; it
does **not** compile AttoLang. No Java, native LLVM, .NET, Forge or
full Wasm guest parity claim follows from the generated-JS test.

## Additional string-mailbox guest targets (not executed)

`contracts/typed-actor-string-v1.tsv` pins five additional candidate fixtures
under `fixtures/typed-actor-string-v1/`, separate from the original fifteen
immutable protocol cases. **ACTOR-STRING-01** reproduces the required
`define actor Router receives string sends int as` program with
`router.send("hello")`. Targets **02–05** reject an incorrectly typed
external sender, mismatched `ActorMail<T>` handler, wrong actor outbound
effect, and duplicate `sends` clause. The outbound-effect case assumes
future actor-to-actor message lowering; an earlier unsupported-feature error
is *not* evidence that the target diagnostic passed.

All five registry statuses are `NOT_EXECUTED`. The Rust-only
`tools/typed_actor_string_targets.rs` verifies exact fixture Git blob SHAs,
source-only evidence labels and no unrecorded cases. It **does not** compile
AttoLang or prove that the string message crossed worker memories.

```sh
rustc --edition=2021 --test -D warnings tools/typed_actor_string_targets.rs -o /tmp/atto_actor_string_target_tests
/tmp/atto_actor_string_target_tests
```

Compiler [atto-source.rs #406](https://github.com/atto-lang/atto-source.rs/pull/406)
contains a candidate strict UTF-8 DATA frame codec with a ten-byte header and
64 KiB payload budget, but still rejects `ActorMail<string>` until the
runtime/guest memory bridge exists. A codec unit test or SHA match never
promotes a backend to guest PASS. The required next evidence is an executed
pinned Wasm guest receive, negative compile/no-artifact checks, and cross-memory
lifetime and capability validation.


### Executed host-only string DATA bridge evidence (2026-11-19)

[Carrier run 44653928953](https://github.com/bait-bikes-test/atto-ci/actions/runs/44653928953)
executed nonzero build/test steps on exact Git blob mirrors of
`atto-source.rs#406`: **13/13 Rust codec** tests and **14/14 Node/Wasm
host-memory** tests passed under Rust 1.99.1 and Node 22.23.4. The result is
pinned in `evidence/typed-actor-string-host-boundary-20261119.json`, including
all three blob IDs, source HEAD, carrier HEAD, run/job identifiers and explicit
non-promotion statuses. A handcrafted Wasm stub did execute a received message
pointer, but **no Atto-compiled guest was involved**. Therefore all five
`ACTOR-STRING-*` source fixture statuses remain **NOT_EXECUTED**, and the
bridge requires an independently verified compiler-owned receiver memory
reservation before being enabled for untrusted tenants.

## Canonical source identity and backend admission (v1)

**11 separate source repositories were independently inventoried.** The snapshot
`contracts/atto-source-backend-typed-actor-v1.tsv` pins each repository's
observed `main` SHA and its current architectural role. Every typed-actor
guest-parity status is deliberately `NOT_EXECUTED`. This means *not proven*,
not that no individual feature works. Source revisions must be refreshed
before any later exact-head execution. The Rust gate
`tools/typed_actor_backend_inventory.rs` refuses missing repos, incorrect
SHAs, or a fake `PASSED` status.

The original 15 candidate `.atto` fixtures are independently pinned by
`tools/typed_actor_fixture_identity.rs`. This fail-closed Rust test validates
real Git blob bytes, the checked-out regular-file mode, the stage-zero
Git index identity and one-byte mutation denial. A successful hash or
reference-oracle test establishes **source identity only**.

Backend progress remains capability-specific:
- **Rust/Wasm compiler:** [atto-source.rs #216](https://github.com/atto-lang/atto-source.rs/pull/216) adds bounded typed actor header/receiver checks but does not implement all 15 cases or complete supervisor control routing.
- **JavaScript trusted-host subset:** [atto-source.js #31](https://github.com/atto-lang/atto-source.js/pull/31) proposes an executable `receives int` header matching its *existing* concrete `ActorMail<int>` route. This is not an independent browser Wasm compiler or proof of forged-CONTROL isolation.
- **Wasm adapter:** `atto-source.wasm` integrates the compiler/artifact path rather than supplying an independently equivalent second compiler.
- **Self-hosting, .NET, HDL, realtime and other native backends** retain independent proof obligations and cannot be promoted from another backend's host tests.

To run only the Rust source validation **inside this repository**:

```sh
rustc --edition=2021 --test tools/typed_actor_fixture_identity.rs -o /tmp/atto_actor_fixture_tests
/tmp/atto_actor_fixture_tests
rustc --edition=2021 --test tools/typed_actor_backend_inventory.rs -o /tmp/atto_backend_inventory_tests
/tmp/atto_backend_inventory_tests
rustc --edition=2021 --test tools/typed_actor_v1.rs -o /tmp/atto_actor_oracle_tests
/tmp/atto_actor_oracle_tests
```

**Promotion criteria:** for each actual backend and each supported test
provide exact source commit/root tree SHA, independent compiler artifact
SHA-256, the canonical fixture blob SHA, workflow run/job/attempt with
nonzero executed build/test steps, observed compiler positive/negative
result, native/Wasm **guest execution** as applicable, and authenticated
supervisor CONTROL-vs-DATA evidence for runtime tests. Compiler frontends,
host reference models, generated JavaScript host modules, and zero-step jobs
must be reported independently, not as interchangeable guest parity.


## Implementation integration snapshot — 2026-11-19 (not a pass receipt)

The canonical `receives T sends U` syntax is now being implemented in distinct
**draft** compiler branches. No row in the 15-case fixture registry is
promoted to PASSED by these source changes, and the pinned source-inventory
snapshots above are historical rather than current HEAD evidence.

- [atto-source.rs #406](https://github.com/atto-lang/atto-source.rs/pull/406):
  parser/AST and typed-IR upper-bound checks across statically resolved
  calls; `susp` headers in the restricted non-suspending profile.
  Scalar `ActorMail<int>`/ `ActorMail<bool>` supported by the existing
  backend path; `ActorMail<string>` must fail closed before guest emission.
  Tests added; no independently verified exact-head guest run.
- [atto-source.llvm #46](https://github.com/atto-lang/atto-source.llvm/pull/46):
  same bounded `sends` admission and `susp` header subset in the
  Rust-hosted compiler frontend under the LLVM repository. **This is not
  native C++ LLVM code generation**, verified host execution or AOT parity.
- [atto-source.js #31](https://github.com/atto-lang/atto-source.js/pull/31):
  trusted-host i64 actor subset admits scalar `sends` bounds only because
  accepted handlers have **zero outbound application sends**; no general
  effect inference, string wire, fan-out or guest supervisor runtime.
- Overlap: [atto-source.rs #297](https://github.com/atto-lang/atto-source.rs/pull/297)
  changes the attached receiver grammar; reconcile and retest before merging
  the Rust compiler work.

**Requested string fixture:** `define actor Router receives string sends int as`
with `susp receive(ActorMail<string> mail): void` and
`pub susp fnc main(): int` must ultimately compile and execute a
length-delimited, bounded, ownership-safe UTF-8 cross-worker mailbox.
Current scalar-only browser and JS compiler implementations explicitly
**do not** satisfy that gate. Do not conflate successful `sends` parsing or
a source-only Rust oracle with string DATA delivery.

On the observed draft heads, GitHub Actions failed before providing
usable executed job steps; exact-head positive compile, negative rejection,
guest execution and CONTROL isolation evidence remain NOT_EXECUTED.


## Actor isolation type proof targets (2026-11-19; SOURCE_ONLY)

[atto-spec #27](https://github.com/atto-lang/atto-spec/pull/27) now includes a distinct proposed [actor isolation type contract](https://github.com/atto-lang/atto-spec/blob/proposal/ownership-box-arc-send-suspend-v1-20261115/language/actor-isolation-types-v1.md). The new `contracts/actor-isolation-types-v1.tsv` records **36 unexecuted cases** for actor-local unique moves, deep-frozen sharing, nested `Option/Result` and product fields, runtime capability denial, authenticated `ActorRef` delegation, generation fencing and brokered cross-TenantVM wire copies. Every backend status is `NOT_EXECUTED`.

The companion `tools/actor_isolation_types_v1.rs` is a **source-only**, no-dependency Rust policy oracle and 12 isolated Rust tests. It checks every registry row, rejects incomplete or fraudulent PASS claims, and checks transitive pointer/capability/loan/lease rejection; it does not compile any `.atto` program or implement a production broker. This is intentionally additive to typed `receives/sends` and does not replace Mailman escrow or TenantVM executable conformance.

```sh
rustc --edition=2021 --test -D warnings tools/actor_isolation_types_v1.rs -o /tmp/atto_actor_isolation_model_tests
/tmp/atto_actor_isolation_model_tests
rustc --edition=2021 -D warnings tools/actor_isolation_types_v1.rs -o /tmp/atto_actor_isolation_model
/tmp/atto_actor_isolation_model
```

The existing exact-head typed-actor workflow invokes both commands and explicitly labels the result SOURCE_ONLY. Until it executes nonzero build/test steps on a pinned head, Rust test status is **NOT_EXECUTED**. A separate compiler/backend harness must turn these policy rows into complete positive and negative `.atto` fixtures, type-check no-emission rejection and execute real guest mailbox/recipient traces with independently verified artifact hashes before any backend case becomes PASS.

### Exact two-blob private-carrier Rust execution receipt (2026-11-20 UTC)

Source organization GitHub Actions for this draft failed with `steps=[]`; these are **zero-step admission failures**, not source-code test results. Two private candidate carriers also returned no executable job steps. The **third private carrier** ran: [usa-acc/atto-ci run 44662076919](https://github.com/usa-acc/atto-ci/actions/runs/44662076919), job `136042448898`, pinned carrier commit `afd236dfea732613e1bcc60befba6259ef34bb19` and tree `7714c69d4836b31155b2282eb82cc2dd20697844`.

Its executed checkout and SHA gate verified **only two identical source Git blobs**, Rust `2ed736970b5f7da1d2291b4396f1b2df66e73a59` and TSV `298b4d23e526951394aa7fa7eefb1ecbc423cfe4`, from the conformance branch at export head `f217d0084993ee41565875546487cf03706c2372`. On `rustc 1.100.0`, **12/12 Rust unit tests passed** and the standalone binary validated **36/36 SOURCE_ONLY rows**. Both test and executable steps succeeded. Machine-readable receipt: `evidence/actor-isolation-types-v1-source-only-20261119.json`.

**Strict interpretation:** This is a two-file **reference-model-only** successful CI receipt, not a complete source-tree mirror, required source-org CI, compiled `.atto` evidence, runtime TenantVM confinement, real socket broker check, or one backend's guest parity. All 36 per-backend registry statuses remain `NOT_EXECUTED`. No draft promotion or merge is justified by this limited pass.

## ActorRef/escrow adversarial hardening (source-only)

The original 36-case policy registry now rejects AI-015 and AI-035 with
`E_ACTOR_CAPABILITY_ESCAPE`: a nominal `ActorRef` plus `grant=yes` is not
an authenticated delegation receipt.

`tools/actor_isolation_broker_v1.rs` adds 15 deterministic Rust reference tests
for attenuation, re-delegation refusal, incarnation/placement fencing,
cross-tenant refusal, capacity, two-phase escrow, duplicate IDs, cancellation,
close and restart. `trusted_grant` is a hypothetical model input, NOT a
production authority check. All tests remain SOURCE_ONLY and must not be
promoted to compiled-guest or TenantVM certification without independently
executed evidence.
