# AttoLang canonical .atto — five-backend gate v1

AttoLang is the public language name. **.atto is the canonical extension for new source modules, tests, and examples.** Existing oreslang-* repository names, internal compiler binaries, and old .ores source files remain temporarily for migration compatibility; they do not redefine the public language name.

## First executable common program

The add.atto file is a byte-identical 39-byte AttoLang source in the central conformance repository and these five source repositories:

| Backend | Draft implementation | Required executable evidence |
| --- | --- | --- |
| Java/GraalVM | [#2460](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2460) | Real linked Java guest returns exit 42 |
| LLVM | [#1312](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1312) | Real LLVM frontend plus native Clang executable exits 42 |
| Wasm | [#275](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/275) | Pinned LLVM frontend plus real wasm32 binary plus isolated Wasm guest returns i64 42 |
| .NET | [#345](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/345) | Generated CIL statically linked to executed Linux and Windows NativeAOT apps returning 42 |
| Forge | [#177](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/177) (stacked on #171) | Real Forge checked IR plus Linux native assembly/link/execution of identical .atto guest, i64 42; limited to stage-0 constant-folded scalar, imports unsupported. |

Each source-repository copy must have Git blob SHA-1 015f8b0f79aafa796a148d2adeff1574e8d6c491. The build and test lanes in those branches use their own source trees: no private repository needs to be mirrored across organizations.

Run node --test tests/atto-source-v1.test.mjs and node scripts/verify-atto-source-v1.mjs for **source-only** admission. They verify reviewed source and manifest bytes and reject missing, symlinked, renamed or mutated inputs. **They do not compile or execute an AttoLang program.**

## Promotion requirements

Functional parity needs five exact-head compiler executions of the **same .atto bytes**, independently verified toolchain digests, observed return values, nonzero stepful CI receipts, and independent review. A source-only pass, compiler build without a guest, intentionally rejected syntax, a synthetic runner, a native host HTTP probe, or a GitHub Actions failure with runner_id=null and steps=null does not satisfy this gate.

This scalar v1 gate does **not** establish functional SSR and HTTP Routing parity. Their next shared .atto corpus must include routing static/parameter/wildcard precedence, HEAD/OPTIONS and Allow, immutable snapshot/foreign decision rejection, HTML escaping, HTMX history restoration, CSRF boundaries, local-only redirects and actor-owned HTTP request/response transfer. Each backend must compile/link the unmodified package graphs and execute corresponding positive/negative cases; Wasm additionally needs actual linked LLVM wasm32 output and .NET needs NativeAOT guest code, not only Kestrel provider tests.

**Status of v1:** authored implementation and source-only tests; no compiler-backed five-backend parity receipt yet. Keep every implementation PR draft until proven.

## Mode-specific observations

`42` is a **typed scalar result**, not an interchangeable OS process exit code. Forge's stage-0 CLI and linked native C test driver emit `42\n` on stdout; Java, LLVM, Wasm and .NET must independently establish the result in their own execution channels. Forge is **`oreslang-source.forge`**, distinct from independent `oreslang-source.cranelift` and from Wasmtime. One backend's execution, a four-backend receipt, or host-only validations cannot fill the fifth lane. The central verifier checks only local source/manifest integrity; it neither fetches nor attests remote compiler runs.
