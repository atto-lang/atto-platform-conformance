# Exception boundary fixtures

Run scalar_control first on each backend using its production entry point. The expected guest exit is 43. For negative cases require the operand-specific diagnostic and no executable output. A generic unsupported diagnostic may be recorded as UNSUPPORTED if it names the relevant capability. It cannot satisfy the operand check. A crash, timeout, skipped job or unrelated diagnostic fails to establish the expected rejection.

The manifest's scenarios describe additional checks for backend drivers. Add executable fixtures once the canonical syntax and lowering are available. For every result record the source commit and tree, fixture and compiler SHA-256, command, actual outcome and raw logs. Include executable hash and event trace for runtime scenarios. Verify the JVM and Native Image separately. One backend's result does not change another's status.

The caught integer fixture checks the LLVM bypass tracked in https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1441. A syntax error before checking this scope is insufficient evidence of the intended Error restriction.

## Post-await panic under DATA saturation

A backend driver should pause supervisor DATA consumption, start the child and observe its actual waiter registration. Fill the supervisor DATA queue and observe a capacity rejection before opening the child's await gate. An authenticated scheduler observer records suspend, resume, panic, cleanup, CONTROL handling and DATA drain in one ordered trace. Capture DATA occupancy at CONTROL handling and release the DATA pause only after that event. Bound the waits, then observe through supervisor quiescence to catch duplicate notices. Record interception markers if catch, trap or recover consumes the panic.

Run `node --test fixtures/exception-boundaries/v1/verify-post-await-panic.test.mjs` to test the trace checker on synthetic events. Backend adapters must supply actual authenticated events plus the compiler and guest evidence described above. The post-await guest case remains NOT_EXECUTED.
