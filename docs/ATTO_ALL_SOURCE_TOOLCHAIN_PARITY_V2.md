# AttoLang all-source-toolchain parity gate v2

**Partial executed slices, no full cross-backend parity certificate.** The canonical 26-file match/tilde contract remains in `contracts/atto-canonical-syntax-v1.json`; this overlay extends the inventory beyond the original five core targets to **all nine** `oreslang-source.*` repositories in the source organization: Java, LLVM, Wasm, Forge, .NET, JavaScript, Rust, Cranelift and HDL.

The manifest records exact-head historical **selected-source** receipts for Java's populated *literal-only* Map guest, LLVM's scalar match-default, and JavaScript's program-v2 generated-ESM scalar match-default, PLUS separately labeled **fail-closed-only** native compiler proofs from Forge, .NET and Rust (unsupported match/map reject before IR/CIL and baseline scalar execution remains supported). The evidence class field explicitly prohibits presenting Forge/.NET/Rust reject-only safety gates as compiled match/map guest execution. These are deliberately incomparable slices, not an assertion of identical AST/IR, optimized runtime, Native Image or ABI behavior. Source-only manifest tests cannot verify GitHub run/job logs; reviewers must check the linked run IDs before promoting evidence.

Canonical compatibility correction: `on default` is **invalid**, as specified by `oreslang-common-source` v1 and v2. Only `default ->` is canonical; `on _` and `else` may be considered under separately bounded legacy syntax compatibility. The original candidate manifest incorrectly listed `legacy-on-default` among the positives; now the fixture is a negative, with 12 accept and 14 reject across the same 26 immutable source files. No fixture content or blob SHA was modified.

**Promotion protocol:** each backend must execute the relevant accepted source through its actual parser, typechecker/ownership passes and compiled guest; accepted samples produce an observable exit/result; rejects fail with a diagnostic and no usable artifact; source SHA and selected blob hashes must match; actor/singleton/critical-state leak tests must pass; complete source, AOT/ABI as applicable, optimized and sanitizer/RT gates need their own receipts. No full-parity claim until nine independent reviewed receipts, with non-applicable target gates documented and reviewed.

Run:
```sh
node --test tests/atto-canonical-syntax-v1.test.mjs tests/atto-source-toolchain-parity-v2.test.mjs
```
