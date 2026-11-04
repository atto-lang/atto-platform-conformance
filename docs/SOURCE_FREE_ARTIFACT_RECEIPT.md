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

## Persistent actor 47x3 receipt profile (2026-10-17 UTC)

The persistent actor policy suite has advanced beyond the older 37/44-case receipts. The current five backend parity branches share these exact source-free Git blobs:

- contract `83a40f637ab77437108d02fedc8cde997f753928`
- verifier `e423ef5aef92a48eb1fb5c38578b986f20da2130`
- tests `544fca635d7ab77b6496b0a6c917bf17302b2ce0` (**47 distinct tests**)

A new private source-free carrier run [#39075802504](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/39075802504) executed all **47 tests in three isolated rounds = 141/141**, on carrier commit `6ecebcc2aebc39c81b6f1fe872894461d14235eb` / tree `de7ea07936dcb2c39678662a9e0f4954d5365cdd`. GitHub artifact ID `12116967605` is named `oreslang-sourcefree-persistent-actor-47-39075802504-1`; downloaded ZIP SHA-256 is `b0e3e7a568592772aeb74bae9a7442d5799131bde603ac8f5a34b7f5948909c9`, matching GitHub artifact metadata.

The receipt pins the exact backend heads:

- Java `ea2cdc09fd488183e04fe938fdd6f69ce2b47566`
- LLVM `d79427fb3a2114e3197566eb830cc76596314ec2`
- .NET `9cadaba519c4b0964a69a4a6d668a28761e5f356`
- Wasm `dd60caf793c42230f14e6aac829f5f6a8434434e`
- Forge `0ab9e78b490d2a1ff4bd8d62815edf17ab25e6a1`

`scripts/verify_persistent_actor_receipt.py` is a separate fail-closed profile for this receipt shape. Source-free carrier run [#39076113979](https://github.com/scintilla-run-test/gleam-runner-conformance/actions/runs/39076113979) executed its adversarial verifier tests, downloaded artifact `12116967605` from the prior run without extracting it, and successfully validated the exact ZIP digest, run/attempt, carrier commit/tree, five backend heads, three blob identities and exact `[47,47,47] / 141` test inventory.

This is still **policy-only evidence**. The validated receipt requires `guest_runtime_certified:false`, `native_backend_certified:false`, `private_source_export_authorized:false` and `source_runtime_or_compiler_transferred:false`. It must never be used as native backend parity, guest execution, source-export authorization, or release certification.
