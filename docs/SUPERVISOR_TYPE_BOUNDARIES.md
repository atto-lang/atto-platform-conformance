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
