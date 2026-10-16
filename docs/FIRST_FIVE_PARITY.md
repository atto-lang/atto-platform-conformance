# Five-source parity batch 1: real admission gates (tasks 1–5)

This branch adds an **auditable, non-promoting** inventory to coordinate five
existing workstreams. It does **not** implement the missing compiler features,
run a backend, or certify any source implementation. `npm test` checks inventory
structure; `node bin/validate-first-five.mjs` emits a fingerprinted status report.
Neither is compiler evidence.

| # | Feature | Implementation to review | Mandatory proof before promotion |
|---|---|---|---|
| 1 | Canonical grammar/methods/captures | Java #1087 and linked LLVM #479, .NET #40, Forge #36, Wasm #38 | Real parse, type-check, hard-reject unsupported programs; distinct diagnostics from crashes |
| 2 | Nominal/structural typing and generics | Java #819, common-source issue #45 | Writable record invariance, structural readonly, method variance, and sound generic specialization with negative controls |
| 3 | Root imports and package confinement | Java #1050, LLVM #466/#448 | Real multi-file source compile/link, physical root/symlink confinement and module identity, not a host-only path test |
| 4 | Ownership/borrow checker | Java #740, LLVM native loan work | Use-after-move, projected aliasing, implicit suspensions, negative diagnostic and guest release/cleanup outcomes |
| 5 | Shared experimental typed HIR/MIR | Common-source #28; issues #2–#7 | Versioned verifier, exact-source Java+LLVM adapter execution, independently validated provenance and rollback |

Each entry's `statuses` are **planning statuses**, not runnable coverage.
`pending` means an implementation branch or investigation exists but the
specific full acceptance contract is not independently proven on a pinned
revision. `unsupported` means the target backend has not implemented that
full contract; it is not a passing compile rejection. The registry intentionally
forbids `verified` until a separate authenticated evidence system is adopted.

## Security and review rules

* Never report unsupported syntax as a successful semantic implementation.
* Parser accept/reject alone is not type, ownership, multi-file linking, or runtime evidence.
* Never treat mock compilers, fabricated JSON, missing jobs, or zero-step CI as proof.
* Pin source commits, executable hashes, exact fixture blobs, workflow/job IDs,
  real executed steps and successful job conclusions before approval.
* Private source must not be exported to an unapproved carrier even if both
  organizations appear accessible. Follow the conformance private-publisher gate.
* All cross-backend PRs remain independently reviewable; Java leads the language
  behavior only where the shared contract and test results support that choice.

The next increment should add a real executable positive/negative source fixture
pair for each track to the existing conformance harness, without changing the
current two-case smoke manifest until the real compilers' flags and diagnostics
are validated. HIR/MIR IR fixtures belong in the common-source verifier suite.

## Cross-backend comment/import boundary — Oct 16, 2026

A consistent source-admission rule is required even before each backend has a
complete module graph: a `//` comment ends on LF, CRLF or CR alone. CR-only
line endings cannot swallow a subsequent real `import` token and cannot
produce an apparently valid partial artifact. An import inside a properly
nested block comment is not an executable import. A scanner that cannot
reliably classify the source must reject the source, not publish output.

| Compiler | Existing PR with new regression | Scope |
| --- | --- | --- |
| Java/Graal | [#1050](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1050) | Lexer recognizes CR/CRLF; lexical import remains source-visible; package resolution tests still pending |
| LLVM | [#466](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/466) | Experimental import preamble preserves CR/LF source-byte offsets, not complete module linking |
| .NET Native AOT | [#41](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/41) | Both scalar and structured parsers reject CR-hidden unsupported import tokens |
| Forge | [#38](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/38) | Scalar lexer explicitly rejects unsupported imports after CR-only comments |
| Wasm | [#41](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/41) | Single-source preflight rejects CR-hidden imports before compiler launch/artifact publication; nested comment/NUL admission hardening |

**Evidence limitations:** the exact GitHub LLVM `ImportPreamble.hpp` header
(blob `182157658f5e031de3c6622acabe295e940e1b7e`) and its complete
`native_import_preamble_test.cpp` (blob
`89b5304dc1087e0833286d69fc0442b724c5e22c`) were reproduced
byte-for-byte locally (matching `git hash-object`), then compiled and
executed successfully under strict GCC C++17, Clang C++17 and GCC ASan+UBSan;
the latter test includes 15,000 seeded malformed-preamble fuzz inputs.
The Wasm scanner had a separate five-test isolated Node 22 reproduction pass,
**not** a full exact-blob bridge test. Neither the .NET nor Forge compiler was
executed in this audit. Full Java/LLVM/.NET/Forge/Wasm compiler parity remains
**UNVERIFIED**; the conformance inventory must not promote any unsupported
feature from these narrow checks.
