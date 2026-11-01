# Supervisor nominal type and composition gate (v1)

Status: **review contract + negative admission tests only**. It does not assert guest runtime execution.

## Canonical declaration

```ores
define supervisor S1 as
  on_panic(f: Failure): void {
    self.stop(f);
    return;
  }
end
```

A supervisor is a **distinct compiler-minted nominal authority**. Its implicit runtime base is `Supervisor`, but it is **not** an `Actor`, an arbitrary `Class`, or an ordinary `Trait`. Supervisor IDs, live child references, CONTROL admission and lifecycle effects cannot be constructed through ordinary user-defined field/method composition. It receives terminal `Failure` after the child physically finalizes, on its *own* reserved, single-flight CONTROL lane. A child panic bypasses actor-local hooks, and a supervisor's own terminal panic escalates to its parent/root fail-closed policy.

## Superclass / interface / trait policy

| Clause | Initial v1 admission | Future semantics, only after compiler validation |
| --- | --- | --- |
| Implicit built-in `Supervisor` base | Nominal only | Runtime-owned, no guest constructor or forged handle |
| `extends Actor`, `extends Class`, `extends Supervisor` | **Reject** | No ordinary supervisor subclassing; compose policies explicitly |
| `implements`, `impl`, `conforms`, `is` | **Reject** | Permit interface contracts only when every member is capability-free, stateless and signature-checked |
| `with Trait`, stateful trait inheritance | **Reject** | Permit only reviewed stateless supervisor policy traits with no fields, actor mailbox hooks or implicit CONTROL access |
| Generic/abstract/static/structural hooks | **Reject** | Must not alter CONTROL dispatch identity or receiver ABI |
| `on_throw`, `on_raise` | **Reject** | Actor-local effects are not supervisor terminal CONTROL hooks |
| `on_panic(f: Failure)` | Parser accepts immutable nominal binder on Java draft | Compiler-owned CONTROL lowering mandatory for execution |
| `on_start`, `tear_down` | Parser-only when supported | Explicit runtime-owned lifecycle ordering/finalization required |

Trait and interface methods cannot grant `ActorRef`/supervisor identity, mutate child lineage, spoof `Failure`, or synthesize CONTROL messages. Value/receipt DTOs may independently satisfy `Sendable`/`Serializable`; the live supervisor authority itself must not become wire-serializable. Only explicitly granted host observers may obtain safe snapshots.

## Five-toolchain gate

* **Java/Graal:** typed AST/parser and restricted, opt-in host-owned STOP are draft work. General compiler must still reject until complete guest CONTROL execution and effect checking.
* **LLVM:** native host supervision/actor components are distinct from compiled source supervisor execution. Explicit rejection before IR.
* **WASM:** scalar Wasm LLVM-compiler bridge rejects before native compiler execution/artifact staging; no guest CONTROL ABI.
* **Cranelift:** independent scalar JIT rejects before CLIF; no actor/supervisor runtime.
* **.NET NativeAOT:** structured compiler rejects before CFG/CIL; no guest CONTROL.
  
Cross-backend parity means identical **semantic dispositions**, not pretending that five different host mechanisms execute one source declaration. Passes require exact SHA, real compiler/source execution, failure-origin and generation identity, bounded priority CONTROL, physical finalization, await/restart effect commit and independent review. The adjacent `type-boundaries.json` is a static inventory only; `node --test` proves the inventory cannot silently declare unsupported backends conformant, but does not run any toolchain.

Stacked Java #2423, LLVM #1279, WASM #248, Cranelift #60, .NET #311. Independent source execution requires the existing supervision contract PR #13 to progress through its runtime gates.


## Executed private exact-source verification — 2026-11-01

Funded private runner: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41355153627

The runner used a temporary private, token-free test tree and verified *Git blob SHA equality* between each compiler source/test file and the reviewed source branch before execution. These are **real source-admission tests**, not fake/mock compiler checks, but intentionally narrow:

