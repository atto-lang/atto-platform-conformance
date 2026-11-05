Five AttoLang portable policy modules: source-only evidence contract.

Pins Java/GraalVM PR #2553 head and tree and the five actual AttoLang source blobs.
Other backend slots are explicitly NOT_EXECUTED. The Java slot is RUNNER_ADMISSION_FAILED.
This is not guest/compiler parity, permission to allocate, schedule or merge.

Validate with: node --test tests/atto-stdlib-policy-v1.test.mjs

Source-only evidence cannot claim a positive result via invented runner steps,
source hashes, fake CI receipts, independent approval or a swapped backend.
Future promotion requires actual authenticated exact-head native compiler/guest
execution, negative mutations, reviewer approval and protected-main checks.
