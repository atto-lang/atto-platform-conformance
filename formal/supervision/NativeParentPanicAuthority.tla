---------------------- MODULE NativeParentPanicAuthority ----------------------
EXTENDS Naturals, TLC

(*
 * Identity-mode parent callback authorization for a host-owned supervisor.
 * Bridge identity is fixed at generation 1; a scheduler may later retire
 * and physically reuse that slot. Only a callback from the LIVE, PUBLISHED
 * exact original generation may consume its logical child registration.
 * Slot-only, stopped-parent, replaced-generation and duplicate callbacks
 * must not consume the child. This is a bounded safety abstraction.
 *)
VARIABLES parentGeneration, parentPhase, published, childRegistered,
          accepted, rejected, consumedGeneration, legacyConsumed,
          stoppedConsumed, wrongGenerationConsumed

vars == <<parentGeneration, parentPhase, published, childRegistered,
          accepted, rejected, consumedGeneration, legacyConsumed,
          stoppedConsumed, wrongGenerationConsumed>>

Init ==
  /\ parentGeneration = 1
  /\ parentPhase = "Live"
  /\ published = TRUE
  /\ childRegistered = TRUE
  /\ accepted = 0
  /\ rejected = 0
  /\ consumedGeneration = 0
  /\ legacyConsumed = FALSE
  /\ stoppedConsumed = FALSE
  /\ wrongGenerationConsumed = FALSE

AcceptExact ==
  /\ parentGeneration = 1
  /\ parentPhase = "Live"
  /\ published
  /\ childRegistered
  /\ accepted' = accepted + 1
  /\ consumedGeneration' = parentGeneration
  /\ childRegistered' = FALSE
  /\ UNCHANGED <<parentGeneration, parentPhase, published, rejected,
                 legacyConsumed, stoppedConsumed, wrongGenerationConsumed>>

RejectSlotOnly ==
  /\ childRegistered
  /\ rejected < 3
  /\ rejected' = rejected + 1
  /\ UNCHANGED <<parentGeneration, parentPhase, published, childRegistered,
                 accepted, consumedGeneration, legacyConsumed,
                 stoppedConsumed, wrongGenerationConsumed>>

StopParent ==
  /\ parentPhase = "Live"
  /\ parentPhase' = "Stopped"
  /\ published' = FALSE
  /\ UNCHANGED <<parentGeneration, childRegistered, accepted, rejected,
                 consumedGeneration, legacyConsumed, stoppedConsumed,
                 wrongGenerationConsumed>>

RecycleParent ==
  /\ parentPhase = "Stopped"
  /\ parentGeneration = 1
  /\ parentGeneration' = 2
  /\ parentPhase' = "Hidden"
  /\ UNCHANGED <<published, childRegistered, accepted, rejected,
                 consumedGeneration, legacyConsumed, stoppedConsumed,
                 wrongGenerationConsumed>>

PublishNext ==
  /\ parentPhase = "Hidden"
  /\ parentPhase' = "Live"
  /\ published' = TRUE
  /\ UNCHANGED <<parentGeneration, childRegistered, accepted, rejected,
                 consumedGeneration, legacyConsumed, stoppedConsumed,
                 wrongGenerationConsumed>>

RejectInvalidIdentity ==
  /\ childRegistered
  /\ (parentGeneration # 1 \/ parentPhase # "Live" \/ ~published)
  /\ rejected < 3
  /\ rejected' = rejected + 1
  /\ UNCHANGED <<parentGeneration, parentPhase, published, childRegistered,
                 accepted, consumedGeneration, legacyConsumed,
                 stoppedConsumed, wrongGenerationConsumed>>

RejectReplay ==
  /\ ~childRegistered
  /\ rejected < 3
  /\ rejected' = rejected + 1
  /\ UNCHANGED <<parentGeneration, parentPhase, published, childRegistered,
                 accepted, consumedGeneration, legacyConsumed,
                 stoppedConsumed, wrongGenerationConsumed>>

Next == AcceptExact \/ RejectSlotOnly \/ StopParent \/ RecycleParent
        \/ PublishNext \/ RejectInvalidIdentity \/ RejectReplay
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ parentGeneration \in {1, 2}
  /\ parentPhase \in {"Live", "Stopped", "Hidden"}
  /\ published \in BOOLEAN
  /\ childRegistered \in BOOLEAN
  /\ accepted \in 0..2
  /\ rejected \in 0..3
  /\ consumedGeneration \in {0, 1, 2}
  /\ legacyConsumed \in BOOLEAN
  /\ stoppedConsumed \in BOOLEAN
  /\ wrongGenerationConsumed \in BOOLEAN

NoLegacyConsumption == ~legacyConsumed
NoStoppedConsumption == ~stoppedConsumed
NoWrongGenerationConsumption == ~wrongGenerationConsumed
NoDuplicateConsumption == accepted <= 1
OnlyOriginalGenerationConsumed == accepted > 0 => consumedGeneration = 1

UnsafeSlotOnlyCallback ==
  /\ childRegistered
  /\ ~legacyConsumed
  /\ legacyConsumed' = TRUE
  /\ childRegistered' = FALSE
  /\ accepted' = accepted + 1
  /\ consumedGeneration' = parentGeneration
  /\ UNCHANGED <<parentGeneration, parentPhase, published, rejected,
                 stoppedConsumed, wrongGenerationConsumed>>

UnsafeStoppedParentCallback ==
  /\ childRegistered
  /\ parentPhase = "Stopped"
  /\ ~stoppedConsumed
  /\ stoppedConsumed' = TRUE
  /\ childRegistered' = FALSE
  /\ accepted' = accepted + 1
  /\ consumedGeneration' = parentGeneration
  /\ UNCHANGED <<parentGeneration, parentPhase, published, rejected,
                 legacyConsumed, wrongGenerationConsumed>>

UnsafeReusedGenerationCallback ==
  /\ childRegistered
  /\ parentGeneration = 2
  /\ parentPhase = "Live"
  /\ published
  /\ ~wrongGenerationConsumed
  /\ wrongGenerationConsumed' = TRUE
  /\ childRegistered' = FALSE
  /\ accepted' = accepted + 1
  /\ consumedGeneration' = parentGeneration
  /\ UNCHANGED <<parentGeneration, parentPhase, published, rejected,
                 legacyConsumed, stoppedConsumed>>

UnsafeReplay ==
  /\ ~childRegistered
  /\ accepted = 1
  /\ accepted' = accepted + 1
  /\ UNCHANGED <<parentGeneration, parentPhase, published, childRegistered,
                 rejected, consumedGeneration, legacyConsumed,
                 stoppedConsumed, wrongGenerationConsumed>>

LegacyMutant == Next \/ UnsafeSlotOnlyCallback
StoppedMutant == Next \/ UnsafeStoppedParentCallback
ReusedMutant == Next \/ UnsafeReusedGenerationCallback
ReplayMutant == Next \/ UnsafeReplay
LegacySpec == Init /\ [][LegacyMutant]_vars
StoppedSpec == Init /\ [][StoppedMutant]_vars
ReusedSpec == Init /\ [][ReusedMutant]_vars
ReplaySpec == Init /\ [][ReplayMutant]_vars
=============================================================================
