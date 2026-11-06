# Application formal verification: non-promoting receipt-shape gate v1

Run `node bin/verify-application-formal-receipt-v1.mjs RECEIPT.json` to validate
**claimed** source, model, guest, and product trace identities. The validator
**does not independently authenticate** GitHub API results, compiler binaries,
source reproducibility, approval, or physical guest execution. Its success
message is intentionally `provenance=UNAUTHENTICATED`.

The receipt requires six top-level fields (`schema`, `claim`, `source`, `model`,
`guests`, `production`). Canonical JSON files must contain only documented
fields and use two-space JSON serialization with a terminal newline, preventing
ambiguous duplicate-key input. The source binds an exact `.atto` Git blob SHA-1
and source head SHA. Each model or guest claims a unique completed successful
GitHub Actions job and *positive* executed step count, rather than treating a
zero-step failed run as proof. Guest entries also pin the canonical backend
repository, compiler binary SHA-256, tested source Git blob, exact stdout
SHA-256 and at least one negative compiler admission case.

Supported `claim` stages:

- `model-only`: a bounded model and its run; **no** guest or product assertion
- `compiler-guest`: at least one independently executing Java/LLVM/.NET/Wasm/Forge compiler guest
- `production-refined`: compiled guest **plus** separately run product trace comparison with zero mismatches
- `five-backend`: **five distinct** real compiler guest receipts, not one compiler or five source-free fixtures

Every guest receipt must match `source.gitBlobSha1`; every Actions run must
bind its claimed repository and exact head. The shape gate rejects all absent,
zero, negative, non-integer and duplicate critical fields, stale source blobs,
unsupported backends, and cross-stage overpromotion.

**Security boundary:** This gate validates only consistency of a supplied JSON
object. A malicious actor can author a syntactically valid receipt, including
invented job IDs and digests. A trusted promotion controller MUST fetch GitHub
run/job metadata using authorized read-only credentials, verify actual executed
steps, run attempt and outcome, independently retrieve/pin compiler and input
artifacts, compare real outputs and negative controls, then require independent
review. No private-source mirroring, token handling, or artifact upload is
performed by this code. A `PASS` here is not a compiler result, production
refinement, five-backend parity, or deployment authorization.
