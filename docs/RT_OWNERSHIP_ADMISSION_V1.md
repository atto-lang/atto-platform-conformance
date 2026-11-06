# AttoLang rt ownership admission audit — 2026-11-06

**Status: CANDIDATE / NOT EXECUTED by any AttoLang backend.** This is a portable negative/positive source corpus and an evidence-*shape* validator, not a compiler fix, source-bound execution proof, or tenant-isolation attestation.

## Canonical surface

| Operation | Required static obligation |
| --- | --- |
| `rt copy value` | Copy proof; never manufacture a clone of move-only storage |
| `rt take value` | Transfer owner and invalidate source place even for Copy handles; projected sources require slot-level invalidation or rejection |
| `rt borrow value` | Read-only scoped loan; moving/mutably loaning an overlapping owner is prohibited while live |
| `rt mut borrow value` | Exclusive mutable loan; reject overlapping shared/mutable loans, unauthorized field access and invalid suspension |
| `rt share value` | Independent Copy **and** Share evidence, recursively including generic arguments and storage-domain rights |
| `rt mut share value` | Only explicitly synchronized, compiler-proven guarded handles; no unguarded mutable aliases |

`rt borrow mut` is legacy; canonical spelling is `rt mut borrow`. Pointer-style `&`/`&mut`, source `rt ref`, `rt deref`, `rt unref`, and user-source `Pointer<T>` are not admitted by the currently staged pointerless syntax policy. Compiler internals may have different representations.

## Inspected P0 defects on Java main

1. In `src/main/java/dev/oreslang/types/OwnershipChecker.java`, the `rt take` arm fails closed on an index but allows mutable class-field extraction without invalidating the field's ownership slot. This can duplicate otherwise transfer-capable authority.
2. In the same checker, `rt share` only checks `ValueKind.COPY`. Copyable handles are **not** automatically Share-safe; sharing also needs nested Send/Sync/Share and domain proof.
3. Consuming class-field/index values can still bypass whole-binding move invalidation, and unresolved names can fall into the generic Copy fallback. The existing repair work is staged in **Java PR #2197**; do not create a conflicting compiler rewrite.

The staged Java fixes for nested loan escape, canonical source parsing, and guarded mutable sharing are **#2098**, **#1841**, and **#2385/#2487** respectively. LLVM **#1245** intentionally rejects unsupported `rt mut share`. None of this constitutes verified five-backend parity. Confirm exact PR heads and executed-step tests before adoption.

## Candidate test matrix

`contracts/rt-ownership-admission-v1.json` contains **14** self-contained `.atto` source strings: 3 positive guest oracles (exit code 42) and 11 negative ownership-semantic admission cases. Their `reason` values are **proposed normalized diagnostics**, not diagnostic codes already implemented by each compiler. The new `UNTRACKED_SELECTION` fixture is an outer `rt take` on a ternary; LLVM child #1455 diagnoses it as `E_TAKE_UNTRACKED_SELECT`, while the Java nested source-place contract uses its own error text. Do not assert diagnostic equivalence until independently mapped and observed.

Additional uncovered risk cases are listed in `outstandingCasesWithoutValidatedSource`. A test rejected because a syntax form is unsupported does **not** prove the expected ownership invariant.

## Independent verification sequence

1. Compile each exact source string through each backend's real AttoLang frontend on a pinned compiler commit and source tree. Record the source SHA-256, compiler commit/tree, executed steps, exit code, diagnostic stage and code, and generated artifacts. No pretend compiler receipts.
2. Positive cases must execute actual guest programs and report exit 42; negatives must reach semantic ownership analysis, fail with a meaningful ownership diagnostic, and emit no executable artifact. Every receipt structurally asserts parser acceptance; negative receipts additionally assert that the ownership checker actually ran. Both fields require independent log/trace verification and cannot be self-attested into a pass. Source parsing failure or generic unsupported errors are a separate **BLOCKED** state.
3. Execute JUnit/GraalVM 25 + Native Image for Java, LLVM lowering/execution with ASan/UBSan for native, .NET Native AOT, Wasm worker boundary, and Forge independent native engine. Label unsupported behavior **UNSUPPORTED**, not passing.
4. Prove explicit move invalidation and live-loan exclusivity under conditional/loop CFGs, projections, aliasing, actor message send, nested generics, task/await/select/implicit cooperation and sealed state critical sections. On tenant transfers, separately validate capability and allocation-domain rights.
5. Obtain independent review of the exact source/test head; reconcile the open repair stacks before merging any compiler changes.

`src/rt-ownership-admission-v1.mjs` is deliberately *not* a trust authority: it only detects contradictions, absent steps, mismatched source digests, duplicated cases, parser-only denials, and guest oracles. Even a structurally matched synthetic receipt reports `STRUCTURALLY_MATCHED_UNATTESTED`; a genuine pass additionally needs independently checked Git blobs, compiler logs and runtime provenance.

Local source-free test command: `node --test tests/rt-ownership-admission-v1.test.mjs`. This does not compile AttoLang, does not change any backend compiler, and does not authorize exporting private repositories to CI carrier organizations.

## Canonical suspension fixture and structural receipt hardening (2026-11-06)

- Replaced legacy `pub async fnc main` in the borrow-across-await candidate with `pub suspends fnc main` to avoid a known unrelated parser rejection. The candidate is **not yet parser-verified on each exact backend head**; a syntactic admission error must be classified UNSUPPORTED/BLOCKED rather than `SUSPENSION_WITH_LOAN`.
- Added outer conditional `rt take (true ? left : right)` to distinguish source-place invalidation from merely evaluating a scalar conditional. This is a candidate negative, not a uniform five-backend diagnostic guarantee.
- Receipt checks now require `parserAccepted === true` for every case and `ownershipCheckerRan === true` for every semantic negative, with adversarial mutation tests. These are **necessary claimed facts only**; the validator remains UNATTESTED even when all fields match. Compiler logs and original exact Git source identity remain mandatory.
- The standalone validator test inventory is now 8 test groups; real Node execution, compiler-backed guest execution and native/AOT proof are pending until recorded execution evidence exists.