| Backend | Actually built/executed | What remains unproven |
| --- | --- | --- |
| Java | JDK 25 compiler compiled production `Parser`, `Lexer`, `Token`, `Ast`; executed 3 positive + 16 negative supervisor declaration cases | Full `OresCompiler`/JUnit/Maven, general guest CONTROL, full runtime/native-image (only the parser AOT is verified) |
| LLVM | Real C++ production parser, `MethodResolver`, `NativeScalarTypes`, `OwnershipChecker`, and focused parser test built against LLVM Support under `-Wall -Wextra -Wpedantic -Werror`; executable succeeded | LLVM IR supervisor lowering, actor runtime CONTROL execution and ASan/UBSan |
| WASM | Exact JS source lexer/admission tests and source-fixture registry mutation checks through Node 22 | Actual Wasm supervisor guest ABI, CONTROL and compiled actor runtime |
| Cranelift | Rust 1.99.1 `cargo test --locked` (12 passed), `cargo fmt --check`; actual JIT/scalar CLI and explicit supervisor rejection | Compiled guest actor/supervisor runtime, typed `Failure`, CONTROL |
| .NET | .NET 10 production `OresParser` source compiled and executed, 9 negative + 4 positive controls, then built **NativeAOT** and executed same harness | Full structured compiler source tests, guest CONTROL and supervisor lifecycle |

Separate initial private source-policy test: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41354010324

No verdict of `guestSourceParity: true` is permitted by these focused tests. The general `define supervisor` declaration remains a fail-closed, source-level feature gate across backends until the authenticated, generation-fenced guest CONTROL lifecycle is implemented and exercised.

The native LLVM parser also required correcting a preexisting misleadingly indented conditional under strict `-Werror` in the native source PR. The Cranelift CLI test was formatted to pass the full Rust formatting gate. Independent GraalVM native-image proof: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41355316086 — **PASS**. Oracle GraalVM JDK 25 compiled and executed the exact production Java parser fixture harness (3 accepted / 16 rejected), produced a `--no-fallback` native image, and executed that binary with identical results. This is verified Graal **parser AOT** execution, not guest supervisor CONTROL or full-runtime AOT parity.


## Second-pass hardening and executable proof

- **Java STOP-only compatibility:** `suspends` is denied for supervisor hooks; asynchronous `on_start` and `tear_down` are denied. However, the existing *restricted* opt-in `async on_panic(f: Failure)` + exact `await self.stop(f)` decision **must remain admitted** by the Java parser because `SourceSupervisorLowering` validates and lowers that host-acknowledged STOP continuation. The normal OresCompiler still rejects general source supervisors. Do not globally ban `async` on `on_panic`: that would regress the Java host STOP-only path.
- **WASM:** 1 MiB byte budget before decoding; reject embedded NUL to prevent bridge truncation differences. New real `compileOresToWasm` integration test supplies a sentinel executable and confirms no invocation, `.wasm` artifact or provenance output for nominal supervisor declarations. Actual private runner: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41357004324 — **PASS**.
- **LLVM:** additional `clang++ -fsanitize=address,undefined -fno-omit-frame-pointer` build and execution of the exact production native parser/source admission tests, verifying all mirrored blob identities first. Runner: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41357142904 — **PASS** with all six jobs successful.
- **Cross-backend scope:** Java/GraalVM, LLVM, WASM, Cranelift and .NET have executed focused source admission gates; **full compiled guest supervision still has zero certified five-backend runtime equivalence**. STOP-only Java host bridging is not a substitute for general guest CONTROL, restart/escalation, physical-finalization ordering and generation fencing.


### Revised source-head verification

Private exact-blob six-job run: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41357369470 — **PASS**. The updated Java parser's executable harness reported `JAVA_SUPERVISOR_PARSER=PASS accepts=4 rejects=26`; the allowed fourth case is the restricted `async on_panic(f: Failure)` with `await self.stop(f)`. Native LLVM compiler admission + ASan/UBSan, Cranelift Rust 1.99.1 JIT tests + rustfmt, WASM source/real-bridge denial, shared contract mutation checks, and .NET 10 managed/NativeAOT scalar tests all passed at this mirror commit. Every imported file's Git blob SHA was checked in CI. The Java full `SourceSupervisorLowering` and runtime/JUnit suite **were not executed** by this focused runner.

