# Legacy private-source publisher quarantine — P0

The historical `bin/private-mirror-publish.mjs` entrypoint **must not** be
used to transfer any Oreslang source. Its old `ORES_APPROVED_PRIVATE_MIRRORS`
environment variable could act as a caller-controlled destination allowlist,
without proving independent source snapshot, protected-main, workflow and
incident authorizations. The old privacy/blob checks were necessary but not
sufficient. This is a static-code risk; it does not itself prove a transfer.

This draft replaces the legacy entrypoint with a fail-closed stub and adversarial
synthetic tests. Its public `publishPrivateMirror` export and direct CLI both
reject all inputs **before any external operation**. No environment variable,
manual waiver, test pass, caller review flag or snapshot pin unlocks it.

Any proposed replacement must be a separate, independently reviewed canonical
publisher requiring, at minimum:

1. Enforced, independently verified Java protected-main policy and exact pinned
   policy/dispatcher/workflow blobs. Fail closed on unavailable admin metadata.
2. Review of the immutable destination repository **numeric ID** and privacy,
   approved source commit/tree, and exact isolated branch identity; no dynamic
   environment-only allowlists.
3. Separate, currently valid, unrevoked independent resume approvals for both
   open P0 incidents #22 and #77, bound to those exact heads and destination.
4. Rechecks before every source fetch and private Git write, including revocation
   races; strict byte/grammar validation and denial on missing metadata.
5. Authorization and genuine exact-head executable CI **as distinct gates**.
   `steps:null` does not prove that test steps executed (or that their count was
   zero); a successful unrelated carrier run does not grant publication rights.

This draft **does not** modify live `main`, deploy policy, configure branch
protection, close incidents or authorize any private-source movement. Maintain
the existing release/source-transfer hold until independently verified.
