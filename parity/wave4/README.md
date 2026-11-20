# Wave 4 · Oreslang parity tasks 16–20

**Evidence status:** reference-model code, pinned Oreslang source candidates, and adversarial tests. This change DOES NOT implement, execute, or verify the Java, LLVM, .NET, Forge or Wasm production compiler/runtime feature set. The source compiler fixtures are candidates: rejecting them due to unrelated unsupported syntax must never count as a feature pass.

## Workstream owners and release gates

| Task | Target semantics | Existing work to integrate | Required proof beyond this PR |
| --- | --- | --- | --- |
| **16. State isolation** | Single actor-owned `state { ... }` map; immutable read snapshots, `critical` exclusive writes, `with` effects, scoped `using` grants, revocation and no loan escape/suspension | [Java #760](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/760), [LLVM #463](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/463), [Java #1037](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1037) | Real source guest mutable/immutable behavior, actor heap segregation, independent memory-boundary and lifetime proof on each backend |
| **17. ActorGroup + CONTROL** | Distinct group membership vs structured supervision; sealed join permits, revocation, bounded DATA/CONTROL lanes, terminal notice exactly once and correct parent identity | [Java #674](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/674), [Java #631](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/631), [LLVM #376](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/376) | Source guest supervision, real scheduler CONTROL delivery outside child carrier, failure/cancellation/restart races, source/foreign-forgery rejection |
| **18. Typed messaging / MessagePack** | Compiler-derived `Sendable` local ownership vs versioned format-specific `Serializable<Format>`; closed variant tags, strict schema identities, no codec or pointer transport | [Java #645](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/645), [Java #1026](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1026), [Java #1060](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1060) | Real compiled actor mailbox encoding/decoding with golden vectors, strict multi-backend source/schema mapping, runtime ownership handoff; no authority serialization |
| **19. Channels / select** | Bounded FIFO, non-destructive full backpressure, fair selection, `select` value vs `do select` return destinations, `nb select` typed `Future<T>`, cancellation and one-shot winner | [Java #887](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/887), [Java #538](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/538) | Real guest future and select-arm execution, cross-carrier notification, close/cancel races, no false output or double return |
| **20. Async I/O** | NIO/epoll kernel-only readiness, 1–4 bounded reactor instances, epoch-safe operations, cancellation, actor-carrier-safe completion handoff | [Java #790](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/790), [Java #1100](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1100), [LLVM #485](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/485) | Real loopback TCP guest execution with JDK25 Native Image and native Clang/ASan/UBSan, no host carrier blocking, bounded resource shutdown and stale wake rejection |

## Reference-model deliverables

`src/wave4.mjs` implements deliberately limited, inspectable models. **These are not source compiler, Oreslang runtime, or production MessagePack v2 ABI implementations.** The MessagePack fixture uses a narrow canonical subset with 4-element `[domain, 2, variant, payload]` framing only for differential oracle construction; it must NOT be substituted for [Java #645](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/645)'s real typed contract or assumed wire-compatible without golden vector comparison. Local actor data is a recursively frozen, bounded data projection; it is not a proof of full heap isolation. The reactor model contains no real socket or epoll operation.

The `ActorGroupModel` purposely never treats a membership permit as a supervisor CONTROL authority. The `SupervisorControl` simulation rejects forged parent identity, reserves CONTROL capacity independently of ordinary DATA, and refuses to silently drop terminal notices when the CONTROL lane fills. A real runtime must also implement scheduler-driven retry/escalation and bounded fairness.

The I/O model never invokes guest callbacks from a kernel-ready notification. It admits at most 4 reactors, bounds outstanding operations and pending completions, tracks cancellation, and only hands completion records to a caller presenting an actor execution lease. Parallel actor execution (1–3 physical leases), proposed on other draft branches, is not enabled here. The default guest actor single-flight semantics remain unchanged until compiler-enforced state isolation permits otherwise.

## Run reference tests (Node 22+)

```sh
node --test parity/wave4/tests/*.test.mjs
node parity/wave4/bin/manifest.mjs --validate
```

The manifest checker reads all six `.ores` files, recomputes exact Git blob hashes, enforces the five backends and tasks 16–20, and refuses any `verified: true` or `certifiedParity: true` fields. Successful validation prints `CONTRACT_VALID_ONLY` and `compilerExecuted:false`. It does **not** parse or run any Oreslang guest source.

The independent reference test file has 23 tests and the manifest tests add six tests, for **29 committed test cases**. Initially 23 reference checks were executed against the exact GitHub JavaScript source in an isolated V8 engine using a minimal Buffer-compatible test adapter. That is **not** a full Node 22 or GitHub-hosted test pass. Complete Node test and real backend compiler/runtime verification remain required.

## Security, CI and merge gates

1. Execute the entire Node 22 test suite at the exact PR head with recorded runner steps and logs. Never turn zero-step Actions failures into source test evidence.
2. Inspect current source-tree and linked guest ABI, then port source-level tests to production compiler branches. Distinguish true feature rejection from syntax-only failure; no independent `wasm` compiler is assumed.
3. For state/CONTROL/channel tests: run actual actor source guests, deterministic interleaving plus stress/sanitizer checks and CONTROL quota saturation; prove one completion and no leaked ownership on failures.
4. For MessagePack: compare real v2 Java/native binary golden frames, test round trips, malformed input, forged schema, unknown variants, field ambiguity, size and recursion bounds; no raw capabilities in payloads.
5. For I/O: integrate the existing NIO and epoll sources; prove real kernel readiness, cancellation fence, source guest echo, listener close, AOT/hybrid and native sanitizer execution. No promise of true hard-real-time scheduling without separate WCET/resource proofs.
6. Respect private-source CI reviewed destination allowlists and repository visibility. Do not mirror private compiler source into unapproved repositories to bypass exhausted GitHub Actions minutes.

**This batch contributes a runnable, fail-closed reference contract and source candidates, not end-to-end implementation parity across the five compilers.**
