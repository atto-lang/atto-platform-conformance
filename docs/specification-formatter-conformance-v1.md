# Canonical specification -> formatter conformance matrix v1

**Status: proposal / unexecuted cross-repository conformance cases.** This registry references the exact atto-spec PR #115 commit and registry blob; cases are a prospective fixture snapshot, not a new normative specification or evidence of a working parser. Source documents in atto-spec still control syntax/effects.

Contract: contracts/specification-formatter-conformance-v1.json.

## Required execution protocol

1. Acquire audited exact repository trees for atto-spec, both formatter consumers and each compiler target; authenticate the spec registry Git blob SHA. Do not silently fetch a moving main branch or replace a missing private dependency with a mock.
2. Exercise every positive fixture in its specified edition/profile and logical package-relative file path with the actual parser. Record parse and typecheck acceptance separately from executable runtime acceptance; the contextual ownership fixtures require valid enclosing declarations before they can be admitted to guest runs.
3. For positive cases compare original/formatted canonical semantic ASTs with independently reviewed schema and adapters, then require idempotence and actual guest behavior where applicable.
4. For negative cases, reject original and formatted inputs (or have formatter reject before producing output); do not accept formatter correction of duplicate or late namespaces. Diagnostically equivalent forbidden condition is required, not arbitrary unrelated rejection.
5. Emit per-backend, per-consumer status passed/failed/unsupported/not_executed with exact code/fixture SHA, toolchain, commands, observed output and evidence receipt. Missing adapters, unexecuted workflows, fake ASTs or host-only integrity tests remain not_executed.
6. Record how the legacy oreslang-format parser differs from atto-format; do not transfer PASS from one repo to another or claim equivalence by name.

The checked-in Node test guards manifest completeness/absence of invented evidence. It intentionally does **not** invoke a compiler. A later runner can populate receipts under evidence/formatter-spec/ without rewriting normative rules here.
