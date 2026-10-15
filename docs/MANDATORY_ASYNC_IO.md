# Mandatory nonblocking I/O conformance

Use `--suite=mandatory-async --backend=java|net|llvm|forge|wasm` with the existing
absolute argv, fixture placeholder, exact declared source SHA and --require
options. This suite covers the same 22 pinned source cases on all five backends.
A compiler missing async I/O support must reject rather than substitute a host
worker implementation. Pure positive cases must still succeed.

Negative cases require diagnosed exit 1 and empty stdout. Usage errors, signals,
crashes, timeouts and partial emitted output cannot count as successful denial.
This source-admission suite is separate from real native I/O concurrency,
cancellation, capability and ownership tests. Generic syntax rejection on a
scalar backend proves denial, not a native async implementation or full effect
checking. No configured compiler means UNCONFIGURED, not conformance.

The canonical corpus is owned by oreslang-common-source and pinned by SHA-256
in the conformance tests. Each source fixture must retain exactly its corpus
source plus a final newline. Supporting libraries using legacy I/O must migrate;
a mandatory compiler rejecting their code does not make them usable yet.
