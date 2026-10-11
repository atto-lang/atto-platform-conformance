# Cross-backend source cancellation gate (2026-10-11)

**Release state: BLOCKED.** This is a conformance contract, not a claim
that either backend fully implements general guest cancellation or `recover`.

## Required guest-visible semantics

- Cancellation is scheduler-issued control flow and must bypass ordinary
  `catch` handlers even if an inner `finally` raises a replacement failure.
- `defer` and `finally` execute at most once in lexical/LIFO order, on the
  owning actor or root scheduler lane, even when a cleanup Future suspends.
- A failing cleanup is the terminal failure while retaining the previous
  cancellation/error as suppressed evidence. The failure cannot be silently
  relabeled as a successful cancellation.
- Stale producer completions and generation changes cannot resume abandoned
  source code or inject a value into an unrelated cleanup await.
- Guest resource ownership (guards, borrows, native loans, channels and
  actor messages) cannot be released/refunded until physical quiescence.
- A shutdown deadline with unresolved source cleanup must return an explicit
  failed-drain outcome; `get_done()`/context close may not claim a clean
  release.

A future general `recover` language keyword may handle specified ordinary
panics or exceptions but **must not catch or clear scheduler cancellation**.
As of this contract, Java source parsing implements no general `recover`
keyword: the existing `SharedMutex.recover(callback)` has separate semantics.

## Backend evidence matrix

| Gate | Java/GraalVM source | LLVM source |
| --- | --- | --- |
| Nested guest `defer`/`finally` cancellation, no unrelated catch | Executed JVM guest regression | Not implemented |
| Awaited cleanup Future fails; cancellation retained as suppressed | Executed JVM guest regression | Not implemented |
| Suspended guest `finally` plus context-close deadline | Executed JVM guest regression | Not implemented |
| Real actor source cleanup drain before physical `get_done()` | Blocked | Blocked |
| Borrow/mutex/native loan release during cancel | Blocked | Blocked |
| Cross-backend **identical source file** execution | Pending fixture pinning | Pending |
| GraalVM native-image/AOT or native sanitizer coverage | Pending | Pending |
| Exact synthesized merge-tree certification | Pending | Pending |

Java proof before its documentation-only follow-up:
[exact 397-blob Java CI 38182103471](https://github.com/zed-pkg-test/java-app/actions/runs/38182103471),
1,444 Maven tests with zero failures/errors and one skip. This is JVM guest
execution of **inline source fixtures in Java's
`SourceCancellationExecutionTest`**, not byte-identical source-file
conformance executed by LLVM. The later exact-head CI pin is a separate gate.

## Known actor lifecycle blocker

Java `ActorRuntime.terminateTree()` seals the continuation mailbox and
clears pending-operation tracking before suspended source cleanup has been
proven complete. `finalizeStopLocked()` does not currently fence every
source cleanup obligation. LLVM's host lanes also need end-to-end source
coverage. Both implementations must separate logical stop from a
cleanup-only CONTROL lane and physical done acknowledgement.

No PR should be merged or marked cross-backend cancellation-safe until the
actor/context resource-lifetime, AOT/native, exact-source and merge-tree gates
have completed successfully.
