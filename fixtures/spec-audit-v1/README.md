# AttoLang specification audit — candidate fixture inventory v1

**Status: PROPOSED / NOT_EXECUTED.** This inventory is *not* proof of compiler acceptance, guest execution, or cross-backend parity. The source-free inventory test validates metadata and file presence only.

This set covers specification PR [#9](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/9), decisions [S-42, S-46, S-54, S-55, S-56 and S-57](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/issues/15), and existing canonical Guard/named-argument fixture files. Keep chapter 15 for nested actor pipelines and chapter 20 for Guard.

- `positive`/`negative`: an **intended** oracle, never a certified pass; negative cases require a named diagnostic class rather than a string guessed from a backend.
- `decision-candidate`: alternative or incompletely specified syntax. **Do not enforce admission/rejection until independently ratified**; these files are review inputs, not passing tests.
- A real run must pin the complete fixture hash set, spec and compiler source/tree SHAs, artifact hashes, nonempty executed steps and typed guest outcomes. Report per-backend `SOURCE_CHECK`, `GUEST_EXECUTED` or `NOT_EXECUTED` truthfully.
- Preserve the distinct deferred `Actor.pipe(...).start()` contract when exploring S-54; graph drop/lifetime in S-55 is still PROPOSED.
- Complete actor stage roles, constructors, port contracts and start/stop signatures with compiler owners before promoting pipeline examples to executable positives.
- Source-free Node inventory validation is **not** an AttoLang compiler test.

Existing Guard and named-argument fixtures are reused rather than copied, so one source carries the exact semantics into follow-up Java/LLVM, then .NET/Wasm/Forge verification.

## Pinned fixture identities and paired negative controls

Each source is pinned to a Git blob SHA-1. The source-free Node test recomputes
the Git object digest from the actual fixture bytes to catch accidental
substitution, truncation, or file drift. This is Git identity evidence, **not**
signed compiler provenance or guest execution. Positive `expected_guest_i64`
fields are target oracles, not observed values.

Before counting a negative on any backend, first compile its paired control
from the same pinned compiler build and require source admission. Then reject
the negative with the expected **semantic diagnostic class** rather than an
unrelated parser error, missing stage declaration, or generic nonzero exit.

The `pipeline-double-start` case uses unresolved Reader/Writer placeholders.
It remains a `decision-candidate` with the future target diagnostic
`MOVED_BUILDER_REUSED`; it is **not** a valid negative compiler witness until
concrete admitted actors and typed ports exist. No backend status has advanced
beyond `NOT_EXECUTED`.

## Same-feature differential controls

Each negative case has a `control_transform` with exactly one occurrence of
`from`, which becomes `to` in its control. Ignoring only full-line comments,
the source-free inventory enforces byte-for-byte equality everywhere else.
Guard fallthrough/else, duplicate named argument, and direct ActorRef method
tests therefore have minimal paired controls. A compiler rejection **never**
counts unless the corresponding same-head, same-toolchain control compiles and
the negative fails with its **specified semantic diagnostic class**, not a
generic parse error. This transformation check is only a structural source-free
oracle and does not establish guest behavior.
