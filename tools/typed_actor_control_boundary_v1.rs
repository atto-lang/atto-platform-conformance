//! Source-only typed DATA vs supervisor CONTROL admission model.
//! This is not a compiled Atto guest, physical Worker test, or security proof.
#![forbid(unsafe_code)]
use std::{collections::BTreeSet, fs};

const PATH: &str = "contracts/typed-actor-control-boundary-v1.tsv";
const CASES: [(&str, &str, &str, &str); 8] = [
    ("CONTROL-001", "APP_DATA_CANNOT_ASSERT_CONTROL", "DENY", "HOST_ONLY"),
    ("CONTROL-002", "FOREIGN_WORKER_TERMINAL_NOTICE", "DENY", "HOST_ONLY"),
    ("CONTROL-003", "STALE_GENERATION_TERMINAL_NOTICE", "DENY", "HOST_ONLY"),
    ("CONTROL-004", "REPLAYED_TERMINAL_NOTICE", "DENY", "HOST_ONLY"),
    ("CONTROL-005", "HIDDEN_SYMBOL_OR_ACCESSOR_FIELDS", "DENY", "HOST_ONLY"),
    ("CONTROL-006", "PROXY_DESCRIPTOR_VALUE_SNAPSHOT", "DENY_LATE_GET", "HOST_ONLY"),
    ("CONTROL-007", "FULL_DATA_QUEUE_SUPERVISOR_CONTROL", "CONTROL_PRIORITY", "GUEST_REQUIRED"),
    ("CONTROL-008", "FORCED_TERMINATION_NO_GUEST_RECOVER", "SEPARATE_HOST_FAULT", "GUEST_REQUIRED"),
];

fn verify() -> Result<(), String> {
    let content = fs::read_to_string(PATH).map_err(|err| err.to_string())?;
    let mut lines = content.lines();
    if lines.next() != Some("# id\tboundary\ttarget\tstatus\tevidence_kind") {
        return Err("unexpected schema header".into());
    }
    let mut ids = BTreeSet::new();
    for (i, line) in lines.enumerate() {
        let cols: Vec<_> = line.split('\t').collect();
        if cols.len() != 5 || i >= CASES.len() {
            return Err("wrong registry arity/length".into());
        }
        let (id, boundary, result, evidence) = CASES[i];
        if cols != [id, boundary, result, "NOT_EXECUTED", evidence] {
            return Err(format!("case {} mutated or falsely promoted", i + 1));
        }
        if !ids.insert(id) {
            return Err("duplicate case ID".into());
        }
    }
    if ids.len() != CASES.len() {
        return Err("missing CONTROL cases".into());
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Lane { ApplicationData, SupervisorControl, HostFault }
#[derive(Clone, Copy, Debug)]
struct Context {
    actual_worker: u64,
    expected_worker: u64,
    generation: u64,
    expected_generation: u64,
    sequence: u64,
    terminal_already_seen: bool,
    exact_own_data_snapshot: bool,
    bound_host_authority: bool,
    data_queue_full: bool,
}
fn admit(lane: Lane, c: Context) -> Result<&'static str, &'static str> {
    if lane == Lane::HostFault { return Ok("SEPARATE_HOST_FAULT"); }
    if lane == Lane::ApplicationData { return Err("DATA_CANNOT_ASSERT_CONTROL"); }
    if c.actual_worker != c.expected_worker || !c.bound_host_authority {
        return Err("FOREIGN_WORKER");
    }
    if c.generation != c.expected_generation { return Err("STALE_GENERATION"); }
    if c.terminal_already_seen || c.sequence != 0 { return Err("REPLAY"); }
    if !c.exact_own_data_snapshot { return Err("FORGED_SHAPE"); }
    // CONTROL priority is independent of application DATA occupancy.
    let _ = c.data_queue_full;
    Ok("CONTROL_PRIORITY")
}
fn baseline() -> Context {
    Context {
        actual_worker: 7, expected_worker: 7,
        generation: 3, expected_generation: 3,
        sequence: 0, terminal_already_seen: false,
        exact_own_data_snapshot: true, bound_host_authority: true,
        data_queue_full: false
    }
}
fn main() {
    match verify() {
        Ok(()) => println!("8 CONTROL SOURCE_ONLY target cases, guest=NOT_EXECUTED"),
        Err(err) => { eprintln!("{err}"); std::process::exit(1); }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn registry_status_must_not_claim_any_executed_guest() {
        verify().unwrap();
    }
    #[test] fn typed_data_cannot_be_escalated_by_sender_claim() {
        assert_eq!(admit(Lane::ApplicationData, baseline()), Err("DATA_CANNOT_ASSERT_CONTROL"));
    }
    #[test] fn worker_and_privilege_must_be_physically_bound() {
        let mut c = baseline();
        c.actual_worker = 9;
        assert_eq!(admit(Lane::SupervisorControl, c), Err("FOREIGN_WORKER"));
        c = baseline(); c.bound_host_authority = false;
        assert_eq!(admit(Lane::SupervisorControl, c), Err("FOREIGN_WORKER"));
    }
    #[test] fn generation_and_single_use_replay_fence() {
        let mut c = baseline(); c.generation = 2;
        assert_eq!(admit(Lane::SupervisorControl, c), Err("STALE_GENERATION"));
        c = baseline(); c.terminal_already_seen = true;
        assert_eq!(admit(Lane::SupervisorControl, c), Err("REPLAY"));
        c = baseline(); c.sequence = 1;
        assert_eq!(admit(Lane::SupervisorControl, c), Err("REPLAY"));
    }
    #[test] fn descriptor_validation_cannot_be_skipped() {
        let mut c = baseline(); c.exact_own_data_snapshot = false;
        assert_eq!(admit(Lane::SupervisorControl, c), Err("FORGED_SHAPE"));
    }
    #[test] fn data_backpressure_cannot_starve_supervisor_control_in_model() {
        let mut c = baseline(); c.data_queue_full = true;
        assert_eq!(admit(Lane::SupervisorControl, c), Ok("CONTROL_PRIORITY"));
    }
    #[test] fn forced_worker_failure_does_not_forge_guest_cleanup() {
        assert_eq!(admit(Lane::HostFault, baseline()), Ok("SEPARATE_HOST_FAULT"));
    }
}