The revised Java parser's separate **Oracle GraalVM JDK 25 native-image check passed**: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41357369454 . The actual source-hash-verified parser fixture ran on GraalVM Java and again as a `--no-fallback` native binary, both reporting `JAVA_SUPERVISOR_PARSER=PASS accepts=4 rejects=26`. This proves AOT *parser* execution, not full guest supervisor CONTROL execution.


## STOP-only executable host and compiler milestones (2026-11-01)

See `fixtures/supervision/v1/stop-only-runtime-gate.json` and its closed-world mutation validator. The contract keeps **focused host CONTROL execution**, **restricted source STOP lowering**, and **full guest supervisor runtime parity** in separate explicit fields.

| Backend | Actual focused host STOP proof | Restricted source STOP compilation | General guest supervisor |
| --- | --- | --- | --- |
| Java/GraalVM | **Yes**: production `SupervisorProcess` + `SupervisorFailureControl` + `SupervisorChildRegistry` + `SupervisorDispatchGuard` tested at https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41358923195 | **Yes**: real `Parser` + `Ast` + `SourceSupervisorLowering` compiled, 3 accepted / 10 denied at https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41359448732 | **No** |
| LLVM | **Yes**: production native `SupervisorControlTurn` STOP receipt acknowledgment, uncertain-effect quarantine, exact incarnation reconciliation under Clang ASan/UBSan and GCC `-O2` at https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41359210787 | **No**: front-end intentionally rejects `define supervisor` | **No** |
| WASM | No host STOP proof; compiler-bridge safety rejection only | No | No |
| Cranelift | No host STOP proof; source/IR admission only | No | No |
| .NET | No host STOP proof; scalar source rejection/NativeAOT only | No | No |

**Limits of the focused Java execution:** The funded runner compiles production CONTROL classes and the production Java source-lowering/compiler classes, with exact Git blob identity checks. An **explicit test-only runtime-ID/ActorGroup shape shim** stands in for the full `ActorRuntime` dependency graph; the shim has no actor scheduling or lifecycle implementation. As a result this is **not** evidence of physical child finalization, full `SourceSupervisorAwaitStopTest`, a complete Maven test suite, or guest-to-actor integration.

**Limits of the native LLVM STOP primitive:** Native `Decision::Stop` now has a synchronous host `StopReceipt::Acknowledged/Uncertain` boundary. A rejected/throwing effect holds the actor generation in-flight and blocks later turns until a trusted exact-key `confirm_stopped` call. That is a meaningful host safety primitive, but **not** the Java-style asynchronous host acknowledgment yet and **not** compiler-lowered guest source. Native callers must not expose `confirm_stopped` as an unauthenticated guest capability.

**Next semantic gates:** Run Java's existing full actor-supervisor runtime/JUnit tests with physical finalization; integrate the native STOP decision with a generation-fenced actor group and a real compiled `on_panic(Failure)`; then implement equivalent STOP guest execution in WASM workers, Cranelift and .NET NativeAOT. Only advance the machine-readable `guestSourceParity` gates with real guest-execution logs from each backend.


**Supplemental Java STOP ledger proof:** the verified production `SupervisorChildRegistry` now also has an executable generation/receipt test in `SupervisorStopOnlyControlProof` (four total scenarios). It checks that STOP cannot start before asserted finalization, a STOPPING child cannot restart, invocation cannot be claimed twice, an uncertain host effect remains quarantined, a forged turn/nonce fails reconciliation, and only an exact reserved generation can reach an acknowledged STOPPED state. It uses the same explicit runtime-ID-only shim; **it does not itself prove the external physical finalization barrier**. Exact-source JDK 25 result: https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/41359927149 — `JAVA_SUPERVISOR_CONTROL=PASS cases=4`, `JAVA_SUPERVISOR_SOURCE_COMPILER=PASS accepted=3 rejected=10`.
