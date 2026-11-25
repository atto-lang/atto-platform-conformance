# Atto source-control admission — 11-backend scoped parity audit

**Status: partial pre-lexing admission evidence only; no compiled-guest parity certified.**

The canonical portable contract rejects the **literal** Unicode controls U+001B, U+007F, U+0085, U+061C, U+200E, U+200F, U+2028–U+202E and U+2066–U+2069 **before** comments, strings, tokenization, type checking or codegen. Ordinary UTF-8 text including `café 😀` remains valid. This is distinct from executable language parity.

The [machine-readable 11-backend registry](../contracts/atto-source-control-11-v1.json) covers every `atto-lang/atto-source.*` repository: `.atto`, `.net`, `.hdl`, `.java`, `.realtime`, `.rs`, `.llvm`, `.js`, `.forge`, `.wasm`, `.cranelift`.

## Evidence and gaps

- [HDL #39](https://github.com/atto-lang/atto-source.hdl/pull/39) at `5aa87f50e3c8a378228b07f7d3305d7bd67e8a33`: the actual HDL JavaScript compiler was evaluated in-memory against 51 negative inputs and one positive checked 42 reference computation. An isolated `Buffer.byteLength` shim replaced Node's API; this was **not** a full Node test run, Verilog simulation or synthesis.
- [JS #107](https://github.com/atto-lang/atto-source.js/pull/107) at `a50250c45695811c9c84a314f678722d1e487f55`: scalar and program-v2 preflight functions were evaluated in-memory against 102 negative inputs and two Unicode-positive controls. The full ESM CLI and generated guests were **not** executed. A branch-reconciliation commit retained current-main bidi checks.
- Cranelift `src/frontend.rs` at `e867c0a5cf8b94f98ce9b1212d2c735b76bc4120` contains a pre-lexical scanner covering all listed controls. This was **source inspection only**; Rust was unavailable in the local runtime, and its test suite was not run.
- Java, LLVM, .NET, Wasm, Forge, Rust and other backends remain `NOT_EXECUTED` for this specific 17-control, exact-head matrix. Self-hosted `.atto` and `.realtime` are documentation-only bootstrap repositories and cannot qualify as executable compilers merely by appearing in the inventory.

All 156 in-memory checks passed; this does not prove native/AOT/RTL compiled guests, absence of artifacts across every compiler, or complete 11-backend parity. The audit is intentionally separate from [11-repository inventory #550](https://github.com/atto-lang/atto-platform-conformance/pull/550) and existing legacy Oreslang Unicode contracts.

**CI privacy:** the JS and HDL source organizations recorded failed jobs with **zero executed steps**; that is not a failing test or a passing guest. Both private source repositories currently have **no approved private carrier destinations**. Do not mirror their trees to another organization without independently reviewed explicit destination authorization. The registry itself is source-free but cannot substitute for material compiler execution.

Run registry-only tests with `node --test tests/atto-source-control-11-v1.test.mjs`. A future qualified backend requires exact compiler head and tree, actual negative source tests, checked no-output-artifact behavior, correct source byte/UTF-16 offsets, honest unsupported profiles, independent CI execution and review.
