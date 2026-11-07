# AttoLang AI contributor instructions

Read [root AGENTS](../AGENTS.md) and [AOT/zero-GC review checklist](../docs/AOT_ZERO_GC_CONTROLLED_DYNAMISM_V1.md). Do not introduce runtime codegen/unbounded reflection in sealed AOT. Generate known-target proxies/dispatch metadata statically and verify closure/actor/task lifetimes, deterministic drop, quota and generation fences. Separate host-only success from guest AOT and process zero-GC claims. Require negative source fixtures and exact-head stepful guest receipts; preserve independent security review and Rust-only tooling.
