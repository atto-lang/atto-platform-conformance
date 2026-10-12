namespace Oreslang.NativeTerminalReceipt.V1;

/** Exact physical actor incarnation, never a slot-only capability. */
model ActorIdentity {
  schedulerDomain: uint64;
  actorSlot: uint64;
  generation: uint64;
}

/** Typed terminal envelope persisted within the native scheduler lane. */
model TerminalFailure {
  kind: "panic" | "cancelled" | "stopped";
  child: ActorIdentity;
  failureCode: uint64;
  correlation: uint64;
}

/** An original scheduler record joined with the host registry's logical ID.
 * A claim is one-use. A claimed record with unknown host-enqueue outcome
 * MUST remain quarantined until independent proof is available.
 */
model TerminalReceipt {
  supervisorId: uint64;
  logicalChildId: uint64;
  logicalIncarnation: uint64;
  originalParent: ActorIdentity;
  failure: TerminalFailure;
  status: "recorded" | "claimed" | "acknowledged";
  claimNonce: uint64;
  publishedToParent: boolean;
}
