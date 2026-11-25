# Oreslang parity wave 3 — roadmap tasks 11–15

**Status: backend-neutral reference models and draft compiler-source candidates only. No compiler/runtime parity is certified.**

This addition complements [wave 1 PR #47](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/47) and [wave 2 PR #49](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/49). It avoids touching the diverged Java and LLVM compiler implementations. All five source backends remain pending; `source.wasm` inherits LLVM source language capabilities and must be tested through a real pinned LLVM→Wasm guest pipeline, not a fake independent compiler.

## Deliverables and upstream context

| Task | Reference-model deliverable | Source/runtime acceptance still required |
| --- | --- | --- |
| **11 — exceptions and cleanup** | Executable precedence `host_fatal > cancel > panic > raise > throw > normal`, LIFO `defer`, one-time `finally`, suppressed lower-priority causes | Prove real guest cleanup, suspension, terminal actor classification and supervisor CONTROL. Reuse [Java #583](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/583), [#696](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/696), [#938](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/938), [LLVM #376](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/376). |
| **12 — freestanding core / hosted std** | Transitive graph verifier with explicit `core`, `hal`, `std` dependency policies for freestanding, RTOS and hosted profiles | Move actual APIs into core/std, prove compiler-emitted Cortex-M / RV32 native objects contain no forbidden OS symbols, linker/map verification, QEMU/board runtime. Existing [Embedded](https://github.com/ores-truffle-oreslang/oreslang-platform.embedded) is scalar/bootstrap, not complete core. |
| **13 — protected actor hooks** | Sealed `private abstract receive` authority model; `receive(self, Mail)` and `receive(Mail)` share the same method slot; direct calls and references denied | Real Java and LLVM compiler rejection diagnostics and trusted superclass-only mailbox execution. Reuse [Java #1090](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1090), [LLVM issue #477](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/477). |
| **14 — local ActorRef identity** | WeakMap-based opaque local reference model with minted handles, generational retirement, stale/foreign/forged denial, bounded mailbox, JSON deny | Actual Java/LLVM/.NET/Wasm/Forge runtime forge/stale/capability and wire-denial tests; authenticated *remote* references require a separate transport credential. Reuse [Forge #13](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/13), [Forge #34](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/34), [.NET #21](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/21). |
| **15 — single-flight physical actor turns** | Bounded state-machine execution model: one active guest lease per actor, multiple unfinished logical messages, suspend/requeue, carrier migration, stale/double-resume denial, concurrent unrelated actors | Real multithreaded carrier stress and sanitizer/native traces across backend runtime profiles. Reuse [Java #519](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/519) and [Java #997](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/997). |

The normative five-backend actor-hook and `private abstract` contract is
[PRIVATE_ABSTRACT_ACTOR_HOOKS_V1.md](../../contracts/v1/PRIVATE_ABSTRACT_ACTOR_HOOKS_V1.md).
It is byte-identical to the contract committed in each `oreslang-source.*`
backend. LLVM's restricted `on_message(int)` remains a legacy subset, **not**
proven `receive(ActorMail<T>)` ABI parity. Unsupported native class and hook
source must fail closed with a real compiler diagnostic and no emitted artifact.

## Actual local execution

Run on Node 22+:

```sh
node --test parity/wave3/tests/*.test.mjs
node parity/wave3/bin/wave3.mjs --validate
node parity/wave3/bin/wave3.mjs --backend=java
```

The last command returns status **3 UNCONFIGURED** until a real compiler adapter is provided. Candidate compiler-check entrypoint:

```sh
node parity/wave3/bin/wave3.mjs \
  --backend=java \
  --argv='["/absolute/path/to/real-compiler","--check","{file}"]' \
  --source-sha=40_CHARACTER_LOWERCASE_COMMIT_SHA
```

The optional checker requires an absolute executable with exactly one standalone `{file}`, source SHA declaration, bounded execution, exact pinned fixture Git blob SHA-1 + SHA-256, positive source admission (exit 0) and for protected-receive negatives exit **1** with primary `error:` mentioning both `receive` and the hook authority violation. A parser/syntax error does **not** satisfy a private-method semantic rejection. SHA declarations and executable hashes are not independent binary/source provenance attestation; the checker always returns `verified:false`.

The `cleanup-normal` and `cleanup-panic-bypass` source files are candidates requiring compiler review and runtime observation; similarly `actor-serial-lifetime` needs real actor message traces. No mock or static admission proves actual guest unwind/supervisor delivery or actor single-flight. Task 12 and 14 are reference *host* policy tests until real compiler-to-runtime tests exist.

### Important model hardening discovered by executed adversarial traces

A first bounded interleaving run exposed that `suspend(id, undefined)` could pass an `active?.ticket === ticket` check with no active turn and accidentally mint a phantom lifetime. Fixed by requiring `active !== null` before state transition for **both suspend and finish**. The regression exhaustively visits bounded legal sequences of `send`, `enter`, `suspend`, `resume`, `finish`, and `cancel` across two different carriers; it checks one-lease/maximum-outstanding invariants on each accepted trace.

This was a **reference-model bug**, not evidence of a production compiler/runtime bug.

### Merge/release gates

1. Execute full exact-head GitHub Actions job and inspect real steps, not zero-step workflow failures; CI failures before runner allocation prove nothing about tests.
2. Independently verify real compiler trees and artifact provenance before using outcomes as conformance evidence.
3. Add real actor guest test vectors and native/Rust/Java ownership and scheduler models to the backend suites; do not claim parity merely because JS reference-model tests pass.
4. Test a true freestanding Oreslang executable/firmware link, not only a mocked dependency graph.
5. Do not mirror private source into unapproved carriers. Keep this PR draft until review + real backend evidence.

**This PR implements cross-backend oracle infrastructure, not production changes to five source compiler repositories.**
