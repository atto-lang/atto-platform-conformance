# Untrusted guest runaway cases — roadmap task #60

**All five backend statuses: NOT_EXECUTED.** This PR adds a candidate
adversarial source inventory, not a runtime or compiler conformance result.
The Node tests verify the manifest, files, ten threat categories and that
a fabricated PASS label cannot appear in this proposal.

Real acceptance requires an **authorized isolated** runner for each backend
that compiles and executes the candidate .atto/.wat workloads (after syntax
reconciliation), checks watchdog termination, hard task budgets, no
cross-actor/tenant damage, sibling forward progress and bounded cancellation.
Testing infinite loops on an unprotected host is prohibited. Use process
containment with OS-enforced CPU, memory, pid, wall-time, I/O and child-process
limits *independent* of guest-supplied `rt cooperate` or compiler counters.

A trusted compiler pass must prove coverage for optimized backedges, calls,
mutual/tail recursion, allocations and FFI. The checkpoint-erasure mutation
is an internal compiler pass test, not a source file. Untrusted hard
fuel must not be amortized away by the 128/512 *fairness* sampling heuristic.
Capture the exact source/tree SHA, fixture blob and binary SHA-256, target,
run attempt, job IDs, positive/negative outcomes, nonzero executed steps and
independent review. Zero-step workflows mean runner admission failure.

Distinct from existing source-free checkpoint model PR #589: these are
proposed **guest workloads + safety acceptance matrix**, not a second
implementation of the scheduler-policy oracle. Coordinate compiler/backend
fixture syntax with other agents before enabling execution.
