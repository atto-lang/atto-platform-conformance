# Observable ↔ Future / Task proposed source fixtures

**Design-only, never claim executed guest-source verification.** Canonical conversion names are `Observable.from_future`, `Observable.from_task`, `Future.to_obs` and `Task.to_obs`, plus `Future.from_observable(obs, mode=#single|#first)` and `Task.from_observable(obs, mode=#single|#first)`.

These examples are **proposed syntax**, not proven compiler passes. `#single` requires exactly one element and stream completion; zero elements fail with `EmptyObservableError`, two fail with `TooManyElementsError`. `#first` produces `Option<T>`, emits Some on the first item or None on empty completion, and detaches its subscription.

The manifest contains pending conformance vectors for scheduling, producer ownership vs subscription ownership, event-only void, cancellation and panic, no double-consume for affine values, callback races, physical quiescence, backpressure and five-backend full-AOT parity. Tests must reject negative fixtures for the intended reason, not because all Observable syntax is unsupported.

Reference: `docs/OBSERVABLE_FUTURE_TASK_INTEROP_V1.md`. Evidence remains absent; all backend statuses stay pending until exact-source executions and valid receipts are recorded. Never transfer private source without the repository's reviewed authorization.
