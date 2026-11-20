# Result/Option / ? / trap cross-compiler implementation status

Date: 2026-11-19 (America/Lima). **Target contract, not a verified cross-backend PASS.**

References: [trap-result-v1](../contracts/trap-result-v1.md), [guest target registry](../contracts/trap-result-guest-v1.json), [spec int.parse PR #124](https://github.com/atto-lang/atto-spec/pull/124), [backend parity issue #20](https://github.com/atto-lang/atto-compilers-parity-testing/issues/20).

## Feature slices, not a universal PASS

| Repository/target | Source/compiler implementation at inspected head | Status of NEW Result<int,Error> parse_id guests |
| --- | --- | --- |
| `atto-source.rs` | [PR #331](https://github.com/atto-lang/atto-source.rs/pull/331) head `f29bde64c152f2f0f1e19efb53a4e2b9258f65a5`: checked in-guest `int.parse`, `Result<int,Error>`, `?`, Result-aware `trap`, Err/Ok discard, restricted nominal Error. An earlier feature subset passed exact-tree carrier CI, *not the current int.parse head*. Three byte-identical Option<int> guests are now shared with the LLVM native candidate and the conformance registry; no new executable receipt. | **NOT_EXECUTED** |
| `atto-source.llvm` Rust/Wasm frontend | [PR #57](https://github.com/atto-lang/atto-source.llvm/pull/57) head `f27fa53c53b43f0de3198d61b7af035b40e60570`: concrete `Result<int,string>` and `Option<int>` tagged match, `Ok()/Err()/Some(_)` payload discard, `?` early propagation, additional executable-Wasm guest fixtures. This is NOT `Result<int,Error>`, and NOT the separate C++ LLVM AOT compiler. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.llvm` Rust `atto-llvm` native LLVM/ELF bootstrap | [PR #57](https://github.com/atto-lang/atto-source.llvm/pull/57) candidate `9c9a2e98570a1c60c3f9ae53c25cedefaa5aed90`: deny-by-default typed-IR-checked, heapless by-value `Option<int>` construction, variant match and `?` early return. Five positive native ELF O0/O2 `.atto` fixtures plus invalid-? no-artifact negative registered under `native-option-int-v1`; no compiled guest result yet. This does **not** implement `Result<int,Error>` or the separate LLVM C++ compiler. | **NOT_EXECUTED / canonical Error API UNSUPPORTED** |
| `atto-source.rs` current-main fixture-only extraction | [PR #423](https://github.com/atto-lang/atto-source.rs/pull/423) head `aae7ff2a2bb5f267d94a4913c51b3e0d39cfc886`: five `Option<int>` positive and one `?` type-rejection source fixture copied byte-identically from `atto-source.llvm` bootstrap, without copying any conflicted parser/typechecker/wasm changes from PR #331. This is not a source feature implementation and has no executed guest receipt. | **NOT_EXECUTED / fixture-only** |
| `atto-source.llvm` native C++ AOT | Separate native compiler, not the Rust/Wasm frontend. No verified typed Error/Result guest implementation shown. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.net` | [PR #11](https://github.com/atto-lang/atto-source.net/pull/11) head `81df7ccb2c3b207cd1d8f22a0b48de344f7667bb`: scalar CIL rejects typed Result/Option, `int.parse`, `?`, `trap` with `E_UNSUPPORTED_RESULT_EFFECTS`, no artifact; 5 rejection and 2 source-isolation checks. NativeAOT guest support not implemented. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.forge` | [PR #36](https://github.com/atto-lang/atto-source.forge/pull/36) head `e0aaacd7d27040a6791bfd3c9e8d91be89c262a4`: token-aware scalar C++ rejection for Result/Option/?, int.parse and failure effects; CMake CLI no-codegen and comment/string tests. No tagged-value runtime or compiled guest support. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.java` | Checked host-side ADT match planner handles discards, but a host planner is not a compiled Java/Graal Atto guest. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.cranelift` | Native JIT scalar subset; no certified Error/Result tagged guest path here. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.js` | Trusted JS scalar/actor transpiler subset; does not establish Result/Error compiler semantics or TenantVM guest isolation. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.wasm` | LLVM/Wasm admission/host runtime, not an independent general-purpose Atto source frontend. A Wasm host executing an older Rust guest does not certify this new fixture. | **NOT_EXECUTED** |
| `atto-source.atto` | Self-hosting compiler bootstrap/scaffold. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.hdl` | HDL target scaffold, unsupported general runtime error unwinding. | **NOT_EXECUTED / UNSUPPORTED API** |
| `atto-source.realtime` | Realtime runtime scaffold; not a standalone source compiler. | **NOT_EXECUTED / UNSUPPORTED API** |

## Current execution blocker

The new source-org CI runs all failed with **zero executed steps**: [LLVM frontend #44655972383](https://github.com/atto-lang/atto-source.llvm/actions/runs/44655972383), [.NET #44656269475](https://github.com/atto-lang/atto-source.net/actions/runs/44656269475), and [Forge #44656441647](https://github.com/atto-lang/atto-source.forge/actions/runs/44656441647). The LLVM job log returned BlobNotFound. These runs **do not establish either source correctness or implementation failure**. The earlier Rust exact-tree carrier PASS applies only to the earlier compiler head.

## Required promotion order

1. Restore authorized CI admission and obtain real exact-head frontend guest execution for the LLVM typed `Result<int,string>` / `Option<int>` positive and no-artifact negative fixtures; separately run current Rust `Result<int,Error>` + `int.parse` targets. Preserve source blob/tree hashes and compiler/guest digests.
2. Implement the **same** `Result<int,Error>` and `int.parse` normative contract in the native LLVM, Java, .NET, Forge, Cranelift and JS compilers, rather than treating fail-closed diagnostics as actual support.
3. Verify Error identity, `?` LIFO cleanup, match exhaustiveness, and `trap` catch-only-ordinary-throw with panic/raise/cancellation bypass. Real actor panic must remain supervisor CONTROL and tenant-isolated.
4. Mark each individual backend *and each feature slice* PASS only after guest exit/stdout, exact error identity, negative diagnostic/no-artifact and nonzero executed steps. Do not merge or publish public pins without branch protection and independent reviews.

**NOTE:** `Result<int,string>` is a valid narrow ADT shape but is **not** a substitute for `Result<int,Error>`; `E_UNSUPPORTED_RESULT_EFFECTS` is a proof of fail-closed design only after its negative test executes. Neither should ever be counted as successful execution of the canonical `parse_id` program.
