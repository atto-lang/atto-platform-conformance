# Actor physical termination: Java/GraalVM and LLVM backend matrix

Status: **experimental draft**, October 2026.

## Shared safety contract

`PhysicalDone(actor)` implies no entered actor execution turn, no pending
lexical cleanup, no outstanding actor-owned native loans, no live actor
heap backing allocation, and no callback that can dereference the retired
physical actor incarnation. Successful logical STOP alone is insufficient.

Native-memory quota decrement and FFM Arena.close are distinct transitions
from removing the region from the actor ownership registry. An actor must not
publish successful physical DONE until **all three** have completed.

## What has actually executed

| Capability / evidence | Java/GraalVM | LLVM |
| --- | --- | --- |
| Native heap bounded loans / no premature free | Java 25 FFM host test and AOT/hybrid selftest | Native C11 actor heap test |
| Two completion-thread loans; physical done only after release | Java `ExplicitNativeConcurrentLoanReleaseTest` | `native_actor_physical_done_two_loan_race` (64 iterations) |
| Address / undefined behavior sanitizer for native heap | Not applicable to Java FFM host code | Passed funded C11 ASan/UBSan exact-source test |
| STOP with source-owned lexical cleanup suspension | Executed Java actor tests/AOT/hybrid | **Unsupported** at LLVM guest-source level |
| `get_done()` physical barrier after FFM registry unregister | Java actor implementation + retirement test | Native C heap `try_destroy()` host substrate only |
| `get_shutdown_result()` distinct teardown error observer | Java actor implementation | **Not implemented** |
| Guest `try/catch/finally` and `defer` | Java positive executable source fixture | **Fail-closed compiler gate**, no source parity |
| `self.forward()` / `self.backward()` three-actor typed pipeline | Separate target milestone | Separate target milestone |

The LLVM C API `ores_actor_i64_heap_try_destroy()` frees the pointer on
success. The scheduler/host **must** first fence every loan producer and
callback; concurrent last-loan release and destroy with a live pointer
holder would be a use-after-free. The native C test joins all loan-completion
threads before final destruction, and intentionally does not claim to prove
arbitrary external callback fencing.

## Verified source revisions (do not silently generalize)

- Java source head `cc4a16f`: 404 exact blobs, 1,450 Maven tests with zero
  failures (one skip), full native AOT/hybrid actor probes and guest fixture
  executed successfully in funded run
  [38195885799](https://github.com/zed-pkg-test/java-app/actions/runs/38195885799).
- Java subsequent deterministic fault injection: validation must be
  established independently; previous green head is not proof.
- LLVM native heap source head `ee28e1fe`: 5 exact blobs; C11 and
  ASan/UBSan native-loan gate passed in funded run
  [38197366478](https://github.com/zed-pkg-test/java-app/actions/runs/38197366478).
- TLA+ three bounded safety models and expected mutants: 11 exact
  formal blobs, funded TLC run
  [38196091126](https://github.com/zed-pkg-test/java-app/actions/runs/38196091126).

This table is scoped evidence of what actually executed. No differential
Java/LLVM guest-language refinement proof, full cancellation parity, or
unconditional liveness proof is claimed.
