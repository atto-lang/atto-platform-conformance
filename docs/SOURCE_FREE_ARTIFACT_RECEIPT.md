# Source-free GitHub Actions ZIP receipt integrity gate (draft)

This is a read-only **artifact-byte validation** complement to wave 11's independent run/job/step/PR/workflow checks, which previously inspected only artifact metadata. The ZIP/report is never accepted as GitHub-signed proof. Native Oreslang compiler execution, guest semantics, actor runtime parity, and five-backend certification are **not** established by this gate.

## Executed local evidence (2026-10-17 UTC)

- `python3 -m unittest -q tests/test_source_free_receipt.py`: **28/28 passing**, zero skipped, Python 3.13.
- Actual downloaded **source-free only** carrier run [#38996750516](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/38996750516), unexpired GitHub artifact ID `12087306517`, ZIP SHA-256 `f6f2f42fbb614ca5f7b9b5defa5e6eace150ffeeb29be268059b9a93efcea901`: receipt validated against independently selected run/attempt/HEAD/tree and three reviewed Git blob pins.
- The historical receipt claims **77 tests × 3 rounds = 231 source-free tests**. The exact same ZIP is correctly **rejected** with `--min-tests-per-round 80`. The newer 80-method five-backend test version **has not been executed by this check**.
- Verified exact Git blobs for these files on this PR branch after upload: validator `047d403938742ca634801f9abb318fb68ffbaccf`; tests `7ad78d33e4db7afea564f980af5108f3333a72a0`. These match the locally executed bytes.

## Inputs and security invariants

The caller must independently pin `--zip-sha256`, `--head`, `--tree`, `--run-id`, `--attempt`, `--schema`, `--workflow-blob`, `--verifier-blob`, `--tests-blob`, `--min-tests-per-round`, `--min-rounds`. Do **not** derive expected values from the untrusted receipt being checked. The artifact is bounded to 64 KiB; its sole exact JSON member is bounded to 32 KiB. No archive extraction to disk, no symlink/hardlink source, no redirects, no private source copying, and no code execution from ZIP. Duplicate keys, invalid UTF-8, nonfinite/oversized number tokens, forged native assertions, unexpected fields and wrong test inventory are denied.

For the historical receipt set `--member 77-parity.json`, `--schema oreslang.source_free_ci_verifier_77.v1`, `--min-tests-per-round 77`, `--min-rounds 3`. Use the exact report identity and blobs read independently from the GitHub Actions run. Raising the minimum to 80 MUST fail. The command prints `SOURCE_FREE_RECEIPT_INTEGRITY_VERIFIED` only for receipt format and byte integrity, and always sets `actual_job_execution_independently_verified:false`, `native_compiler_executed:false`, `guest_runtime_certified:false`, `five_backend_parity_certified:false` and `release_certified:false`.

## Independent gates still required

A separate authenticated GitHub run/job/step proof must establish the **exact** source-free test execution. To claim Oreslang parity, each source backend must separately pass real compiler, AOT/guest and runtime tests on a pinned source tree, with independently checked artifacts. All source `main` branches currently report no protection and the approved private CI destination list is empty; this change does not approve a source transfer, trigger a build, merge a security policy or add credentials.

**Keep DRAFT** until independently reviewed and the repository's CI genuinely executes this new suite.