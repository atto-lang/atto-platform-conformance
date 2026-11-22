# Core slice + error behavior contract v2

This is a **candidate**, not source compilation or real guest execution.
The JSON file contains signed i64 string vectors, checked owned-copy
`Option<int>` cases, Error numeric catalog conditions and nine negative
lifetime/exception admission requirements. All cases remain NOT_EXECUTED
until exact-head stepful compiler and guest evidence has been reviewed.

`node --test tests/core-slice-error-v2.test.mjs` runs an **independent
BigInt model oracle**, not any AttoLang compiler. The model check is useful
for identifying regressions in constants and arithmetic but cannot replace
compiler typechecking, guest execution or nominal class identity proofs.

Reconcile candidate spec atto-spec #31, Java core #1768, LLVM #867, and
the sibling nine-backend slice/iter/cmp draft PRs. Backend-specific source
is maintained independently, not shared as canonical byte-identical files.

No one should flip backend_evidence to VERIFIED without a real source
commit SHA, identical tested tree, nonempty CI steps and guest results.

## API reconciliation (22 November 2026)

The sibling slice/iter/cmp PRs treat `valid_index` as raw, nonnegative
logical indexing. Java #1768 and LLVM #867 now agree and reserve
`valid_signed_index` for negative-index normalization. The v2 corpus
adds ten vectors for both forms, split-at bounds and empty count handling.

## Owner-preservation regression fixtures

- `fixtures/core-slice-error-v2/borrow-copy-positive.atto` demonstrates
  an array borrowed for repeated `Option<int>` reads, then mutated, with a
  copied earlier scalar remaining independent. Expected guest exit: **42**.
- `borrow-copy-exclusive-negative.atto` must be rejected under a live
  exclusive mutable loan, even when the requested index is invalid.
- `borrow-copy-moved-negative.atto` must reject use after consuming the
  array owner by value, again before returning a possible `None`.

The Node harness checks that these unadmitted fixtures and their status
markers remain present; it **does not** parse or execute Atto guest code.
Compiler-specific diagnostics and AOT behavior remain pending. Export to
other organizations requires protected-source approval, verified private
carrier and a successful material capacity probe.
