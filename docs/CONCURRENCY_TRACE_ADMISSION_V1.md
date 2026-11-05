# Concurrency cross-invariant trace admission v1 — reference-only

This source-free, deterministic model is an **integrated negative-test oracle** for AttoLang/Oreslang work priorities #11–#15. It is **not** the language implementation, not a simulator of OS scheduling, not a native sanitizer, and not an authenticated GitHub/guest execution verifier. It accepts traces supplied by a caller. A caller can forge or omit any event; therefore even `CONSISTENT_REFERENCE_TRACE_ONLY` is **not proof** of the runtime, compiler, or a complete execution.

## Run
```sh
node --test tests/concurrency-trace-admission-v1.test.mjs
npm test
```
Both require an actual Node 22+ process and executed steps. Source-only fixture inspection or a zero-step GitHub Actions failure cannot stand in for a test run. The module has no I/O and does not import private source.

## Contract and covered invariants

Use `evaluateConcurrencyTrace({backend, events})`, where `backend` is one of `java-graal`, `llvm`, `net`, `wasm`, `cranelift`. This is a target label, **not a runtime fingerprint**. Every event is a plain JSON object with consecutive 1-based `seq`, exact `kind`, and the required fields only. Unknown fields and kinds fail closed; the 512-event cap bounds evaluation.

- **#11 Five-backend contract.** The same trace admission decision is usable across all five target labels; it does not establish that any backend supports the operation. Unsupported source must fail before emitting executable artifacts, with specific backend compiler diagnostics.
- **#12 Critical.** `critical.enter`, `critical.queue`, `critical.grant`, `critical.cancel`, `critical.try`, `critical.exit` model one guard owner, bounded FIFO queue, cancellation of ungranted tickets, and strictly immediate try-enter. They do **not** prove an OS carrier never blocked; a real scheduler/ASan/JFR or equivalent evidence is required.
- **#13 Actors.** `actor.open`, `actor.start`, `actor.queue`, `actor.suspend`, `actor.resume`, `actor.finish`, `actor.control-stop` model DATA non-reentrancy across suspension, FIFO continuation admission, independent actor progress and generation checking. CONTROL signals do not steal a logical DATA turn. Physical heap and turn retirement are separate release gates.
- **#14 Select.** `select.open`, `select.arm`, `select.win`, `select.publish`, `select.wake`, `select.close` require registered arms, a single winner, winner-only publication, one wake and retirement before generation rearm. A failed winning arm may wake with no published message; a losing arm can never publish.
- **#15 Task scopes.** `scope.open`, `scope.cancel`, `scope.close`, `task.spawn`, `task.terminal`, `task.quiesce`, `task.retire` require a closed scope to have zero unretired children. A child may quiesce before reporting terminal outcome or vice versa; retirement requires **both**. Cancellation stops new admissions but may not fabricate completion.

Input is required to describe a **completed trace**: no critical owner/queue, actor DATA turn/queue, open select, live task or open scope may remain. The returned `index` and `reason` on `TRACE_REJECTED` identify the first inconsistent event; they are diagnostics, not source-language compiler error codes.

## Authentication and backend gates — never inferred from trace JSON

`CONSISTENT_REFERENCE_TRACE_ONLY` always returns `compiler_executed:false`, `guest_executed:false`, `semantic_parity_certified:false`, and `source_transfer_authorized:false`. A fully valid trace still lacks independent evidence of real AttoLang source execution, event completeness, generated IR, linked binary, CPU/carrier behavior, ownership across cancellation, and physical retirement.

Before marking a backend as genuinely conformant:

1. Review the exact semantic language source against common-source [contract #207](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/207) and platform [contract #292](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/292). Proposed diagnostics and `async` exceptions are review targets, not established universal behavior.
2. Compile positive and negative `.atto` fixtures using the real backend compiler at an immutable source/tree SHA, with negative diagnostics and **no partial artifacts**.
3. Execute the compiled guest at that SHA on a real, independently admitted runner with nonempty step records; use generation-fenced runtime instrumented traces rather than synthetic JSON.
4. Bind workflow run and attempt, unique job ID and executed steps, full source and fixture Git blob IDs, compiler digest, runtime/IR/binary digest, actual guest exit/stdout/stderr, allocator/actor/channel quotas and cancellation evidence.
5. Independently verify trace completeness and event attribution; a passing JSON-only oracle cannot authenticate itself. Require negative mutations of source, event history, cancellation, stale generations and executable before release.
6. Complete independent codeowner review and protected-main policy; respect private source-transfer holds. The host-only suite may merge into an authorized branch when governance permits, but **never** as a guest parity release gate by itself.

### Existing non-duplicated backend work

- Java [#2422](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2422) / [#2433](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2433) — critical parser/type/host gate and guest-admission staging.
- LLVM [#1126](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1126), [#1039](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1039), [#1040](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1040) — actor ledger, selectable send before publication and one generation-fenced wake.
- Java [#999](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/999) and [#2070](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2070) — Future/select revocation and TaskScope physical-retirement lineage.
- .NET [#322](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/322), Wasm [#259](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/259), Forge [#168](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/168) — source admission fail-closed pending execution.
- All authoring lineages remain separate. No private source is mirrored, and no PR is promoted merely because this reference oracle accepts its declared trace.
