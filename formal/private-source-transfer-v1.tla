---------------- MODULE PrivateSourceTransferV1 ----------------
EXTENDS Naturals, TLC
\* Abstract state machine only. This project never exports source.
VARIABLES incidentsClear, reviewed, policyMerged, policyProtected,
          destinationVerified, retentionVerified, allowlistBound, exported
vars == <<incidentsClear, reviewed, policyMerged, policyProtected,
          destinationVerified, retentionVerified, allowlistBound, exported>>

Init ==
  /\ ~incidentsClear /\ ~reviewed /\ ~policyMerged /\ ~policyProtected
  /\ ~destinationVerified /\ ~retentionVerified /\ ~allowlistBound /\ ~exported

ResolveIncidents == /\ ~exported /\ incidentsClear' = TRUE
  /\ UNCHANGED <<reviewed,policyMerged,policyProtected,destinationVerified,
                 retentionVerified,allowlistBound,exported>>
Review == /\ ~exported /\ reviewed' = TRUE
  /\ UNCHANGED <<incidentsClear,policyMerged,policyProtected,destinationVerified,
                 retentionVerified,allowlistBound,exported>>
MergeProtectedPolicy == /\ ~exported /\ policyMerged' = TRUE /\ policyProtected' = TRUE
  /\ UNCHANGED <<incidentsClear,reviewed,destinationVerified,retentionVerified,
                 allowlistBound,exported>>
VerifyDestination == /\ ~exported /\ destinationVerified' = TRUE
  /\ retentionVerified' = TRUE /\ allowlistBound' = TRUE
  /\ UNCHANGED <<incidentsClear,reviewed,policyMerged,policyProtected,exported>>
Export == /\ ~exported
  /\ incidentsClear /\ reviewed /\ policyMerged /\ policyProtected
  /\ destinationVerified /\ retentionVerified /\ allowlistBound
  /\ exported' = TRUE
  /\ UNCHANGED <<incidentsClear,reviewed,policyMerged,policyProtected,
                 destinationVerified,retentionVerified,allowlistBound>>

Next == ResolveIncidents \/ Review \/ MergeProtectedPolicy \/ VerifyDestination \/ Export
Spec == Init /\ [][Next]_vars
TypeOK == /\ incidentsClear \in BOOLEAN /\ reviewed \in BOOLEAN
          /\ policyMerged \in BOOLEAN /\ policyProtected \in BOOLEAN
          /\ destinationVerified \in BOOLEAN /\ retentionVerified \in BOOLEAN
          /\ allowlistBound \in BOOLEAN /\ exported \in BOOLEAN
NoUnauthorizedExport == exported =>
  (incidentsClear /\ reviewed /\ policyMerged /\ policyProtected /\
   destinationVerified /\ retentionVerified /\ allowlistBound)
\* TLC/Apalache not run; abstraction does not prove any real publisher/ref policy.
=============================================================================
