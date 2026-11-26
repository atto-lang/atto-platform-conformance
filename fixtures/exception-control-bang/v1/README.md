# Canonical exceptional control guest v1

28 independent .atto source targets: 12 admission and 16 propagation. All new exceptional-control keywords use contiguous bang spelling. Historical suites are unchanged. The canonical example is the owner-selected braced try/catch and explicit new Error constructor. See [spec #245](https://github.com/atto-lang/atto-spec/pull/245).

The manifest is a target inventory, not a receipt. Use the exact bytes and Git blob SHA, compiler head/tree, production entrypoint, emitted artifact digest and actual outcome. Rejecting invalid input through an unrelated parser failure is not nominal semantic admission proof. For escaping effects record the guest effect before root escalation, then the backend's required root policy; never treat an arbitrary process crash as success. A restricted backend may report UNSUPPORTED with capability-specific evidence. Neither host models nor ESM execution certify native AOT or zero process GC. The nominal inheritance and normal catch fallthrough cases intentionally demand more than the current narrow JS slice. Do not substitute a backend-specific source.

Run `node --test tests/exception-control-bang-guest-v1.test.mjs` for source integrity only. The later ownership/cleanup, cancellation/async and allocation/AOT batches must use the existing unwind scenario registry rather than claim completion here.
