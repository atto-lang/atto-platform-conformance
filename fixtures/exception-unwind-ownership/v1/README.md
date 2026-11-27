# Ownership-aware exceptional unwind source targets v1

Twenty new canonical .atto sources map to the existing SHA-pinned execution-context-unwind registry. These are design-intent inputs, not validated grammar or backend receipts. The 28 earlier admission/propagation sources are unchanged. Each of eleven backend cells per fixture is NOT_EXECUTED.

The expected stdout is guest output, not an instrumented host model. For moved and dropped values, require compiler/runtime lifecycle receipts that identify the resource and invocation and establish exactly-once retirement. A scalar return value cannot prove deterministic destruction. Check pending failure identity and suppressed causes independently. Safe panic cleanup and root escalation are distinct; never assume an OS abort can run guest cleanup. If a backend lacks the relevant capability, report UNSUPPORTED with evidence, not PASS.

The suite deliberately includes terminal recovery, failure during registration, cleanup precedence, source-owner invalidation, and reverse-order cleanup. The existing unwind contract is authoritative; the narrower legacy Error-only scenario text must be read with the later nominal trait reconciliation. Native allocation and suspension-specific proofs remain separate.

Run `node --test tests/exception-unwind-ownership-guest-v1.test.mjs` for integrity only.
