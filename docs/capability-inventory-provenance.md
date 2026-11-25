# Audited feature inventory snapshot — source-only, not certified

This immutable TSV is copied from `atto-lang/atto-target-profiles` draft [PR #3](https://github.com/atto-lang/atto-target-profiles/pull/3), exact commit `d5bf01ddfdd4da8949a729a15151c1c954b84607`, path `profiles/compiler-feature-capabilities-v1.tsv`, **Git blob SHA `c2ffbd435f1360a82c47162fc97a56fee05bc282`**.

The Rust test suite verifies the checked-in fixture's Git blob. **This is a pinned source-only snapshot**, not a second canonical registry and not an independently authenticated execution receipt. Refresh by obtaining a new reviewed exact-head source tree and verifying its Git blob, then update this snapshot plus the pinned hash/tests together. Do not mutate statuses to PASSED based on this file alone.

Each source capability is NOT_EXECUTED. The planner rejects any promoted status, keeps separate soft/hard RT feature IDs and emits only NOT_CERTIFIED, guest_executed=false planning results. AOT tenant fixture contract remains pinned at `b31f8a5b86a4d9529b89cd1ff2a8b379c33d3dfa`. All future actual guest conformance evidence must be authenticated through a trusted separately tested receipt verifier.
