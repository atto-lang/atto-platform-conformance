# Executable identity checks for five-backend conformance

The shared `runSuite` harness is parameterized by the five source compiler backends: `java`, `llvm`, `net`, `wasm` and `forge`.

For **configured** invocations it now records:

- the caller-declared source revision (a claim, **not** independently attested compiler provenance);
- the initial compiler executable SHA-256 and identity attributes (device, inode, size, mode, modification/change timestamps);
- a SHA-256 of the complete argument vector (including the exactly-once `{file}` placeholder);
- the harness Node version, platform and architecture;
- the executable SHA-256 observed before and after **each** fixture invocation.

Any observable executable disappearance, replacement, symlink swap, or mutation sets `executableDriftDetected=true`. Earlier apparently passing fixtures are retroactively marked `EXECUTABLE_CHANGED`; the overall suite cannot be green. An executable symlink is not eligible for identity attestation in this restricted v1 profile.

## What this does not prove

A pre/post digest cannot prove that the kernel executed the measured bytes or that an upstream compiler was built from the declared source revision. A malicious or untrusted wrapper/host, an in-place mutate-and-restore race, dynamic libraries, JIT state, compiler plugins and generated downstream tools remain outside this proof. Production certification requires a trusted, immutable build artifact and independently captured source-tree SHA, exact run/job/step receipts, and all native/guest and negative tests.

The regression suite includes synthetic stubs that return deterministic accept/reject outcomes. Those tests validate **harness admission**, never production guest execution or five-backend language parity.

No private compiler source may be exported to another organization to run these tests unless the separate protected-main private-CI authorization chain is complete. A zero-step Actions failure is `NOT_EXECUTED` and must not be relabeled as an executable conformance result.

Related: #37 (five-backend evidence parity), #44 (compiler executable drift).
