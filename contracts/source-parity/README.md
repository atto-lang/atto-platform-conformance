# Five compiler shared-contract SHA audit (November 11, 2026)

This is a **frozen, read-only Git metadata snapshot**, not live compiler
execution. All five private `oreslang-source.*` main HEADs and their
immutable Git tree IDs are pinned in the manifest. The inventory covers
the 166 `contracts/` paths ending in JSON, TSV, ATTO or ORES that
were present in at least two repositories.

At those exact main commits, 155 shared contract paths have identical
Git blob SHA-1 values among their participating backends and 11 diverge.
Of nine paths shared by all five, eight match exactly. The ledger
classifies each divergence instead of assuming every backend-specific
capability record ought to be byte-identical.

Three source-local draft PRs propose narrower convergence:
Wasm #464 (GPU task v2 case name), Forge #255 (four tuple soundness
negative cases), and Java #2871 (eight padded permission rules).
If they land exactly as written, the shared-path divergence count
would decrease from 11 to eight. **They are not merged on the
snapshot date.** The checker fails if this proposed state is
misrepresented as production `main` or as guest certification.

The JSON includes only file paths, SHA hashes, immutable source heads,
classification labels and PR URLs. It contains **no private source bytes,
no credentials and no compiler runtime artifacts**.

Run locally (no network needed):

```sh
python3 -I contracts/source-parity/check_five_backend_shared_contract_shas.py --self-test
```

The validator proves the receipt's bounded, exact, negative-tested
shape. It does NOT re-fetch private GitHub trees or run actual
Java/GraalVM, LLVM, Wasm, .NET Native AOT or Forge compilers.
Only separately authenticated, per-backend executed guest receipts
can promote a compiler- or runtime-parity claim.