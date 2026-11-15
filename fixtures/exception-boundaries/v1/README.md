# Exception boundary fixtures

Run scalar_control first on each backend using its production entry point. The expected guest exit is 43. For negative cases require the operand-specific diagnostic and no executable output. A generic unsupported diagnostic may be recorded as UNSUPPORTED if it names the relevant capability. It cannot satisfy the operand check. A crash, timeout, skipped job or unrelated diagnostic fails to establish the expected rejection.

The manifest's scenarios describe additional checks for backend drivers. Add executable fixtures once the canonical syntax and lowering are available. For every result record the source commit and tree, fixture and compiler SHA-256, command, actual outcome and raw logs. Include executable hash and event trace for runtime scenarios. Verify the JVM and Native Image separately. One backend's result does not change another's status.

The caught integer fixture checks the LLVM bypass tracked in https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1441. A syntax error before checking this scope is insufficient evidence of the intended Error restriction.
