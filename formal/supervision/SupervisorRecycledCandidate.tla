-------------------- MODULE SupervisorRecycledCandidate --------------------
EXTENDS Naturals, FiniteSets, TLC

(*
 * A physical slot can be recycled ONLY after a hidden candidate reaches
 * physical DONE, the host verifies cleanup, and the logical ticket aborts.
 * Reuse increments generation and leaves routing unpublished.
 *
 * Published actors are intentionally ineligible for this first generation-
 * reuse protocol because the legacy C callback exposes only a slot index.
 * Every message addressed by ActorRef must use the exact current generation;
 * the legacy slot-only submit is denied for all generations after the first.
 *)
CONSTANT MaxGeneration
ASSUME MaxGeneration \in Nat \ {0, 1}

VARIABLES generation, physical, logical, ticket, lease, published,
          everPublished, cleanupProved, acceptedFresh, staleDelivered,
          legacyDelivered, recycled, cleaned, exposed

vars == <<generation, physical, logical, ticket, lease, published,
          everPublished, cleanupProved, acceptedFresh, staleDelivered,
          legacyDelivered, recycled, cleaned, exposed>>

Init ==
  /\ generation = 1
  /\ physical = "None"
  /\ logical = "Finalized"
  /\ ticket = FALSE
  /\ lease = FALSE
  /\ published = FALSE
  /\ everPublished = FALSE
  /\ cleanupProved = FALSE
  /\ acceptedFresh = FALSE
  /\ staleDelivered = FALSE
  /\ legacyDelivered = FALSE
  /\ recycled = {}
  /\ cleaned = {}
  /\ exposed = {}

Reserve ==
  /\ logical = "Finalized"
  /\ ~ticket
  /\ physical \in {"None", "Hidden"}
  /\ logical' = "Restarting"
  /\ ticket' = TRUE
  /\ UNCHANGED <<generation, physical, lease, published, everPublished,
                 cleanupProved, acceptedFresh, staleDelivered,
                 legacyDelivered, recycled, cleaned, exposed>>

SpawnHidden ==
  /\ ticket
  /\ logical = "Restarting"
  /\ physical = "None"
  /\ physical' = "Hidden"
  /\ UNCHANGED <<generation, logical, ticket, lease, published,
                 everPublished, cleanupProved, acceptedFresh, staleDelivered,
                 legacyDelivered, recycled, cleaned, exposed>>

StopHidden ==
  /\ physical = "Hidden"
  /\ ticket
  /\ ~lease
  /\ physical' = "Done"
  /\ UNCHANGED <<generation, logical, ticket, lease, published,
                 everPublished, cleanupProved, acceptedFresh, staleDelivered,
                 legacyDelivered, recycled, cleaned, exposed>>

VerifyCleanup ==
  /\ physical = "Done"
  /\ ticket
  /\ ~everPublished
  /\ ~cleanupProved
  /\ cleanupProved' = TRUE
  /\ cleaned' = cleaned \cup {generation}
  /\ UNCHANGED <<generation, physical, logical, ticket, lease,
                 published, everPublished, acceptedFresh,
                 staleDelivered, legacyDelivered, recycled, exposed>>

Abort ==
  /\ physical = "Done"
  /\ ticket
  /\ cleanupProved
  /\ logical = "Restarting"
  /\ logical' = "Finalized"
  /\ ticket' = FALSE
  /\ UNCHANGED <<generation, physical, lease, published, everPublished,
                 cleanupProved, acceptedFresh, staleDelivered,
                 legacyDelivered, recycled, cleaned, exposed>>

RecycleHiddenDone ==
  /\ physical = "Done"
  /\ ~ticket
  /\ ~lease
  /\ logical = "Finalized"
  /\ cleanupProved
  /\ ~everPublished
  /\ generation < MaxGeneration
  /\ recycled' = recycled \cup {generation}
  /\ generation' = generation + 1
  /\ physical' = "Hidden"
  /\ cleanupProved' = FALSE
  /\ acceptedFresh' = FALSE
  /\ legacyDelivered' = FALSE
  /\ UNCHANGED <<logical, ticket, lease, published, everPublished,
                 staleDelivered, cleaned, exposed>>

AcquireLease ==
  /\ ticket
  /\ logical = "Restarting"
  /\ physical = "Hidden"
  /\ ~lease
  /\ lease' = TRUE
  /\ UNCHANGED <<generation, physical, logical, ticket, published,
                 everPublished, cleanupProved, acceptedFresh,
                 staleDelivered, legacyDelivered, recycled, cleaned, exposed>>

