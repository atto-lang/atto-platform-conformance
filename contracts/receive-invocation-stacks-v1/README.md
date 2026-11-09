# Receive-Invocation Stack Contract v1

**Status: DRAFT / SOURCE_FREE_MODEL_ONLY / NOT_EXECUTED for every backend.** This adds the actor receive/task stack identity contract in [AttoLang specification PR #26](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/26). It does **not** turn existing host-only frame tests into compiled guest proofs.

## Invariants
1. Each admitted live `receive()` invocation is allocated a distinct logical stack identity, owned by actor ID and incarnation/generation. Nested calls form LIFO frames on that stack.
2. Every independently scheduled Task has a separate logical stack even when spawned by an actor, scheduled on the same carrier, or running alongside a suspended parent.
3. Default `messageConcurrency=1` counts suspended receive invocations; subsequent DATA cannot overtake awaiting A. Opt-in capacity N admits N independent receive stacks, subject to sealed-state and critical section proof.
4. `await` retains owned frame locals, PC, stack accounting and one-shot generation-fenced wake authority even if the carrier changes. Carrier equality is not access authority.
5. Bounded frame count, per-invocation bytes and aggregate actor stack bytes must be enforced. Suspended invocations and child tasks remain charged. Exhaustion terminally poisons the actor incarnation; catching a quota error cannot resume guest dispatch.
6. Cancellation is not physical retirement. A stack and its parent borrow roots remain live until frames, child tasks, outstanding loans and cleanup have retired; stale tickets and old generation resumes fail closed. The model covers child completion ordering, **not** a sound borrow checker.
7. A fail-stop logical stack should leave unrelated actor B runnable. This is not proof of host-native stack-overflow, FFI, process or tenant fault isolation.

## How to run the model tests
```sh
node --test tests/receive-invocation-stack-oracle.test.mjs
```

The source-free model is deterministic and intentionally does not parse AttoLang, launch an actual ActorRuntime, generate LLVM/Wasm/NativeAOT machine code, authenticate OS threads, or enforce memory pages. Its JS WeakMap tokens are **simulation-only** credentials, not a runtime security implementation.


## Implementation candidates — 2026-11-09

Two **new, unmerged, host-runtime-only** implementation drafts have been authored:

- [Java/GraalVM #2722](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2722): source-code-executor receives mint a persistent logical execution ID/root; synchronous CALL/RET shares that root, and the root remains charged until the actor's Future continuation retires it. Java guest compiler nested `await` remains unsupported and unverified.
- [LLVM #1625](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1625): actor-owned bounded native frame store keyed by existing ledger events with LIFO, preallocated bytes, actor-wide quotas, generation ABA fencing and non-executable STOP cleanup. Source compiler emission remains unsupported/unverified.

Both have focused tests and exact-head CI workflows **authored**, but source-org Actions reports failed, **zero-step/steps=null** jobs. Neither counts as executed JUnit/CTest, compiled source guest proof, native stack containment, nor five-backend parity. All five `backend-matrix.json` guest statuses remain `NOT_EXECUTED` until independently observed exact-head nonzero-step results are recorded. Their parent runtime PRs (#2704, #1126) are also drafts; do not merge children independently without semantic rebase/review.

## Backend guest admission gates
Run the same positive and negative AttoLang source semantics on all five backends:
- Positive: nested `receive()` frames preserve locals/PC through await; two permitted simultaneous receives have disjoint live frames; spawned Task has a different stack, runs even on the same physical carrier.
- Negative: escaping parent stack reference, foreign frame/wake ticket, stale actor incarnation, duplicate resume, default-serial DATA overtaking suspended receive, over-budget stack admission, impossible live critical guard across await.
- Fault: A's swallowed stack-budget error still stops A, B makes progress; physically retired frames are scrubbed before reuse; supervisor CONTROL can be delivered with DATA full.
- Hard real-time: a configured stack/recursion bound is proven; watchdog detection alone does not meet this requirement.

Required proof per backend: exact head/tree/source SHA, nonzero CI steps, compiler accept/reject diagnostics, executable guest outcomes, negative fault and runtime receipts, plus sanitizers/native AOT as appropriate. A failed runner-admission job or host-only oracle is **NOT_EXECUTED** for the guest gate.

Related existing drafts: conformance #609 (actor overflow), #617 (critical borrow), #624 (Task capture); Java #2704 (continuation chain), LLVM #1126 (execution ledger), Forge #210 (owned logical frames), .NET #411/#430 (frame ABI), Wasm #442 (tenant instances). These are independent dependencies, not merged/pre-approved claims.
