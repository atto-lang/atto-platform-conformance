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