Commit ==
  /\ ticket
  /\ lease
  /\ logical = "Restarting"
  /\ physical = "Hidden"
  /\ logical' = "Active"
  /\ ticket' = FALSE
  /\ physical' = "Active"
  /\ published' = TRUE
  /\ everPublished' = TRUE
  /\ exposed' = exposed \cup {generation}
  /\ UNCHANGED <<generation, lease, cleanupProved, acceptedFresh,
                 staleDelivered, legacyDelivered, recycled, cleaned>>

ReleaseLease ==
  /\ lease
  /\ lease' = FALSE
  /\ UNCHANGED <<generation, physical, logical, ticket, published,
                 everPublished, cleanupProved, acceptedFresh,
                 staleDelivered, legacyDelivered, recycled, cleaned, exposed>>

StopPublished ==
  /\ physical = "Active"
  /\ ~lease
  /\ physical' = "Done"
  /\ published' = FALSE
  /\ UNCHANGED <<generation, logical, ticket, lease, everPublished,
                 cleanupProved, acceptedFresh, staleDelivered,
                 legacyDelivered, recycled, cleaned, exposed>>

FreshRefDelivery ==
  /\ physical = "Active"
  /\ published
  /\ ~acceptedFresh
  /\ acceptedFresh' = TRUE
  /\ UNCHANGED <<generation, physical, logical, ticket, lease,
                 published, everPublished, cleanupProved,
                 staleDelivered, legacyDelivered, recycled, cleaned, exposed>>

LegacyFirstGeneration ==
  /\ generation = 1
  /\ published
  /\ ~legacyDelivered
  /\ legacyDelivered' = TRUE
  /\ UNCHANGED <<generation, physical, logical, ticket, lease,
                 published, everPublished, cleanupProved, acceptedFresh,
                 staleDelivered, recycled, cleaned, exposed>>

Next == Reserve \/ SpawnHidden \/ StopHidden \/ VerifyCleanup
        \/ Abort \/ RecycleHiddenDone \/ AcquireLease \/ Commit
        \/ ReleaseLease \/ StopPublished \/ FreshRefDelivery
        \/ LegacyFirstGeneration

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ generation \in 1..MaxGeneration
  /\ physical \in {"None", "Hidden", "Done", "Active"}
  /\ logical \in {"Finalized", "Restarting", "Active"}
  /\ ticket \in BOOLEAN
  /\ lease \in BOOLEAN
  /\ published \in BOOLEAN
  /\ everPublished \in BOOLEAN
  /\ cleanupProved \in BOOLEAN
  /\ acceptedFresh \in BOOLEAN
  /\ staleDelivered \in BOOLEAN
  /\ legacyDelivered \in BOOLEAN
  /\ recycled \subseteq 1..MaxGeneration
  /\ cleaned \subseteq 1..MaxGeneration
  /\ exposed \subseteq 1..MaxGeneration

NoPrematureRouting ==
  published => (logical = "Active" /\ physical = "Active")

NoUncleanRecycling == recycled \subseteq cleaned

NoRecycledPublishedActor == recycled \cap exposed = {}

NoStaleGenerationDelivery == ~staleDelivered

NoLegacySlotAlias == generation > 1 => ~legacyDelivered

NoRetirementDuringLease == lease => physical \in {"Hidden", "Active"}

UnsafeRecycleWithoutCleanup ==
  /\ physical = "Hidden"
  /\ ticket
  /\ ~lease
  /\ generation < MaxGeneration
  /\ generation' = generation + 1
  /\ physical' = "Hidden"
  /\ logical' = "Finalized"
  /\ ticket' = FALSE
  /\ recycled' = recycled \cup {generation}
  /\ UNCHANGED <<lease, published, everPublished, cleanupProved,
                 acceptedFresh, staleDelivered, legacyDelivered,
                 cleaned, exposed>>

UnsafeDeliverStaleRef ==
  /\ generation > 1
  /\ ~staleDelivered
  /\ staleDelivered' = TRUE
  /\ UNCHANGED <<generation, physical, logical, ticket, lease,
                 published, everPublished, cleanupProved, acceptedFresh,
                 legacyDelivered, recycled, cleaned, exposed>>

UnsafeLegacyIndexBypass ==
  /\ generation > 1
  /\ published
  /\ ~legacyDelivered
  /\ legacyDelivered' = TRUE
  /\ UNCHANGED <<generation, physical, logical, ticket, lease,
                 published, everPublished, cleanupProved, acceptedFresh,
                 staleDelivered, recycled, cleaned, exposed>>

EarlyRecycleNext == Next \/ UnsafeRecycleWithoutCleanup
StaleRefNext == Next \/ UnsafeDeliverStaleRef
IndexBypassNext == Next \/ UnsafeLegacyIndexBypass
EarlyRecycleSpec == Init /\ [][EarlyRecycleNext]_vars
StaleRefSpec == Init /\ [][StaleRefNext]_vars
IndexBypassSpec == Init /\ [][IndexBypassNext]_vars
=============================================================================
