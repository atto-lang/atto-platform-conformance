# Tail calls and nonrecursive routines — V1 cross-backend contract

This is a **target contract**, not evidence that any backend currently passes.
The source-only registry test verifies manifest hygiene, not Oreslang compilation or execution.

## Language semantics

- `fnc` and instance/static methods may recurse, including mutual recursion. A call in genuine tail position must complete in bounded stack space independently of recursion depth. Higher-order direct calls and closures must not silently restart nested trampolines.
- `routine` is direct-call-only and **cannot participate in a recursive activation cycle**, even if the recursive call would be in tail position. Reject static cycles at compile time. Any unresolved callback, virtual dispatch or foreign/module edge needs a conservative static rejection or a runtime reentry fence. A routine can make a *nonrecursive terminal call* to a `fnc` or method.
- A tail call is an evaluated `return callee(args)` with no obligations left in the caller. Tail conditional branches and mutual calls qualify when their selected arm is tail-position. `return 1 + callee(args)` does not.
- Left-to-right eager evaluation and evaluated argument values, traps, errors, ownership transitions and task ownership remain unchanged. Tail-call elimination is observationally transparent, not a license to reorder work.

## Hard barriers

Do not erase a caller activation when `defer`, `finally`, a catching handler, outstanding destruction/ownership drops, `critical` ownership, a generator, or an `await`/suspension continuation requires the caller to stay alive. Likewise, do not drop an actor's exclusive turn, actor/isolate authority, cancellation scope or task/trace identity. Lower eligible calls to a terminal transfer only after any legal cleanup is completed.

Compiler/runtime must insert periodic scheduler safepoints in unbounded tail-call chains so cancellation, deadlines, fuel budgets and fairness remain effective. A trampoline is acceptable; implementation is not observable.

## Backend engineering rules

| Backend | Safe first implementation | Do not assume |
| --- | --- | --- |
| Java/Graal | Shared tail-invocation trampoline for direct, indirect, method and lambda calls; poll scheduler periodically. | Host JVM recursive calls are automatically stack-safe. |
| LLVM native | Verified tail-position lowering after ownership/cleanup analysis. Use `musttail` only for exactly compatible ABI and attributes; otherwise self-loop lowering or a trampoline. | `-O2` converts all `call; ret` into a tail jump. |
| Wasm/Wasmtime | Target-feature-gated `return_call`/`return_call_indirect` where available, otherwise explicit trampoline. | Tail-call Wasm proposal is enabled in every runtime/profile. |
| .NET NativeAOT | Verified `tail.` IL where legally supported or an explicit managed/native trampoline. | JIT heuristics apply to AOT or all virtual dispatch. |
| Forge/Cranelift | Proven tail-call ABI lowering or explicit loop/trampoline. | Cranelift automatically provides proper tail calls for every signature. |

The `contracts/tail-calls-v1.json` corpus has nine acceptance/rejection fixtures.
Deep-tail fixtures demand successful 100,000-hop execution with constant/bounded stack,
not merely a successful syntax check. Tests for cleanup/error-path order, async
suspension, cancellation, hot-load generations and actor turn isolation must be
added as each backend wires those features.

## Evidence / merge gate

For each backend and fixture, capture exact fixture/tree/commit hashes, compiler
executable SHA-256 and flags, actual compiler check, actual guest run or required
compile rejection, stdout/diagnostic, resource bound and executed nonempty CI steps.
`steps=null` or `steps=[]` is runner admission failure, not a pass.
If the backend lacks the feature, report **pending/unsupported**; never replace a
native guest run with a host-only source test or another backend's result.

Java draft implementation: https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2446 .
Its static routine call-graph check is partial: dynamic-method/callback reentry
is still a correctness gap, and no exact-head native CI claim is made.
