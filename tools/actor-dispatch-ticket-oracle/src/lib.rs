//! Backend-neutral *model* checker for actor ticket generation conformance.
//! Does not compile an Atto guest or attest any Java/LLVM/.NET/Wasm runtime.
#[cfg(test)]
use serde_json::Value;

#[cfg(test)]
const MANIFEST: &str =
    include_str!("../../../contracts/actor-dispatch-ticket-generation-v1.json");

#[cfg(test)]
fn manifest() -> Value {
    serde_json::from_str(MANIFEST).expect("actor ticket contract must be valid JSON")
}

/// Reproduce the intentionally broken numeric-slot-only comparator when requested.
#[cfg(test)]
fn same_ticket(live: &Value, submitted: &Value, ignore_generation: bool) -> bool {
    let Some(live) = live.as_array() else { return false };
    let Some(submitted) = submitted.as_array() else { return false };
    if live.len() != 4 || submitted.len() != 4 {
        return false;
    }
    let identity = live[0] == submitted[0]
        && live[1] == submitted[1]
        && live[2] == submitted[2];
    identity && (ignore_generation || live[3] == submitted[3])
}

#[cfg(test)]
fn evaluate(case: &Value, ignore_generation: bool) -> (&'static str, Value) {
    let active = &case["active"];
    let action = &case["action"];
    match action["kind"].as_str().expect("required kind") {
        "issue" => {
            if action["stopped"] == true {
                ("denied_stopped", Value::Null)
            } else if action["exhausted"] == true
                && action["priorSameIdentityReplayable"] == true
            {
                ("denied_collision", Value::Null)
            } else {
                ("admitted", Value::Array(vec![
                    action["actor"].clone(),
                    action["incarnation"].clone(),
                    action["slot"].clone(),
                    action["generation"].clone(),
                ]))
            }
        }
        "complete" | "cancel" | "wake" => {
            let submitted = &action["ticket"];
            if active.is_null() {
                return ("ignored_stale", Value::Null);
            }
            if same_ticket(active, submitted, ignore_generation) {
                if action["kind"] == "wake" {
                    ("woken", active.clone())
                } else {
                    ("completed", Value::Null)
                }
            } else if active[0] != submitted[0] {
                ("ignored_foreign", active.clone())
            } else {
                ("ignored_stale", active.clone())
            }
        }
        other => panic!("unexpected actor dispatch action: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn contract_is_versioned_and_all_case_ids_are_unique() {
        let document = manifest();
        assert_eq!(
            document["schema"],
            "oreslang.actor-dispatch-ticket-generation.v1"
        );
        assert_eq!(document["status"], "PROPOSED_NOT_EXECUTED");
        assert_eq!(
            document["ticketIdentity"],
            json!(["actor_id", "actor_incarnation", "slot", "generation"])
        );
        let cases = document["scenarios"].as_array().expect("scenario array");
        assert_eq!(cases.len(), 12);
        let mut ids = HashSet::new();
        for case in cases {
            let id = case["id"].as_str().expect("case ID");
            assert!(ids.insert(id), "duplicate case ID: {id}");
            assert!(
                case["expected"]
                    .as_object()
                    .is_some_and(|o| o.contains_key("activeAfter")),
                "explicit expected activeAfter field required for {id}"
            );
        }
    }

    #[test]
    fn reference_oracle_matches_every_positive_and_negative_scenario() {
        let document = manifest();
        for case in document["scenarios"].as_array().unwrap() {
            let (result, active_after) = evaluate(case, false);
            assert_eq!(
                result, case["expected"]["result"].as_str().unwrap(),
                "incorrect outcome for {}", case["id"]
            );
            assert_eq!(
                active_after, case["expected"]["activeAfter"],
                "incorrect actor lease transition for {}", case["id"]
            );
        }
    }

    #[test]
    fn numeric_slot_only_aba_mutant_is_detected() {
        let document = manifest();
        let cases = document["scenarios"].as_array().unwrap();
        for id in ["ATG02", "ATG03", "ATG04"] {
            let case = cases.iter().find(|c| c["id"] == id).unwrap();
            let (actual, live) = evaluate(case, true);
            assert_ne!(
                actual,
                case["expected"]["result"].as_str().unwrap(),
                "numeric-slot ABA mutation was not detected in {id}"
            );
            if id != "ATG04" {
                assert!(live.is_null(), "mutation should revoke the new turn");
            }
        }
    }

    #[test]
    fn no_backend_is_promoted_by_an_unexecuted_model() {
        let document = manifest();
        for (backend, status) in document["backendStatus"].as_object().unwrap() {
            assert_eq!(
                status.as_str(),
                Some("NOT_EXECUTED"),
                "false runtime certification for {backend}"
            );
        }
        assert_eq!(document["promotion"]["sourceFreeRustModelCountsAsRuntimeProof"], false);
        assert_eq!(document["promotion"]["exactHeadStepfulRunRequired"], true);
        assert_eq!(document["promotion"]["realBackendSchedulingTestsRequired"], true);
        assert_eq!(document["promotion"]["zeroStepCiCountsAsEvidence"], false);
    }
}
