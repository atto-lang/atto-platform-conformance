# AttoLang stackless scalar M3 — conformance evidence contract

**Date:** 2026-11-07
**Java implementation:** [PR #2633](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2633), stacked on [#2628](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2628).
**SourceTask companion:** [Java PR #2631](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2631) is separately in progress; do not infer it is integrated or merged with M3.
**Conformance status:** `NOT_EXECUTED` for all five backend guest lanes.

## Proposed exact-head checks

1. **Real compiler admission**: compile and execute canonical `.atto` actor sources from Java PR #2633 using its exact head and tree. Record source blob SHAs, compiler SHA, real output and exit code. Check scalar Fibonacci `21`, mutual TCO over 100,000 calls `1`, local-binding fallback `6`, previous direct-tail output `100000`, and sibling recovery `starting|alive`.
2. **Recursive non-tail fault**: 60 direct nested calls return 1830 with bounded native carrier depth; 100,000 non-tail requests must terminate actor A at the intentional 64-frame quota as a typed guest budget failure, *not* a JVM native stack overflow. Sibling B must respond on the same carrier, and the VM process must remain alive. Require an admitted process-hosted receipt, not a source-free canary.
3. **Single-frame accounting**: every non-tail invocation reserves the existing 32-byte actor frame, with a 16-byte call descriptor and up to two 8-byte integer parameter slots. A correct tail call reuses and rewrites that frame, clears stale parameter values, and never adds an extra 16-byte allocation. Verify high-water usage and final zeroization.
4. **Preflight rejection, no partial side effects**: unsupported `routine`, borrowed state, mutability, annotations, imported generics, async/suspends, defer/try, dynamic methods and non-exhaustive branches remain on the existing guarded evaluator. A whole reachable graph must be rejected before any optimized instruction runs.
5. **Stable continuation identity**: M3's synchronous call-chain frame lease does **not** survive a `SourceTask` await. Verify integration separately with #2631 using independently identified physical-quiescence proofs, generation fences, cancellation zeroization, and no actor mailbox reentrancy. Do not count isolated host scheduler leases as guest state restoration.
6. **Backend parity**: compile equivalent fixture bytes and verify observable results on LLVM, .NET NativeAOT, Wasm, and Forge/Cranelift. No backends may inherit Java's host-only evidence.

## Promotion prohibited without executed evidence

`steps=[]`, `steps=null`, `runner_id=0` are **runner admission failure**, not executed test failures. Separate preflight, parser/typecheck, host Java/JUnit, source-free policy, compiler-backed guest, native process containment and five-backend replay receipts. Include workflow ID/attempt/job/step counts, exact source head and Git tree, artifact hashes, normal output, failure reason, cleanup and supervisor CONTROL receipts.

The M3 optimization is **not** a general stackless JVM interpreter: only closed pure integer `fnc` graphs use iterative execution. Operand stacks and return PCs are still bounded host heap objects; only two primitive parameters and call descriptors reside in the actor-owned arena. General guest expression recursion, typed local spills, asynchronous continuations, FFI/JIT and native callbacks remain unproven.

**Do not mark physical actor-stack isolation, process survival, or parity as PASS** until end-to-end compiled `.atto` receipts and low-native-stack tests exist.
