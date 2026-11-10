# AttoLang GPU actors — candidate contract v0

**Status (2026-11-10): CANDIDATE, UNATTESTED.** Not compiler-accepted, not executed on device, and not a GPU performance claim. This layers on `CPU_GPU_TASK_V2.md`, `HETEROGENEOUS_COMPUTE_V1.md`, and existing GPU kernel/launch proposals. It does not override them or create a competing actor-memory ABI.

## Goal
`define gpu actor` is an actor specialization with normal identity, bounded mailbox, supervision, sealed state, ownership, and failure rules. Two profiles:
1. **Host-orchestrated GPU actor:** actor control and mailbox on CPU/OresVM; explicitly owned `GpuBuffer<T>` and `gpu task { ... }` launch one or more kernels without blocking a carrier.
2. **GPU-resident actor population:** many *logical* actors, each with independent identity, mailbox sequence, and sealed state slot, are packed into SoA/AoSoA device allocations and processed in batched GPU workgroups. The runtime schedules waves; it does **not** promise one simultaneously executing physical core/thread per actor, nor persistent hardware execution for each actor.

## Illustrative source (NOT yet accepted)
```ores
define gpu actor Particle as
    state { let float x: 0.0; let float velocity: 0.0; }

    receive(Step msg) ::
        handle_state(critical-write |s| -> {
            s.x = s.x + s.velocity * msg.delta_time;
        });
    end
end

let particles = spawn gpu Particle[1000000]();
await particles.broadcast(Step(0.016));
```
The population syntax, handler lowering, and `Step` names are candidates. Kernel methods use existing proposed `gpu fnc`, GPU launch effects and `gpu task { ... }`, not CUDA C++ `<<< >>>` syntax. Use snake_case for named functions/methods. Keep read/write critical regions non-suspending.

## Required semantics
- Per-actor single-writer mailbox admission is linearizable and ordered. Distinct actors may execute in any order, concurrently or sequentially according to bounded device capacity. `broadcast` is not a global transaction, and no lock is held during an asynchronous device fence.
- An individual actor turn obtains a generation/epoch-fenced state capability. Within a GPU population turn, the kernel can read or write only its own state slot. Parallel *reads* use immutable snapshots; writes to the same actor epoch are exclusive. A cross-actor mutable reference or retained untracked device pointer is invalid.
- A GPU turn stages output, then publishes state only after a successful fence and generation check. A failed kernel/device-loss epoch must not publish partially computed actor state. This is per-turn atomic publication, **not** automatic external-IO transactionality.
- GPU kernels cannot call host actor methods, send mailbox messages directly, await a host Future, perform host I/O, allocate unbounded host memory, or execute a CPU callback per SIMD lane. Device outboxes are bounded, typed result buffers; a host completion stage may convert them into actor messages after a fence.
- `GpuBuffer` ownership transfer is explicit, with `rt take` / borrow / share effects consistent with the existing compiler. No implicit host/device copies, CPU fallback, cross-tenant memory mapping, or device-global mutable singleton aliasing. Read-only symbols/constants may be shared only through approved canonical immutable tables.
- Cancellation signals intent only: true kernel/transfer quiescence gates buffer release, actor teardown and supervision replacement. Stale completions cannot commit to a newer incarnation. If a device is lost, *all affected actors* must be fenced, marked failed and notified through their supervisor CONTROL path; GPU hardware is not assumed to provide independent actor-level fault containment.
- Backpressure is bounded; dispatch should batch actors with similar handlers and uniform control flow. SoA/AoSoA layout is an optimization, never a relaxation of type/bounds or actor ownership. Optional deterministic numerical mode defines reduction order/precision rather than assuming floating-point bitwise stability.
- GPU residency must be admitted by a proven device capability. No GPU, unsupported kernel effects, or quota exhaustion fail closed with a typed error. A software simulator may validate semantics but cannot satisfy a physical-GPU conformance gate.
- `on_throw`/`on_raise`/`recover` and panic/supervisor rules remain host actor lifecycle semantics; per-lane device errors are *data*, with a bounded error record materialized at completion. No arbitrary host exception handling inside a device kernel.

## Delivery sequence
1. Pin this contract and negative cases, with all backend evidence `NOT_EXECUTED`.
2. Add parser/typed-HIR admission for `define gpu actor` in Java and LLVM, preserving existing `gpu task` effects and forbidding foreign state access. Unsupported compile paths must reject before artifact creation.
3. Implement a single host-orchestrated actor that explicitly uploads a buffer, invokes a validated f32 kernel, fences, downloads and replies. Prove on real GPU; keep CPU oracle separate.
4. Add actor population launcher, bounded mailbox admission, per-actor sequence and generation fences, SoA storage and batched workgroup dispatch; test 1, 2, many, and over-capacity actors, including cancellation, device-loss, no lost updates and no cross-actor leaks.
5. Bring .NET, Wasm and Forge to the *same source* contract. WebGPU restrictions and host/runtime-specific GPU providers must be surfaced as capability diagnostics. Never label a backend physically conformant without real hardware execution and provenance.

## Evidence gate
The machine-readable scenarios in `contracts/atto-gpu-actors-v0.json` are *requirements*, not executed tests. A Node test may verify the manifest but cannot claim parser acceptance, hardware execution, numerical correctness or backend parity. Promotion requires exact-commit fixture/compiler hashes, stepful job logs, real compiled guest, physical GPU and driver identities, fence/teardown traces and independent review.
