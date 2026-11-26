# Static select source matrix v2 — all compiler targets

32 pinned guest sources x 11 target repositories = 352 explicitly tracked cells.
The v1 directory remains unchanged. Existing expectations are carried forward
only as historical prospective expectations; new cells are unverified.
The `target` field records intended semantics of newly added sources separately
from the backend expectation. In particular the value expression is a target,
not proof that it compiles today. The historical typed-default fixture uses
`do select<int>`, not the canonical value-expression form; it is retained as
an unsupported/legacy admission probe.

Every backend must run the exact fixture bytes, or report an explicit
unsupported capability. For HDL/realtime, document the profile's verified
execution/admission boundary; never infer general scheduling parity.
Record compiler commit/root tree, toolchain, exact command, actual executed
steps, exit/diagnostic, no-artifact negatives and artifact/guest receipts.
A manifest check, runtime-only oracle or no-step CI is not compiler evidence.

Run `node fixtures/select-source-v2/verify-manifest.mjs` and
`node --test fixtures/select-source-v2/verify-manifest.test.mjs` for integrity only.

The Nov 25 Future-by-default decision supersedes the original blocking value
fixture. Canonical select returns Future<T>, await is explicit, nb select is a
deprecated tracked alias, and select<T> specifies the arm result. New target
fixtures cover those forms, result mismatches, generic arity, implicit await,
missing result and illegal await effect. These are unexecuted target fixtures.

Counted select target adds exact cardinality, ordered batch, zero, one, alias, and invalid count/type/default/write cases. All are unexecuted targets.
