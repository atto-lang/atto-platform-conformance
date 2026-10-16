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
