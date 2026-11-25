# AttoLang AOT artifact V2 — draft portable admission contract

Status: **reference contract / source-only tests**. Issue [#321](../../../../issues/321) is the release gate. Nothing under this directory is evidence that a guest was compiled, a native loader was invoked, or any of the 16 target lanes passed.

## V1 compatibility and V2 products

V1 Java manifests remain unchanged. V2 uses an explicit `schema_version=atto.aot-artifact.v2` and a separately stored `atto.aot-artifact-signature.v2` envelope. A V1 admission parser MUST reject V2 until deliberately upgraded; never widen the V1 enum without synchronizing the typed admission parser.

| Compiler backend | Product kind | Allowed format | Mode |
|---|---|---|---|
| java-graalvm, llvm, dotnet-nativeaot | native-executable | ELF (Linux), PE (Windows), Mach-O (macOS) | per-guest-aot |
| wasm-wasmtime | native-wasm-host | ELF/PE/Mach-O bound to host | per-guest-aot |
| wasm-wasmtime | portable-wasm | wasm, WASI/wasm32 | portable-wasm |
| wasm-wasmtime | precompiled-wasmtime | wasmtime-serialized, host target | wasmtime-precompiled |

Native host packaging is *not* inherently strict per-guest AOT. `portable-wasm` is not a native executable. Precompiled Wasmtime serialization is engine/version/platform-specific and MUST be checked by a compatible loader (the reference verifier intentionally cannot certify it).

## Authentication (distinct from execution)

1. Decode manifest and envelope from at most 64 KiB strict UTF-8 JSON, rejecting duplicate decoded keys (including escaped aliases), malformed literals, lone surrogates, trailing bytes, deep nesting, unsafe/unknown fields and impossible backend–format combinations.
2. Canonicalize the complete V2 payload according to RFC 8785 (JCS). The detached signature itself is NOT part of the signed payload. Compute SHA-256 of the canonical payload and compare to the envelope `manifest_sha256`.
3. Verify the detached Ed25519 signature over those **canonical bytes** using an externally provisioned and pinned trust-anchor map keyed by `key_id`. A manifest-provided public key or dummy fixture signature is NEVER a trust anchor.
4. Compare exact artifact length and SHA-256 and inspect format/architecture. Require subsequent platform-specific loader validation including full ABI/dependencies/runtime policy and environment checks.
5. Retain an independent exact-head executed-guest receipt (run ID/attempt, source head/tree, fixture blob + SHA256, compiler identity/mode, target/ABI, artifact hash/size/dependencies, step counts, guest exit/stdout/stderr, negative cases, review). Authenticated bytes are **not** guest execution evidence.

**Exact signed numbers.** The only numeric V2 field is `artifact.size_bytes`. Parse its mathematical JSON value before binary64 coercion: `128`, `128.0` and `1.28e2` mean the same exact integer, but a nonintegral lexeme that would round into an integer must be rejected. Values outside the safe JSON integer range fail closed. This is a lexical check **in addition to** JSON Schema's parsed-value constraints, so schema validation alone is insufficient for signed ingress. RFC 8785 normalizes numeric `-0` to `0`; zero-size artifacts are rejected by typed admission.

**Executable structure is not a loader.** ELF64 checks include executable file type, architecture, program-header bounds and a load segment; PE checks include PE32+, executable flags, sections and architecture; Mach-O checks include MH_EXECUTE, architecture and bounded load commands. These checks do not resolve dependent libraries, certify ABI compatibility, prevent a guest JIT, or prove that a binary was executed. A platform-specific loader and independent run receipts remain mandatory.

The JS module `lib/aot-artifact-v2.mjs` is a bounded source-only reference verifier for step 1–4. Even a successful return is explicitly `AUTHENTICATED_NOT_EXECUTED`, `loader_verified=false`, `guest_executed=false`, `release_ready=false`. It is *not* a production host loader, nor a replacement for the Java typed ingress or Rust policy implementation. Cross-language differential fixtures and the Rust-only tooling migration remain open.

## P0 pending

- Align TypeSpec + JSON Schema + Java typed V2 parser, and implement equivalent admission in LLVM, Wasm, and .NET.
- Add independent JSON Schema Draft 2020-12 differential tests, RFC 8785 conformance vectors, and native loader inspections; only the bounded reference verifier tests are currently present.
- Bring up source-local stepful runner admission. Existing `steps=null` Actions failures are infrastructure evidence, not compiler failures.
- Run the checked-i64 `42`, separate `14` source isolation, overflow rejection, and unsupported-source failure with no output, at each exact commit/tree; ultimately cover the 16 release lanes or explicit scoped exceptions.
- Enforce independently approved branch/release governance. Cross-org private source copying requires a verified private, writable, explicitly allowlisted destination *before fetching source bytes*, in accordance with `bin/require-private-mirror.mjs`. User request alone does not populate a repository's allowlist.

Never merge or promote solely because this source reference verifier passes.

## Golden detached-signature interoperability vector

`detached-golden-vector.json` pins a deterministic **test-only** Ed25519 signature over RFC 8785 canonical JSON, the externally supplied PEM public key, a 128-byte synthetic ELF-like artifact, and the exact manifest/artifact SHA-256 values. The artifact is **synthetic and not executable**. Its source hashes are fixture placeholders, so the vector must never be admitted as a release artifact.

`tests/aot-v2-golden-vector.test.mjs` independently checks the canonical digest, Ed25519 signature, artifact byte length/hash, tampering rejection, and the `AUTHENTICATED_NOT_EXECUTED` evidence tier. The staged Java sibling [oreslang-source.java PR #2478](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2478) uses the same canonical bytes/key/signature in a JDK Ed25519 test, plus a package-private structural V2 policy; neither is wired to public runtime ingress. The Java policy consumes an already strictly parsed object tree with exact `BigDecimal` size values and **must not** be invoked on arbitrary maps from a guest.

The source-organization Actions jobs remain pre-step blocked. A successful, **source-free** alternate-organization runner canary is not permission to copy private source, a known minutes balance, or compiler/guest execution evidence. Any source transfer must first pass the independent private destination-ID, source/tree and security approval gates described by issues #22, #77 and #127.
