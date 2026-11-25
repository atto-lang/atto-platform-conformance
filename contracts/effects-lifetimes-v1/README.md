# Effects and lifetimes candidate lane (v1)

**Status: authored / NOT_EXECUTED.** This lane mirrors the four canonical `.atto` sources from language-spec draft PR #33. Source blob SHA-1 is checked using Git's `blob <size>\\0` preimage. No compiler, interpreter, runtime or host model is counted as successful guest execution by this workflow.

The source-only model checks NLL last-use, exclusive-writer compatibility, move-before-last-use and live borrow across suspension, and negative mutations. It is a finite model of the intended contract—not an AttoLang parser or type checker. A negative parser error cannot substitute for a targeted borrow/lifetime diagnostic.

Next release gate: independently run unchanged fixture blobs through all six compiled backends, collect exact compiler head/tree, workflow blob, runner executed nonhousekeeping steps and observed guest diagnostics/output; keep every backend at NOT_EXECUTED until then.
