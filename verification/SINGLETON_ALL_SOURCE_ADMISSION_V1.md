# AttoLang singleton: nine-backend source snapshot

This is a **source-only, not-live and not-executed** inventory from November 10, 2026. It is not proof of functioning guest singletons. The existing frozen 20-case canonical five-backend contract remains unchanged.

The existing keyword is `singleton`, and the canonical declaration is `define singleton`. Target semantics: compiler-resolved application-domain declaration identity, complete once-publication, immutable shared reads, sticky failure and finite initialization-cycle rejection. Compiler semantic checks must reject self escape and transitive mutable/actor-private alias publication. No raw cross-domain singleton authority.

Sources and exact observed main/blob SHAs are recorded in the adjacent JSON. Only one primary frontend file per repository was inspected; missing keyword text does not prove the whole repository lacks an implementation. Cranelift explicitly rejects singleton declaration kinds; Wasm delegates to LLVM compiler. Java/LLVM/.NET admission PRs are draft (#2316/#1203/#267), Wasm #191 is a merged rejection gate, and Forge #146/#159 are draft host foundations. Java #665 (deep immutable process snapshot on integration branch) conflicts semantically with draft #160 (mutable memory-slot semantics) until reconciled. **No default-branch compiled singleton guest result is established.**

The structural verifier cannot authenticate GitHub runner admission, live source SHA, compiler/guest artifact hashes, or guest execution; no promotion is possible from this snapshot. Next gates: execute exact-head production compiler admission and semantic-check cases; compile/run positive guest once-initialization; then run the canonical twenty scenarios on five backends, native sanitizer/AOT/Wasm-worker evidence and additional backends' capability-specific cases. Verify independently and keep privacy approval required for any cross-org mirror.

Implementation tracker: https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/650
