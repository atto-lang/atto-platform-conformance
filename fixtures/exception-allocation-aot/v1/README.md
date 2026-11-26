# Exception allocation and AOT acceptance targets v1

Ten .atto source targets: six proposed zero-guest-heap allocation optimization witnesses and four bounded retirement/error lifetime witnesses. These supplement the existing full-AOT and memory contracts, not replace their release lanes.

Measure the real compiled guest after initialization, using runtime counters, emitted artifact inspection and actual execution. No source constant folding substituted for dynamic-call proof. For scalar cases where the optimizer removes a literal call, execute a parameterized compiled guest entry and retain the evidence separately; do not mark the fixed fixture as dynamic proof. A null allocation ceiling means an explicit predeclared numeric budget is still needed, never unlimited success. Record guest allocations, retirements and high-water marks separately from host heap and collector activity. The 100,000-invocation stress target requires the same live runtime and artifact, not 100,000 process restarts.

Source AOT, native AOT and strict process zero-GC are independent claims. A browser ESM result is not native AOT, and absence of collections under Epsilon is not proof of bounded memory. All 110 backend cells remain NOT_EXECUTED.
