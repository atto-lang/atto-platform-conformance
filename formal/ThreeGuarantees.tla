------------------------- MODULE ThreeGuarantees -------------------------
EXTENDS Naturals, FiniteSets, TLC

(*
  Bounded abstract protocol model, NOT verification of an Oreslang executable.
  Three code generations, two session capabilities, two native image slots.
  Session phase belongs to an opaque, affine per-conversation handle.
*)
CONSTANTS UnsafePurge, UnsafeResurrect, UnsafePublish
ASSUME UnsafePurge \in BOOLEAN /\ UnsafeResurrect \in BOOLEAN /\ UnsafePublish \in BOOLEAN

Versions == 1..3
Sessions == {"s1", "s2"}
Phases == {"idle", "created", "auth_pending", "auth_uncertain",
           "authorized", "capture_pending", "captured", "closed"}
Tokens == {"none", "created", "authorized"}

VARIABLES active, images, staging, validated, phase, pinned, token, admittedEver
vars == <<active, images, staging, validated, phase, pinned, token, admittedEver>>

Init ==
  /\ active = 1
  /\ images = {1}
  /\ staging = 0
  /\ validated = {1}
  /\ phase = [s \in Sessions |-> "idle"]
  /\ pinned = [s \in Sessions |-> 0]
  /\ token = [s \in Sessions |-> "none"]
  /\ admittedEver = [s \in Sessions |-> FALSE]

Start(s) ==
  /\ phase[s] = "idle"
  /\ phase' = [phase EXCEPT ![s] = "created"]
  /\ pinned' = [pinned EXCEPT ![s] = active]
  /\ token' = [token EXCEPT ![s] = "created"]
  /\ UNCHANGED <<active, images, staging, admittedEver, validated>>

AdmitAuthorization(s) ==
  /\ phase[s] = "created"
  /\ phase' = [phase EXCEPT ![s] = "auth_pending"]
  /\ token' = [token EXCEPT ![s] = "none"]
  /\ admittedEver' = [admittedEver EXCEPT ![s] = TRUE]
  /\ UNCHANGED <<active, images, staging, pinned, validated>>

TimeoutAuthorization(s) ==
  /\ phase[s] = "auth_pending"
  /\ phase' = [phase EXCEPT ![s] = "auth_uncertain"]
  /\ UNCHANGED <<active, images, staging, pinned, token, admittedEver, validated>>

SettleAuthorization(s) ==
  /\ phase[s] \in {"auth_pending", "auth_uncertain"}
  /\ phase' = [phase EXCEPT ![s] = "authorized"]
  /\ token' = [token EXCEPT ![s] = "authorized"]
  /\ UNCHANGED <<active, images, staging, pinned, admittedEver, validated>>

AdmitCapture(s) ==
  /\ phase[s] = "authorized"
  /\ phase' = [phase EXCEPT ![s] = "capture_pending"]
  /\ token' = [token EXCEPT ![s] = "none"]
  /\ UNCHANGED <<active, images, staging, pinned, admittedEver, validated>>

SettleCapture(s) ==
  /\ phase[s] = "capture_pending"
  /\ phase' = [phase EXCEPT ![s] = "captured"]
  /\ UNCHANGED <<active, images, staging, pinned, token, admittedEver, validated>>

CloseSession(s) ==
  /\ phase[s] \in {"created", "authorized", "captured"}
  /\ phase' = [phase EXCEPT ![s] = "closed"]
  /\ pinned' = [pinned EXCEPT ![s] = 0]
  /\ token' = [token EXCEPT ![s] = "none"]
  /\ UNCHANGED <<active, images, staging, admittedEver, validated>>

StageImage ==
  /\ staging = 0
  /\ active < 3
  /\ Cardinality(images) < 2
  /\ staging' = active + 1
  /\ images' = images \cup {active + 1}
  /\ UNCHANGED <<active, phase, pinned, token, admittedEver, validated>>

