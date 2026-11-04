# Private-source CI export lockdown — 2026-11-03

**Status: DENY ALL.** This is a source-local containment proposal and does not authorize private-source transfer.

The legacy `requirePrivateMirror()`, `publishPrivateMirror()`, and private canary `proposeCanary()` functions unconditionally deny as their first executable statement. None reads caller-controlled options before denial, nor calls GitHub, fetches source bytes or writes destination blobs, trees, commits or refs. Source-local tests use hostile getter and Proxy inputs, synthetic source/destination identities, and forbidden-network mocks. A conservative executable-surface scanner flags direct Git pushes and Git-object API entrypoints. Static scanning is defense in depth rather than exhaustive proof of absence of exfiltration paths.

**Nine blocking incidents:** #22, #77, #127, #171, #172, #198, #200, #212 and #252. The non-authorizing central disposition registry tracks eight; #212 is independently tracked. A future approval must establish all nine independent dispositions, exact source commit/tree and destination repository ID, protected review and required checks, provenance, retention controls and security authorization. Closing issues alone never authorizes source copying.

Source-org runner admission [#315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315) remains a separate prerequisite: zero-step GitHub Actions failures are **NOT_EXECUTED**, not test results. No cross-org source mirroring, new CI carrier, secrets, or private source transfer is performed by this PR.

Merge gates: independent security review, protected main and required checks, and actual exact-head Node `node --test tests/private-mirror-visibility.test.mjs tests/private-mirror-publish.test.mjs tests/private-mirror-entrypoints.test.mjs` with executed job steps/logs. The existing drafts [#263](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/263) and [#335](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/335) are **not** approvals; this narrow implementation can supersede their conflicting exporter-control changes after independent review.
