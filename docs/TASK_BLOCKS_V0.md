# Task block cross-backend contract (draft v0)

**Status:** executable Task lowering is not implemented or confirmed on any backend. Fixtures describe proposed source behavior and are **not runtime passes**. Java/GraalVM has initial AST/parser admission in a separate draft; its type checker rejects execution. LLVM must reject both forms without LLVM IR until an ownership- and scheduler-safe implementation exists.

| Form | Result | Contract |
| --- | --- | --- |
| `do nb { ... }` | no value/handle | schedules a child Task and continues, but errors still supervised |
| `let Task<T> t = nb { ... };` | `Task<T>` | child Task computes a value; `await t` waits and yields `T` |
| `let Task<void> t = nb { ... };` | `Task<void>` | `await t` is a completion barrier |
| bare `nb { ... }` statement | forbidden | use `do nb` to discard handle explicitly |

`await` inside `nb` suspends only the new Task, not its caller. Tasks are lightweight scheduler computations (not actors, no mailbox, no implicit actor-state rights) and may migrate across worker threads under M:N scheduling. Actual carrier implementation is an implementation detail.

Captures must satisfy `rt take`/`rt copy`/`rt share` with no escaping mutable or stack borrows, no actor-owned mutable state leakage, and no trust-domain crossing. Return exits only the Task. Every Task is owned by an actor or structured scope, subject to cancellation, backpressure, defer/finally completion, failure supervision, hot-reload fences, and shutdown. Even `do nb` must not silently swallow unhandled errors.

Compatibility: preserve `nb select`, `do nb select`, `nb readch`, `nb writech`, and separate experimental `nb cpu/gpu` semantics. Do not replace Future<T> in existing source APIs.

Release gates: exact-head parser/type/ownership/formatter testing, Java execution on GraalVM, LLVM continuation lowering and execution, cancellation and tear-down races, move-only result rules, bounded scheduling and no dropped errors. The fixtures intentionally do not certify backend parity.


## Self-invoking Task lambda contract (added audit)

The canonical argument-bearing Task launch is `let Task<T> task = (|A a, B b| -> nb { ... })(aValue, bValue);` without an `async` modifier and without an outer `await`. The pipe lambda is a normal synchronous callable; its result is exactly the one Task handle created by `nb`. A braced lambda must use `return nb { ... };` explicitly. `await (|...| -> nb { ... })(args)` is legal by design but *joins* that Task and produces `T`, not `Future<T>`.

If a Future is desired for an existing API, the proposed explicit guest method is `task.asFuture()`: one observer projection of the same completion, not an extra Task or `Future<Task<T>>`. A matching host method is present in Java runtime draft #1379, **but guest language typing/execution is still pending**.

Do not implicitly flatten `Future<Task<T>>`. The Java parser now accepts a distinct `async |...|` lambda AST (return contract `Future<R>`) and `async task |...|` Task-lambda AST (return contract `Task<R>`); **both remain rejected at type-check time** until owned continuation lowering exists. Lambda arguments captured by the child Task cannot escape through borrowed stack addresses; `rt take`, `rt copy`, and authorized `rt share` require ownership proof at spawn before the ephemeral lambda frame exits.

New v0 fixtures exercise immediate arrow invocation, the explicit-return block variant, an immediately awaited call, explicit Future projection, and explicit async Future/Task nesting. These are syntax and contract checks, **not a claim that Java or LLVM executes Tasks**.

## Async Task lambda matrix (October 18, 2026)

```oreslang
// Exactly one Task<int>, body executes on its Task scheduler.
let Task<int> job = (async task |int a, string b| -> {
    return a;
})(5, "xyz");

// Equivalent expression-bodied Task lambda.
let Task<int> job2 = (async task |int a, string b| -> a)(5, "xyz");

// Wait for the Task itself.
let int answer = await (async task |int a, string b| -> {
    return a;
})(5, "xyz");

// Different: outer async lambda produces Future<Task<int>>.
let Task<int> nested = await (async |int a, string b| -> nb {
    return a;
})(5, "xyz");
let int answer2 = await nested;
```

There is no implicit type flattening or extra scheduling tier for `async task`. The parser keeps both effects separate and rejects malformed prefixes. `task` is contextual only immediately following `async`, so other identifier uses are not globally reserved.

This is **frontend syntax admission plus proposed contracts**, not executable backend parity. Lambda arguments and nonlocal captures must be moved/copied/shared with explicit actor/tenant-safe authority before the Task begins. `Task<T>.asFuture()` currently projects the *same cancelable host runtime Future* (Java #1379); this is not a read-only subscription and must not leak cancellation authority to untrusted callers.

Additional regression targets: type inference for `Future<Task<T>>`, lexical returns and `finally` rejection, nested suspend ownership, cancellation of a never-joined task, move-only result consumption, hot-reload invalidation, and LLVM-native scheduling.