ValidateImage ==
  /\ staging # 0
  /\ staging \notin validated
  /\ validated' = validated \cup {staging}
  /\ UNCHANGED <<active, images, staging, phase, pinned, token, admittedEver>>

PublishImage ==
  /\ staging # 0
  /\ staging \in validated
  /\ active' = staging
  /\ staging' = 0
  /\ UNCHANGED <<images, phase, pinned, token, admittedEver, validated>>

(* Mutation: publish a staged but unvalidated image. *)
UnsafePublishImage ==
  /\ UnsafePublish
  /\ staging # 0
  /\ staging \notin validated
  /\ active' = staging
  /\ staging' = 0
  /\ UNCHANGED <<images, phase, pinned, token, admittedEver, validated>>

RetireImage(v) ==
  /\ v \in images
  /\ v # active
  /\ v # staging
  /\ \A s \in Sessions : pinned[s] # v
  /\ images' = images \ {v}
  /\ validated' = validated \ {v}
  /\ UNCHANGED <<active, staging, phase, pinned, token, admittedEver>>

(* Mutation: ignores live generation leases. TLC must find NoDanglingPins violation. *)
UnsafeRetire(v) ==
  /\ UnsafePurge
  /\ v \in images
  /\ v # active
  /\ v # staging
  /\ \E s \in Sessions : pinned[s] = v
  /\ images' = images \ {v}
  /\ validated' = validated \ {v}
  /\ UNCHANGED <<active, staging, phase, pinned, token, admittedEver>>

(* Mutation: accepted work times out and incorrectly recreates spent phase. *)
UnsafeTimeout(s) ==
  /\ UnsafeResurrect
  /\ phase[s] = "auth_pending"
  /\ phase' = [phase EXCEPT ![s] = "created"]
  /\ token' = [token EXCEPT ![s] = "created"]
  /\ UNCHANGED <<active, images, staging, pinned, admittedEver, validated>>

Next ==
  \/ \E s \in Sessions : Start(s)
  \/ \E s \in Sessions : AdmitAuthorization(s)
  \/ \E s \in Sessions : TimeoutAuthorization(s)
  \/ \E s \in Sessions : SettleAuthorization(s)
  \/ \E s \in Sessions : AdmitCapture(s)
  \/ \E s \in Sessions : SettleCapture(s)
  \/ \E s \in Sessions : CloseSession(s)
  \/ StageImage
  \/ ValidateImage
  \/ PublishImage
  \/ UnsafePublishImage
  \/ \E v \in Versions : RetireImage(v)
  \/ \E v \in Versions : UnsafeRetire(v)
  \/ \E s \in Sessions : UnsafeTimeout(s)

TypeOK ==
  /\ active \in Versions
  /\ images \subseteq Versions
  /\ staging \in Versions \cup {0}
  /\ validated \subseteq Versions
  /\ phase \in [Sessions -> Phases]
  /\ pinned \in [Sessions -> (Versions \cup {0})]
  /\ token \in [Sessions -> Tokens]
  /\ admittedEver \in [Sessions -> BOOLEAN]

ActiveImagePresent == active \in images
PublishedValidated == active \in validated
ValidatedImagesPresent == validated \subseteq images
CapacityBounded == Cardinality(images) <= 2
StagedImagePresent == staging = 0 \/ staging \in images
NoDanglingPins == \A s \in Sessions : pinned[s] = 0 \/ pinned[s] \in images
TerminalReleasesPin == \A s \in Sessions : phase[s] \in {"idle", "closed"} => pinned[s] = 0
NoSpentPhaseResurrection == \A s \in Sessions : token[s] = "created" => ~admittedEver[s]
TokenMatchesPhase == \A s \in Sessions :
  /\ (phase[s] = "created" => token[s] = "created")
  /\ (phase[s] = "authorized" => token[s] = "authorized")
  /\ (phase[s] \in {"idle", "auth_pending", "auth_uncertain",
                    "capture_pending", "captured", "closed"} => token[s] = "none")

Spec == Init /\ [][Next]_vars
=============================================================================
