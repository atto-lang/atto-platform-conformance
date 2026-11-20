# Tenant IsolateVM parity promotion audit — 2026-11-01

**Historical snapshot:** superseded by tenant-isolation-v2 on 2026-11-03.
The current contract uses one VM-isolate per tenant in a shared OS process;
the per-tenant process requirements below are historical, not current policy.

**Evidence classification: DRAFT / NOT EXECUTED in source-org Actions.** This
snapshot is a tracking aid, not a certificate of backend conformance, hostile
tenant sandboxing or hard-real-time scheduling. Do not infer success from
source-only tests or an Actions run that failed before a runner was assigned.

## Five requested toolchains

| Backend | Audited implementation boundary | Current proof and next native gate |
|---|---|---|
| Java/GraalVM | `oreslang-source.java` `IsolatePolicy` configures Graal UNTRUSTED sandbox, host permission denial and isolated contexts. Separate tenant incarnation identity, actual guest execution and complete resource retirement are not proven by this Java policy alone | Exact-head JDK 25 guest actor + tenant reincarnation, concurrent CONTROL/STOP, production Graal AOT and sandbox evidence required. [Private runner admission #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963) remains blocked |
| LLVM | [PR #1244](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1244) has generation-fenced host tenant arenas, secure zeroization, physical turn pins, global close and a native C/C++ callback fixture staged in CTest | Host tests previously ran locally, but the new `NativeOresVM` callback fixture has **no executed exact-head receipt**. [Actions run 41328735982](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/41328735982) had zero steps. Next: stepful compiler/linker/test, then compiled `.ores` guest actor state + supervisor CONTROL, arena retirement and ASan/UBSan |
| Wasm | [PR #173](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/173) has distinct Rust/Wasmtime `Store` and `Instance` per native tenant, still native-AOT draft. [PR #231](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/231) expands disposable **Node Worker** concurrency/zero-memory and quota/termination tests (distinct backend mechanism) | Require native Wasmtime AOT exact-head Cargo smoke, isolated mutable guest state, denial of untrusted artifact self-approval, memory/fuel/trap quotas, then real source actor lowering. Security [PR #214](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/214) must resolve vulnerable lockfiles and execute native checks before deployment. [Worker Actions run 41334136266](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/actions/runs/41334136266) had zero steps |
| Cranelift | A **separate** Rust native JIT repository, not Forge. [PR #25](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/25) rejects surplus CLI args before source/JIT admission and tests actor/async/ownership rejection | Stage-0 supports scalar source only. Actor, tenant, supervisor, ownership and sandbox are **not implemented**. Passing negative tests is fail-closed behavior, not positive parity. [Actions run 41333743321](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/actions/runs/41333743321) had zero steps |
| .NET Native AOT | [PR #243](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/243) implements a host-only generation-fenced `OresVmHost`, actor mailboxes, reference pins and scalar turn gate. Added dot-only tenant ID refusal to align with Wasmtime; still not a separate CLR heap | Run `dotnet` tests on pinned SDK and both Linux and Windows published Native AOT binaries, prove guest actor byte-copy lifetime and supervisor retirement; process sandbox still unavailable. [Native AOT run 41334265948](https://github.com/ores-truffle-oreslang/oreslang-source.net/actions/runs/41334265948) had zero steps |

Forge is independently maintained; it is not an alias for Cranelift.
Source-free conformance reference `contracts/tenant-isolation-v1.json` lists
both backends separately and explicitly rejects hostile-tenant sandbox claims.

## Promotion gates (ALL required, in order)

1. **Admit a runner without exporting private source.** Organization owner
   determines the literal billing/eligibility/private workflow or runner-group
   admission failure. GitHub job `steps=[]`, null runner and missing logs mean
   **NOT_EXECUTED**, never a red guest result. No unapproved cross-org mirroring
   while [security incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
   remains under review.
2. **Pin source identity and observable execution.** Per backend record exact
   head commit, Git tree SHA, native test binary/compiled guest identity,
   nonzero executed steps, successful compiler/linker/test exit, and test
   artifact digest. A hand-written boolean claiming `passed` is not evidence.
3. **Prove source guest behavior, not only a host model.** Execute compiled
   `.ores` actor source where implemented; unsupported Cranelift actor source
   must fail before emitting JIT code. Preserve distinct Node Worker vs native
   Wasmtime Store vs GraalVM vs C++ OresVM vs CLR runtime semantics.
4. **Exercise tenant lifetime and hostile boundaries.** Cross-root numerical
   identity collisions, stale generations, foreign actor/loan handles, bounded
   mailbox + CONTROL priority, trap quarantine, shutdown while active,
   physical retirement before reuse, complete private memory scrub, no
   implicit filesystem/network/native/host capabilities, no sandbox downgrade.
5. **Cross-backend differential promotion only on overlapping compiled
   features.** A backend with scalar-only execution does not pass actor or
   IsolateVM parity because its negative tests reject unsupported syntax.
   Require exact input bytes, equivalent diagnostics/value outcomes and
   recorded versioned test receipts from ALL requested backends. For native
   hard RT add independently certified target OS/hardware, preallocation,
   linked image no tracing collector/code generation and actual WCET evidence.

## Current evidence status

There are **no five-backend compiled actor-IsolateVM parity passes** in this
audit. New draft PR changes and local/host model checks preserve useful
development evidence, but they do not lift the cross-backend release gate.
