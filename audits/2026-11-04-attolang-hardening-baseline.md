# AttoLang multi-backend audit and hardening baseline — 2026-11-04

**Scope:** AttoLang source semantics, compiler/runtime isolation, five backend
implementation lanes, and provenance/security of acceptance evidence. This is
a **risk and gate inventory**, not a statement that every repository was
compiled or every runtime surface was exhaustively inspected.

## Critical findings and active actions

| Priority | Risk | Evidence/required action |
| --- | --- | --- |
| P0 | GitHub Actions failures before any steps | Java/LLVM/spec/Wasm/.NET/Forge guard draft workflows have `steps=null`. Classify **NOT_EXECUTED**; do not attribute failure to the compiler, assert exhausted minutes, or merge based on empty runs. Obtain administrator annotations and source-local zero-checkout canary with an assigned runner and executed steps. See LLVM issue #159 and Java issue #963. |
| P0 | Unauthorized private source export | No inferred permission from an unrelated private repository's available Actions minutes. Match immutable numeric destination ID, allowlist, exact source tree, incident status, and independent reviewer **before** any Git data write. Token-free cross-org mirroring is still source export. Pending security issues include Java #2307, conformance #263 and carrier policy reviews. |
| P0 | Evidence confusion | File-presence tests, parser admission, compiler IR generation, linked executable, native AOT run, sanitizer run and actual AttoLang guest execution are distinct. Require exact head/tree and blob identity, job ID/attempt/runner, nonzero steps, compiler artifact identity, negative rejection without emitted IR and independent review. This change adds `lib/guard-v1-evidence.mjs` and adversarial tests; a shaped receipt remains a **candidate**, not verified guest evidence. |
| P1 | New guard syntax incomplete | Java #2517 and LLVM #1387 contain authored boolean control-flow implementations; `guard name is Some` still rejects until ownership-checked narrowing across the type system, borrow checker and runtime. Wasm #285 currently carries contract fixtures only. .NET #353 and Forge #181 additionally contain authored explicit fail-closed source admission for unsupported guard syntax, including rejection tests; those compiler paths have no executed guest proof. See `contracts/guard-v1.json`. |
| P1 | Source dialect drift | Public syntax is `.atto`, `fnc`/`routine`, `suspends`, `critical`, and explicit ownership. Reject obsolete `async fnc`, forbidden `critical suspends`, removed source operators and implicit conversions unless a separately documented migration allows them. Preserve legacy repository names without treating historical `.ores` snapshots as new conformance evidence. |
| P1 | Task/actor isolation and ownership | Require compiler-issued, generation-fenced authority for actor/task/thread/request locals, tenant heaps, actor turns and hot upgrade. Host tables and synthetic scheduler tests do not prove guest-level no-leak, cancellation or reclamation. |
| P1 | Failure cleanup and suspension | Verify `defer`, `recover`, typed exceptional effects, TCO, guard return, cancellation, select winner commit and critical-section release across continuations; prove no thread/carrier blocking on backpressure. |
| P1 | Native parity gaps | Java, LLVM, .NET NativeAOT, Wasm and Forge/Cranelift must execute identical input bytes with the same observable values, rejections, ownership and cleanup outcomes. A backend's source-only contract does not count as implemented. |
| P2 | Tooling and fuzzing | `atto test`, `--fuzz` and `--race` require real backends, sanitizer receipts, finite quotas and deterministic failure classification; avoid labeling sanitizer compilation a guest pass. |
| P2 | Ecosystem surface | Validate package-root imports, JSON/HTTP borrow-only request view, pub/sub backpressure, LRU layouts, JS/Wasm transpilers, MCP dev control plane and reproducible native release packaging only after core compiler/effect/ownership checks. |

## Fifteen semantic lanes (execution-first)

This matrix follows the gaps cataloged in conformance issue #309. Every row
requires both positive and negative pinned `.atto` guest receipts for each
backend before certification. `PENDING` explicitly means **not certified**.

| Lane | Required property | Status |
| --- | --- | --- |
| Checked scalar arithmetic | i64 overflow, sign, no removed operators | PENDING |
| Static typing | no implicit conversions, checked casts | PENDING |
| Binding ownership | immutable locals by default; `let` mutable | PENDING |
| Portable bit operations | shift bounds and platform-identical results | PENDING |
| Option/Result | tagged values, no implicit flatten, controlled panic | PENDING |
| ADTs/patterns | exhaustiveness, overlap and binding soundness | PENDING |
| Classes/methods | nominal identity, explicit ownership and arity | PENDING |
| Imports/modules | package-root authority, cycle diagnostics | PENDING |
| Generics/macros | hygienic AOT specialization, bounded expansion | PENDING |
| Critical/suspends | non-suspending locked regions and explicit effect | PENDING |
| Tasks/futures | structured ownership, cancellation, exact-once wake | PENDING |
| Actors/mailboxes | nonreentrant turns, quota limits, generation fencing | PENDING |
| Groups/pub-sub | per-edge FIFO, backpressure, leave/publish races | PENDING |
| Native arenas/tenants | teardown, zero-GC profile evidence, isolation | PENDING |
| Async I/O | carrier nonblocking, HTTP/QUIC/TLS capability bounds | PENDING |

## Gate ordering

1. **Administrative runner admission:** obtain real source-local stepful canary;
   do not bypass security restrictions by copying private source.
2. **Language/AST/borrow:** approve canonical grammar and negative fixtures,
   prove cleanup and ownership. All source modifiers and binding scopes must
   have identical meaning; compiler must fail closed for unlowered forms.
3. **Java + LLVM:** run the shared guard `.atto` corpus through genuine
   compiler and guest, plus O0/O2 and native sanitizers where applicable.
4. **Wasm/.NET/Forge:** implement and prove the same case outcomes, separate
   from reference-model-only contracts.
5. **Expand by lane:** use existing conformance reports and assign a concrete
   owner/exact PR head to each divergence; perform independent review before
   merging draft compiler work.

## Guard v1 provenance (read-back, not runtime proof)

The following Git blobs were fetched on **all five source branches** and were
byte-identical; the conformance repository copies were verified against them:

- Scalar positive: `c86ac476e55074031c0bcda02f5eaf3cb1399477`
- Failure fallthrough negative: `1ff87aa95ed2537839347e80984c69ae46fdfa17`
- Invalid postfix else negative: `b2bbee98cd3b95ac19462b4efd95a2e98b469154`

No source-private cross-org transfer was performed for this audit. The
source-free evidence gate cannot authenticate a forged hosted receipt; it
returns only `CANDIDATE_REQUIRES_LIVE_VERIFICATION_AND_INDEPENDENT_REVIEW`,
even with all required metadata populated. It rejects null/empty job steps,
unknown/mismatched repository identities, negative result omissions, wrong
source blobs and missing private-carrier authorization. True verification
requires independently retrieved live API logs and actual compiler execution.
