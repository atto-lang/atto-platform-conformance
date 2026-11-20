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
