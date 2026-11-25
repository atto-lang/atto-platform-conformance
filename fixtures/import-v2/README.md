# Static import v2 shared corpus

Draft specification: [atto-spec #227](https://github.com/atto-lang/atto-spec/pull/227). This is independently authored test input, not copied compiler implementation. The 200 cases consist of 56 real-guest expectations, 62 typed-binding/negative expectations, and 82 resolution expectations. The 48 delimiter permutations intentionally exercise grammar equivalence. The ledger is CORPUS_ONLY_NOT_BACKEND_EXECUTION.

- guest: compile the supplied source with the actual backend and execute the entrypoint; negative cases must reject without artifact.
- typed-bindings: resolve using the named synthetic authenticated export fixture; compare exact local name, kind and remote identity, and verify atomic rejection. Parsing alone does not pass.
- resolution: load the synthetic package roots with distinct pinned identities and explicitly admit the implicit builtin only where indicated. Resolve the named reference; for positive cases verify package/builtin identity and member availability; ambiguity must be diagnosed before member selection. Namespace-alias negatives must leave no partial alias state.

Synthetic fixtures model declared public export tables, not a dependency acquisition or lockfile implementation. Backends must build their own real source graphs from this schema and independently prove authentication/visibility, then attach exact compiler head/tree, executed commands, toolchain, raw results and artifacts. Source-free corpus validation only checks shape and consistency, not compiler behavior. No private-source export approval is implied.

The expanded scope includes relative grouped-function guest fixtures, recursive import trees, manifest namespace selection, exported subpaths, and URL rejection cases. Registry acquisition, complete authenticated URL policy, contextual self/super/pkg roots, formatter round trips, and backend execution evidence remain pending. Expand those categories in subsequent reviews.

Both `define alias NAME = PATH;` and `define alias PATH as NAME;` normalize to one dependency graph. The additional 16 fixtures include standalone and mixed alias cycles, exact diagnostic codes, duplicate bindings and malformed separators. The real guest adapter requires specified diagnostic codes for negative cases.

23 additional resolution targets exercise nested trees, package admission order, contextual roots and atomic rejection. Contextual paths are a resolver target, not proof of local/private visibility integration.

Eleven new builtin-tree guest expectations cover namespace and function leaves, nested groups, direct typed imports, self leaves, and diagnosed rejection. Contextual examples use `common` instead of reserved `shared`.
