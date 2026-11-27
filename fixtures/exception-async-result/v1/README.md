# Async Result and exceptional unwind targets v1

Twelve independent canonical bang .atto source targets. Async trap declaration uses the existing Java draft alias `async trap fnc`; final canonical async declaration spelling still needs a separate owner/spec decision. The return boundary is explicitly Future<Result<T, Error>>, not the retired Future<Option<T>>. Existing Result passes through, Option stays nested, raise/panic/cancellation escape ordinary capture.

For pending_i64 the driver must control a real pending producer and verify waiter registration and same-invocation resume. Do not make the hook implement trap, defer or error conversion. Cancel only after actual suspension; verify cancellation and physical retirement independently of logical Future completion. The exact hook ABI and source parser admission are unverified design-intent, not runnable conformance claims. All 132 backend cells are NOT_EXECUTED.
