# AttoLang Language Previews — source contract v1

This directory pins the **exact `.atto` bytes** used to design the
`routine`, `guard`, and `export` features. Its checks are source-only.
**They are not evidence that any compiler accepted the files, executed guest
code, or established parity.** All six target lanes remain `UNVERIFIED`.

The guard cases reuse the existing `contracts/guard-v1.json` and its
`fixtures/guard-v1/*.atto` blob identities. In guard-v1,
`guard condition { exit; }` continues when the predicate is true and
runs the mandatory exiting block when false. There is **no `else` clause**.
A non-exiting failure block must fail static checking.

Routine cases require named direct calls but forbid direct reentry,
mutual recursion through `fnc`, and taking a routine as a first-class
callback value. In contrast, an ordinary `fnc` may recurse.
The Java reference still permits routine recursion, so this remains a
documented semantic gap until the compiler implementations and negative
tests are updated.

Exports require `export pub Foo;` before a local declaration and
`export pub[pkg] class Bar;` after it, plus rejection of a mismatched
kind or an unknown target. This is coordinated with the existing
`contracts/explicit-exports-v1.json` model and the browser compiler's
pending explicit-export PR; the fixture syntax is **not** an executable
browser guarantee.

Run `node --test tests/atto-language-previews-v1.test.mjs` to verify
regular-file provenance and pinned Git blob identities. This does not invoke
a guest compiler. Before promoting any lane, collect independently reviewed,
immutable compiler and guest execution receipts with nonempty executed CI
steps, source SHA, compiler executable SHA, exact input blobs, expected result
or diagnostic and proof that rejected inputs emitted **no runnable artifact**.
