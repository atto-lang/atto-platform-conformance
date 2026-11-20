# AttoLang MessageData v1 (issue #310)

**Draft fixtures and source-free receipt shape gate; no exact-head guest tests have executed.** This new code stays inside the private source organization; it does not mirror private compiler trees into another organization.

The 4 positives and 10 core negatives use 14 cases; N07/N08 deliberately require a native hostile-host injection harness (there is no safe .atto syntax for fabricating an FFI bound method). The 2 supplemental nominal class rejects are mandatory until an owner-free nominal ABI exists. Use the `.atto` files identically across Java/GraalVM, LLVM, Wasm, independent Cranelift and .NET NativeAOT. Compiler-negative results must reach semantic type checking: parse errors, no-step jobs, host-only models and mocks are not qualifying evidence.

Host/runtime supplementary checks include graph cycles, depth >128, nodes >65536, hostile container callbacks, >256 select cases, mutation-after-registration snapshots, nominal Evaluator ownership, ActorRef Topic rejection and stable FAIR cursor. `Sendable` != `MessageData`; codecs/serialization must not launder callable or capability values.

Use `node --test contracts/v1/message-data-310/verify-evidence.test.mjs` to run **synthetic** gate tests. Once authenticated exact-head native guest receipts exist, use `node contracts/v1/message-data-310/verify-evidence.mjs contracts/v1/message-data-310/manifest.json receipts.json` to deny missing or misclassified results. This checks the supplied receipt structure and fixture digests, **not** cryptographic signing, GHA provenance or whether supplied digests represent actual artifacts; separately inspect CI run/job/step and binaries.

**Do not cross-org export private compiler source:** incident #22, Java #1501 and #962 still require an independently reviewed source policy, numeric destination ID, verified private visibility and an approved protected allowlist.

## Trusted manifest / fixture path hardening

The CLI **fails closed** unless the caller sets `ATTO_MESSAGE_DATA_MANIFEST_SHA256` to the digest independently pinned from the approved protected main policy. Setting the value from the untrusted PR checkout is not an approval. The CLI also rejects symlink/nonregular fixture paths before hashing. The compiled guest and CI receipts still require independent verification beyond JSON structure.
