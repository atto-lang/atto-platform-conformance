# Actor critical-section and generation safety: bounded proof obligation

This is a **host-only reference model**, not evidence that any AttoLang compiler or AOT runtime implements these transitions.

Run: python3 -B formal/actor_critical_model.py

## Contract represented by the model

- A non-serial actor may execute two receiver lanes simultaneously. Both may hold critical-read at once. At most one critical-write owner exists and no writer overlaps a reader. Serial scheduling is a stronger restriction not modeled here.
- Each receiver has an independent logical stack. Critical scopes carry an actor-generation tag, invalidated when the actor is replaced.
- Supervisor-driven termination quiesces/cancels all receiver lanes before retiring logical stacks. The model makes termination atomic; the actual runtime must prove that no carrier still accesses a freed frame.
- A stale generation-1 frame must never enter the generation-2 actor.

The state space is bounded to two receiver lanes, two generations and two writes. The exhaustive search checks every reachable transition and requires witnesses for concurrent reads, exclusive writes, restart and stale-frame rejection.

Four deliberately unsafe transitions must yield a shortest counterexample trace: writer+reader overlap, two writers, admission of a stale frame, and termination without clearing stacks.

## Refinement gate and non-claims

To certify each backend, record real compiled .atto receiver histories with actor ID, frame ID, generation and critical acquisition/release order, and compare them with permitted model traces. The Java/Graal, LLVM, .NET NativeAOT, Rust/Cranelift, Wasm and Forge implementations must be checked separately where applicable.

An auditable receipt requires exact compiler and guest SHAs, exact executed build/test commands, an exit status, and machine-readable traces. This model does NOT prove unbounded safety, liveness, heap isolation, zero GC, real-time guarantees, safe forced cancellation, or guest execution.