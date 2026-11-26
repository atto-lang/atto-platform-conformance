# Static select source matrix v2 — all compiler targets

40 pinned guest sources x 11 target repositories = 440 explicitly tracked cells.
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

Mixed literal zero requires lexical type checking without source evaluation, capture, waiter registration or producer consumption. The target fixture remains unverified for all eleven compilers until exact guest evidence is recorded.

The separate `counted-profile-evidence.json` ledger records observed exact fixture outcomes on proposed PR heads, with restricted compiler profile, source identity, real CI job and explicit limits. It is not a promotion of the prospective matrix or a merged-main/general scheduler claim. Run `node --test fixtures/select-source-v2/verify-counted-profile-evidence.test.mjs` to verify ledger integrity only. The self-hosted Stage-0 scalar seed has no general source CLI; its counted target remains not executed.

The profile ledger now contains 126 observed fixture/profile cells across ten targets, including actual LLVM ready-only native guests, refreshed JS/.NET guest receipts and additional Rust, Wasm, HDL and Cranelift admission receipts. The prospective 440-cell matrix includes both mixed literal zero and distinct lexical projections. The self-hosted Atto compiler remains not executed for counted selection.

The distinct-alias projection fixture tests FAIR lexical ordering with repeated channel and Future arms, preserving distinct arm projections after Future alias retirement. Prospective target cases remain unverified in the source-only matrix; execution receipts belong in the separate profile ledger.

The distinct lexical projection guest now has independently executed JVM and JavaScript profile receipts. The original mixed-zero observations are retained; disjoint fixture cells for the same profile may cite different exact compiler revisions, but duplicate cells fail closed. Neither observation asserts general actor scheduling or Native Image parity.

The distinct lexical projection fixture also passed on the .NET NativeAOT and LLVM static-C++/Clang ready-only profiles. Four distinct compiler profiles now execute the same exact guest bytes. See the exact source-head, carrier/job and scope in the ledger.

Rust, HDL and real-time exact-head compiler admission checks reject the distinct alias guest before artifact publication. These are unsupported outcomes, not positive guest execution.

Forge, Cranelift and Wasm also reject the distinct alias fixture in the actual compiler admission gates. Across ten observed backend profiles, four execute the guest and six reject as unsupported; the self-hosted Atto compiler remains unexecuted. No ESM capability is inferred for the browser compiler.

Rust and Wasm now have separately verified explicit counted-ready-v1 execution profiles: the native Rust CLI and wasm32 compiler produce byte-identical guest modules, and real Chrome dedicated Worker compilation and execution passes the same ten positive and seven negative fixtures. The earlier ordinary-profile unsupported receipts remain historical, distinct evidence. These are two backend execution profiles using the same Rust compiler family, not two independent compiler implementations. The prospective 440-cell source contract remains unchanged.
