# Provisional AttoLang Core identity stage-1 source identity

The independently fetched source blobs from .NET PR #381 and Forge
PR #202 are both `b8a0cf7a45f9c3070ad3bcd42d4a78c7cf83739b`
at the source heads pinned in the accompanying JSON snapshot.
A third copy is frozen in this conformance repository, with a Node test
recomputing its **Git blob** object ID from the actual bytes.

This establishes only 2-backend **source-byte identity**. It does not
prove any compiler has executed a guest, does not imply Java, LLVM or
Wasm runtime support, and does not upgrade the pre-existing portable
`numeric.atto` language contract. All stage-1 Core identity compiler
work is authored but unexecuted on source-owned GitHub Actions while
runner admission is blocked. Native compiler/artifact identity and
independent review remain mandatory before a stronger parity claim.

The Forge record is intentionally named `forge-stage1-native`,
**not** Cranelift. Its new execution script uses a hosted C++ ELF
harness and does not certify freestanding or zero-import guest code.
The Forge source head was refreshed after correcting those receipt
labels; the canonical source Git blob remains unchanged.

The two checked-in positive guest entrypoints are also byte-identical:
`fd685d84f8a84b84710c257dfa6f5a7c8329dbf9`. A second
conformance fixture now pins that exact Git blob. This proves a
common **authored** input source, not identical compiler execution or
runtime behavior, which remain unverified until both native gates run.

## Stage-2 canonical numeric source identity and 24-case branch model

The shared canonical `numeric.atto` file has the same verified
Git object identity `5ced991f1d49b3c2a60fdd72b9003c0a4d18cd72`
in .NET, Forge and the conformance fixture. The new checked-in
guest example `clamp_int(50,0,42)` is also byte-identical in the
two compiler repositories (Git object
`2e669b93812c64b05e80c4ba75f5e6cd529b7340`).
The accompanying evidence ledger and Node regression suite pin
these exact source and guest blob identities, cover 24 purely
modeled numeric boundary scenarios, reject changed source-byte
identities, and explicitly classify every compiler guest result as
`AUTHORED_UNEXECUTED`. The Forge native test is a **hosted C++ ELF
harness**, not freestanding/Cranelift parity. Zero host imports,
five-backend parity and independent approval have not been shown.

## LF byte-integrity checks for stage-1 and stage-2 fixtures

The conformance repository now also forces `*.atto` and `*.ores`
checkout to LF across platforms. The source-only workflow checks all
four checked-in Core/guest fixtures for CR, NUL, BOM, and final LF,
asserts that CRLF substitution changes their Git blob identities,
and compares the frozen identities against both evidence ledgers.
It reruns on changes to the numeric source fixture or checkout policy.
This preserves source-byte equivalence but is not a compiler-backed
guest conformance result.
