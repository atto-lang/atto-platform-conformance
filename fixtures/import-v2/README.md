# Static import v2 shared corpus

Draft specification: [atto-spec #227](https://github.com/atto-lang/atto-spec/pull/227). This is independently authored test input, not copied compiler implementation. The 96 cases consist of 15 real-guest expectations, 62 typed-binding/negative expectations, and 19 resolution expectations. The 48 delimiter permutations intentionally exercise grammar equivalence. The ledger is CORPUS_ONLY_NOT_BACKEND_EXECUTION.

- guest: compile the supplied source with the actual backend and execute the entrypoint; negative cases must reject without artifact.
- typed-bindings: resolve using the named synthetic authenticated export fixture; compare exact local name, kind and remote identity, and verify atomic rejection. Parsing alone does not pass.
- resolution: load the synthetic package roots with distinct pinned identities and explicitly admit the implicit builtin only where indicated. Resolve the named reference; for positive cases verify package/builtin identity and member availability; ambiguity must be diagnosed before member selection. Namespace-constant negatives must leave no partial alias state.

Synthetic fixtures model declared public export tables, not a dependency acquisition or lockfile implementation. Backends must build their own real source graphs from this schema and independently prove authentication/visibility, then attach exact compiler head/tree, executed commands, toolchain, raw results and artifacts. Source-free corpus validation only checks shape and consistency, not compiler behavior. No private-source export approval is implied.

Current scope excludes registry acquisition, direct URL policy, complete import-tree grammar, formatter round trips, and all backend execution evidence. Expand those categories in subsequent reviews.
