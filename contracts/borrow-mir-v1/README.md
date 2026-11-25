# Actor-state borrow CFG / nine-backend conformance gate

**Status: model baseline only. No nine-backend executable parity is claimed.**

The companion `semantic-cases.json` is the same Git blob in each active
`atto-source.*` backend (Java, LLVM, .NET, Wasm, Forge, Cranelift, JavaScript,
Rust and HDL). Run:

```sh
node --test tests/borrow-mir-v1-contract.test.mjs
```

It checks 22 restricted *source-free* ownership CFG cases, bounded input
vocabulary, distinct owner/loan definitions, graph joins, and rejection of
unsupported operations or forged certification receipts.

## Evidence levels

A source-free model pass cannot establish that a real compiler emitted the
tested facts. Backend receipts must be independently bound to an exact
source commit, Git tree, Git blob inventory, compiler-produced typed-MIR
inventory, emitted instructions/diagnostics, executed runner steps, and
independent review. No self-reported `CERTIFIED` bit is trusted.

The Rust browser compiler draft PR #488 implements **restricted source-derived
V0 flat guards and V1 literal-condition four-block diamonds**, checked against
the standalone canonical Rust checker draft PR #46. Its exact-source private
run [44946623658](https://github.com/ores-data-platform/atto-ci/actions/runs/44946623658)
also proves the default-thread-stack 250-link addition regression now passes.
This is `HOST_ONLY`, **not** full typed CFG/NLL or guest certification.

## Native evidence audited 2026-11-21

**All nine share the exact source-free contract blob; NONE has general
compiler-authenticated typed MIR/NLL and guest parity certified.** The table
separates evidence that was actually executed from source-authored fixtures:

| Backend | Verified in this audit | Proven limit | New draft |
| --- | --- | --- | --- |
| Rust (`.rs`) | Bounded flat/diamond source-derived CFG with independent canonical Rust verification; browser host default-stack parser regression passed | `HOST_ONLY`; no general MIR/NLL or actor guest | [#488](https://github.com/atto-lang/atto-source.rs/pull/488) |
| Java (`.java`) | Nine-backend contract source aligned byte-for-byte | No Java native compiler/guest run in this audit | [#1726](https://github.com/atto-lang/atto-source.java/pull/1726) |
| LLVM (`.llvm`) | Existing nine-backend contract source aligned | No LLVM native compiler/guest run in this audit | Existing backend work |
| .NET (`.net`) | Existing nine-backend contract source aligned | No CIL/NativeAOT native borrow CFG run in this audit | Existing backend work |
| Wasm (`.wasm`) | Actor-state unsupported syntax rejects at bounded source preflight, **16/16 native source-policy tests executed** | `HOST_ONLY` preflight; no compiled actor Wasm guest | [#263](https://github.com/atto-lang/atto-source.wasm/pull/263) |
| Forge (`.forge`) | Existing nine-backend contract source aligned | No Forge native compiler/guest run in this audit | Existing backend work |
| Cranelift (`.cranelift`) | Existing nine-backend contract source aligned | No Cranelift native compiler/guest run in this audit | Existing backend work |
| JavaScript (`.js`) | Actual JS scalar compiler refuses actor-state guest source, **2/2 native compiler-denial tests executed** | Negative admission only; no positive actor ESM | [#115](https://github.com/atto-lang/atto-source.js/pull/115) |
| HDL (`.hdl`) | Actual HDL compiler refuses actor-state source before RTL emission, **2/2 native compiler-denial tests executed** | Negative admission only; no hardware loan proof | [#47](https://github.com/atto-lang/atto-source.hdl/pull/47) |

All 20 source-free conformance test assertions passed on
[GitHub Actions 44947329224](https://github.com/ores-data-platform/atto-ci/actions/runs/44947329224).
The same private runner passed 2 JS, 2 HDL and 16 Wasm actual source negative
tests; **154/154 tracked files were Git-SHA inventoried**. Rust's default-stack
250-addition/3000-operator regression passed on
[run 44946623658](https://github.com/ores-data-platform/atto-ci/actions/runs/44946623658).

The separate 92-target Rust browser test carrier still has **90 passes / 2
fails** on [latest exact source head run 44947522302](https://github.com/ores-data-platform/atto-ci/actions/runs/44947522302):
`fixtures` (partial mirrored pass/fail corpus count, NOT a current stack
overflow) and `private_ci_policy_contract` (private policy workflow deliberately
not installed as an executable workflow in the alternate organization). Do not
report `92/92` or change test thresholds to conceal these gaps.

These are **audited run-specific observations**, not evergreen certification:
rerun on the latest exact backend PR heads after any source change. No backend
is tagged `CERTIFIED` by this note. The source-free JSON manifest remains
`NOT_EXECUTED` for full compiler-derived CFG/NLL semantics.


`atto-source.atto` and `atto-source.realtime` are presently minimal
repository scaffolds, not functional additional compilers.

## Required native parity progression

1. Accept/reject the same canonical positive and negative `.atto` sources
   inside each backend's real parser and type checker.
2. Verify dynamic branches, independent read/write loan rights, last-use
   lifetimes, joins, loops, suspension, exceptions and cancellation; if
   unsupported, issue a stable diagnostic **before** code emission.
3. Cross-check real compiler-generated MIR with canonical Rust, not a
   separately invented fixture report.
4. Verify actual guest/native execution, including negative emission denial.
5. Maintain exact-head private CI and independent human/AI reviews under the
   existing ready-cycle policy.

This contract is intentionally fail-closed until all of those proofs exist.

## Core/cell owner policy extension — 11-target inventory (2026-11-22)

`core-cell-ownership-parity-v1.json` and
`tests/core-cell-ownership-parity-v1.test.mjs` extend the **separate
core/cell policy** inventory to Java, LLVM, .NET, Wasm, Forge, Cranelift,
JavaScript, Rust, HDL and the self-hosted Atto/Realtime scaffolds.
This does **not** change the established nine-compiler MIR/CFG contract's
certification scope.

All eleven draft backends now contain compiler-owned `.atto` core-cell
source candidates with conservative owner read/write/move/unpinned-suspension
predicates. Java/LLVM use a signed borrow counter; .NET, Cranelift, Forge,
Wasm, JS, Rust, HDL, self-hosted Atto and Realtime use bounded readers plus
writer-active policy. The latter two remain compiler scaffolds, not functioning
guest toolchains. No representation grants `Cell<T>` authority or replaces the
compiler.

Only Java and LLVM have new linked-core compiler-negative `.atto` test
fixtures so far; .NET has pinned CIL/test-interpreter policy candidate vectors,
JS and HDL retain actual negative *compiler admission* candidates, and the
other profiles add source-model or integrity checks. Each of the seven newly
expanded backend PRs has an exact-head, source-local, non-certifying policy
workflow. **All 11 compiled-guest and full typed borrow-MIR statuses remain
NOT_EXECUTED on their latest heads.**

Required real backend negative cases: use after take, local borrow escape,
conflicting shared/mutable loans, unpinned suspension, actor/domain boundary,
stale owner generation. Unsupported targets must fail before codegen; no core
API or integer helper may bypass compiler MIR or native guest tests.

The four backend core libraries remain independent .atto source files; parity
is defined by observable rights, not byte-identical source blobs. Source-only
test checks and synthetic counters must never be reported as compiler guest
or MIR borrow certification.

## Executable pure Cell policy versus compiler loan authority (2026-11-22)

The 11 independently owned `.atto` core/cell candidate sources now agree
that a saturated shared-loan count **rejects another acquisition**, while
an existing owner may still read. Java and LLVM use a signed 64-bit counter
with maximal shared state `9223372036854775807`; the other nine source
candidates use a bounded readers-plus-writer representation with a maximum
of `65535`. The conformance contract records both policies and does not
interpret these helper predicates as actual loan authority.

JS PR #137 now has a restricted production parser → typed IR → emitted
ESM path for its *pure* Cell policy; it was executed locally in V8 against
8 boundary states and rejected 8 adversarial source mutations. This is
**local non-certifying compiled policy evidence**, NOT a working
`Cell<T>`/borrow checker, a certified browser runtime or exact-head
source-owned CI. The policy's new Git source blob is
`ef1e84dbab1bb476d6ac55bf1802331660879732`.

.NET PR #220's authenticated resource pin was checked against the new
bounded-source bytes and corrected to SHA-256
`ad876ea26e04754e1a62cc85245860876dc8ed512645e30d5150a144e6b96ce3`.
Its CIL test now includes saturation and owner-read test vectors, but
no material exact-head compiler job has executed.

A source-free run on alternate carrier `channelsiege/atto-ci` (#45060723128)
completed five real steps successfully. It did **not** transfer private
compiler source, execute the eleven backend compilers or establish their
budget/export authorization. Atto source repository policies continue to
deny private-source mirroring to an unapproved carrier. All eleven
full typed borrow-MIR/compiled-memory guest statuses remain NOT_EXECUTED.

## Original nine-toolchain V1 design rationale

**Evidence: source-authored contract; NOT executed compiler parity.**

This contract fixes one common baseline for all nine active `oreslang-source.*` targets: `.java`, `.llvm`, `.net`, `.wasm`, `.forge`, `.cranelift`, `.js`, `.rs`, and `.hdl`. It is a *restricted, acyclic typed ownership-event CFG* vocabulary compatible with the **intent** of the Rust canonical V0 design. It is not an alternative full borrow checker. Its JavaScript tests exercise an independent **source-free model**, not compiler code, actual guest execution, or a trusted Rust differential check.

## Shared semantics

- `Init` produces a unique OwnerId on the full function, not just a branch. The same is true for `Borrow` and LoanId.
- `Copy` requires independently typechecked Copy evidence; `TaskCaptureCopy` requires both independently validated Copy and Send. Send never implies Copy.
- Move/Drop/TaskCaptureMove invalidate the original owner and cannot overlap a live loan.
- Multiple shared loans are permitted; a mutable loan excludes other loans. Owner writes overlap any live loan; `WriteThrough` requires the matching exclusive loan.
- Borrow/owner operations on unknown or moved places fail closed. Each terminal CFG block needs a distinct `Return` with no live loans.
- The restricted V0 admits only acyclic CFGs with consistent incoming ownership states. Divergent joins, raw actor-hop borrows, loans crossing suspend, unknown effects and foreign calls reject.
- Real AttoLang must eventually support sound loops, projected place trees, compiler-owned trait provenance, pinned continuation loans, cancellation, actor state, unwind/drop glue and arbitrary CFG joins. Current V0 rejections are limitations, **not permanent language rules**.

## What each compiler must implement

**Java/GraalVM:** continue integrated `OwnershipChecker`; use its typed MIR event producer. Its `atto-borrow-mir-v1-java-shadow` observer is intentionally **not** the canonical contract: ordinal event IDs, limited Copy return profile, no emission inventory.

**LLVM/C++:** use native `OwnershipCfg.hpp` and compiler-issued loan/write identities. Validate source-to-typed-MIR lowering and LLVM load/store/drop emission, including CFG and lifetime edges. No self-minted "pass" from a host-only model.

**.NET/C#:** typed CFG admission before CIL and NativeAOT, with explicit lifetime/loan operations. The existing scalar SSA subset has no general actor borrow checker.

**Wasm:** typed source frontend and owned linear memory/worker transfer fences; JS host runtime tests alone do not prove guest borrow checking.

**Forge/C++:** source frontend and verified IR before JIT/AOT emission; narrow scalar-only acceptance is legitimate, but not ownership parity.

**Cranelift/Rust:** typed frontend before CLIF lowering; can link the canonical Rust library directly when supported, but must authenticate source facts and exact generated program and reject unsupported operations.

**JavaScript (.js):** JS source-to-IR compiler and Node/browser workers must carry real ownership facts into output; source-free JavaScript actor and scalar model tests do not prove borrow checking.

**Native Rust (.rs):** independently authored Rust backend and typed CFG/MIR need explicit owner/loan dataflow and emission proofs. The separate canonical `atto-borrow-checker.rs` is a reference verifier, not proof that the native `.rs` backend consumes it.

**HDL (.hdl):** hardware-oriented compiler must reject unsupported dynamic actor borrows and mutable aliasing before RTL emission. Hardware memory-port exclusivity, borrow lifetime, reset and pipeline hazards need hardware-specific evidence; a scalar Verilog testbench is not general ownership proof.

## Evidence promotion

Manifest `evidence[backend].status` starts **NOT_EXECUTED** for all nine. The test suite intentionally never returns `verified:true`, including for a synthetic self-contained receipt.

To count a *real* compiler differential result, bind independently:
1. Exact Git source commit/tree and complete path/mode/blob SHA manifest.
2. Compiler-version/toolchain identity plus actual runner admission, executed steps and logs.
3. Independently enumerated compiler-generated typed MIR (NodeId/PlaceId/LoanId/WriteId, type and effect proofs) and instruction count.
4. Verified emitted code/instruction inventory or exact compiler semantic-negative diagnostics.
5. Successful compiled `.atto` guests, NativeAOT where applicable, and one independently reviewed receipt per backend.

No source-free Node pass, zero-step GitHub run, fabricated `CERTIFIED` flag, or source-authored unit test is allowed to promote compiler parity.

## Native backend parity checkpoints

Run `node --test tests/borrow-mir-v1-contract.test.mjs` for a *source-free contract check*. Then run actual compiler-backed positive and negative fixtures against the same **logical cases**, with backend specific IR adapters and stable diagnostics. A feature the backend does not implement must **reject** before code emission, not silently skip the ownership event.

Related canonical Rust [PR #5](https://github.com/ores-truffle-oreslang/atto-borrow-checker.rs/pull/5), Java [PR #2752](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2752), and [borrow-checker consolidation issue #3](https://github.com/ores-truffle-oreslang/atto-borrow-checker.rs/issues/3).

**Security:** private Git trees must not be exported across organizations without the protected private CI destination+snapshot authorization. Keeping identical contract blobs inside the original private source organization does not authorize alternate-org mirroring.
