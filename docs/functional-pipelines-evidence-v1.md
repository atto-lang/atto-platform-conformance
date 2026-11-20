# Atto functional-pipeline guest evidence v1

Canonical source: [atto-spec PR #121](https://github.com/atto-lang/atto-spec/pull/121), `conformance/functional-pipelines-v1/cases.json`.

This ledger is a **gating mechanism, not a test result**. The four positive `.atto` programs must compute `main(): int` values `83, 83, 42, 42`; four negative canonical programs must reject without publishing a guest artifact. The eight source Git blob SHAs are fixed in `contracts/functional-pipelines-v1/ledger.json`.

## Do not confuse return values with OS exit codes

A compiler's guest `main()` value is the language result, independent of the target's process or embedding ABI:

- `os_exit_code`: the actual compiled guest returns process status 83 or 42 with empty stdout, as with the bounded .NET/Java/LLVM profiles.
- `stdout_line_i64`: the real native scalar guest prints `83\n` or `42\n` and exits 0. Forge and Cranelift currently use this ABI. A host-only program calculating 83 is **not** acceptable.
- `wasm_export_i64`: the actual compiled Wasm guest exposes the returned integer through an executed export. Require the export name and observed value, plus valid admission and guest binary hashes.

These profiles are **measurement adapters**, not alternative AttoLang semantics. The evidence must record the raw process exit/stdout or guest export, not silently reinterpret a zero-step test run or substitute a host reference computation.

## Promoting a backend from `not_executed` to `passed`

Every receipt must identify an exact compiler head and Git tree, one nonzero-step CI run URL, toolchain, actual guest command, and **all eight** per-fixture results with the pinned fixture blob SHA. Every positive requires actual compiled execution, its raw return transport, the normalized observed `main` value, and SHA-256 of a named generated artifact (native binary/LLVM or Cranelift IR/Wasm/CIL). Every negative must record a typed `type` or `syntax` rejection and zero resulting guest artifacts.

Compiler source files, parser tests, host-only model tests, GHA startup failures, stale pre-commit CI, or the existence of generated source code cannot establish `passed`.

Current implementation PRs: [Rust #381](https://github.com/atto-lang/atto-source.rs/pull/381), [LLVM #54](https://github.com/atto-lang/atto-source.llvm/pull/54), [.NET #16](https://github.com/atto-lang/atto-source.net/pull/16), [Java #51](https://github.com/atto-lang/atto-source.java/pull/51), [Forge #45](https://github.com/atto-lang/atto-source.forge/pull/45), [Cranelift #50](https://github.com/atto-lang/atto-source.cranelift/pull/50), [formatter #26](https://github.com/atto-lang/atto-format/pull/26). Forge and Cranelift are restricted scalar compiler paths, not general language/actor/TenantVM parity.

This work is tracked in [atto-platform-conformance issue #105](https://github.com/atto-lang/atto-platform-conformance/issues/105). Tests: `node --test tests/functional-pipelines-ledger.test.mjs` is **manifest integrity only**, not compiled guest verification.
