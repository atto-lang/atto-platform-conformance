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
