# core/alloc/std libraries v1: shared guest corpus

The executable conformance corpus for
[atto-spec core-alloc-std-libraries-v1](https://github.com/atto-lang/atto-spec/blob/main/language/core-alloc-std-libraries-v1.md).
Cases use the canonical `atto.<layer>/<unit>` selectors (`aliases` covers the
`<layer>/<unit>` shorthand; `neg_ores_selector` checks that `ores.*` never
selects a unit). Each compiler keeps a byte-identical copy in its own repository (CI there
cannot check out this private repository), runs it with its real
compiler/linker, and executes the guest.

## Case headers

| Header | Meaning |
| ------ | ------- |
| `// flags: ...` | extra compiler/launcher flags (`--target-os=linux\|windows`) |
| `// expect-exit: N` | `main` returns N (process exit code / guest return value) |
| `// expect-stdout-json: "..."` | exact stdout |
| `// expect-reject` | the compiler must reject the program |
| `// expect-error: s` | the rejection diagnostic contains `s` (all backends) |
| `// expect-error-<backend>: s` | backend-specific diagnostic (`llvm`, `rs`, `java`, `net`) |

## Parity matrix (2026-11-22, Linux aarch64, local runs)

PASS = compiled/linked/executed (or correctly rejected). UNSUPPORTED = the
backend fails closed with an explicit "not implemented" diagnostic.

| Case | LLVM (native) | Rust (Wasm) | Java (JVM) | .NET (CIL) |
| ---- | :-: | :-: | :-: | :-: |
| core_num | PASS | PASS | PASS | UNSUPPORTED (Option<int>) |
| core_cmp | PASS | PASS | PASS | PASS |
| core_option_result | PASS | PASS | PASS | UNSUPPORTED |
| core_mem | PASS | PASS | PASS | UNSUPPORTED (Option<int>) |
| alloc_arena | PASS | PASS | PASS | UNSUPPORTED |
| std_io | PASS | PASS | PASS | UNSUPPORTED |
| std_path_posix | PASS | PASS | PASS | UNSUPPORTED |
| std_path_windows | PASS | PASS | PASS | UNSUPPORTED |
| aliases | PASS | PASS | PASS | PASS |
| neg_unknown_core | PASS | PASS | PASS | PASS |
| neg_unknown_std | PASS | PASS | PASS | PASS |
| neg_traversal | PASS | PASS | PASS | PASS |
| neg_nested | PASS | PASS | PASS | PASS |
| neg_private | PASS | PASS | PASS | PASS |
| neg_dotted_selector | PASS | PASS | PASS | PASS |
| neg_ores_selector | PASS | PASS | PASS | PASS |
| **total** | **16/16** | **16/16** | **16/16** | **10 + 6 unsupported** |

Backend-only extras: LLVM `llvm_alloc_vec`, `llvm_legacy_numeric`,
`llvm_neg_std_freestanding`; .NET `net_core_int_slice`.

Where each backend runs it:

- atto-source.llvm: `tests/atto_libraries_v1.py`, ctest `native_atto_libraries_v1`
- atto-source.rs: `node tests/atto_libraries.mjs target/release/attoc`
- atto-source.java: `AttoLibrariesV1Test` (JUnit) or `tests/atto_libraries_v1.py`
- atto-source.net: `verification/Ores.Net.Tests/AttoLibrariesV1SelfTest.cs`

Not yet covered: Cranelift, Wasm (LLVM to Wasm), JS, Forge and HDL. Their open
library PRs stage source candidates only.

`run_cli_backend.py --backend <name> --launcher <cmd>` runs this directory
against any launcher that executes a program and exits with `main`'s value.
