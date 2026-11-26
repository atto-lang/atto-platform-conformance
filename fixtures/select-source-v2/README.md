# Static select source matrix v2 — all compiler targets

39 pinned guest sources x 11 target repositories = 429 explicitly tracked cells.
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

`run-native-counted-admission.py --backend forge|cranelift --compiler /path/to/compiler` verifies the thirteen counted fixture hashes, executes each actual compiler and 48 isolated syntax probes, checks absence of IR and runs a scalar control. This proves denial only, never positive counted guest parity.

Dynamic counted fixtures cover caller snapshot, zero count, non-int count and unresolved count. They are prospective targets, not execution receipts. Runtime invalid integer values require a separate trap-mode contract; they are not compile rejection targets.

Mixed Future alias and multi-channel FAIR fixtures are prospective targets. The mixed case requires one Future contribution across aliases; the FAIR case requires lexical arm projections, persistent rotation and no over-consumption. They must be compiled and executed before any positive backend receipt is recorded. The two new cases have unverified expectations for all eleven targets.

The distinct-alias projection fixture checks FAIR lexical ordering and different projections across repeated channel and Future arms. The retired Future alias must not contribute a second value. Prospective target cases must keep every backend expectation unverified until a separate execution receipt exists.
