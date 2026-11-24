# LLVM protocol mailbox conformance

The driver emits host protocol IR from the shared Connection, Payment, and standalone actor sources, compiles it with Clang, and links the native source actor scheduler and C host. The assertions exercise generated typed sends and encoders, detached frame storage, wire agreement with the shared JavaScript reference, signed payload bounds, transition receipts, full-queue backpressure, abortive stop, and stale actor identities.

Run this from the conformance checkout with an exact-source build of `oreslang-llvmc`.

```sh
node bin/verify-verified-core-protocol-mailbox-llvm.mjs \
  /path/to/atto-source.llvm /path/to/oreslang-llvmc /path/to/clang /path/to/atto-common-source
```

Set `ATTO_PROTOCOL_SANITIZE=1` with a working Clang ASan and UBSan runtime to instrument the scheduler, runtime, and C host. On macOS the lane also supports Apple Clang for this run.

The runner prints repository commit and tree identities, source digests, compiler and artifact digests, and the target triple. The host profile uses copied scalar frames and runtime dispatch guards. [Verified Core mailbox profile](https://github.com/atto-lang/atto-spec/blob/feat/verified-core-quantities-v1/proposals/verified-core-protocol-mailbox-v1.md)
