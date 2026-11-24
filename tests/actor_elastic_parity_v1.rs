//! Rust-first SOURCE-FREE registry validation only.
//! This is NOT a compiled .atto guest test and cannot promote backend parity.
use std::collections::BTreeSet;
use std::path::Path;

const MATRIX: &str = include_str!("../contracts/actor-elastic-parity-v1.tsv");
const CASES: &str = include_str!("../contracts/actor-elastic-cases-v1.tsv");

fn parse_rows<'a>(raw: &'a str, header: &str, field_count: usize) -> Vec<Vec<&'a str>> {
    let mut content = raw
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'));
    assert_eq!(content.next(), Some(header), "unexpected versioned table header");
    let mut out = Vec::new();
    for line in content {
        let fields: Vec<&str> = line.split('\t').collect();
        assert_eq!(fields.len(), field_count, "wrong column count: {line}");
        assert!(fields.iter().all(|s| !s.is_empty()), "blank field: {line}");
        out.push(fields);
    }
    out
}

fn matrix() -> Vec<Vec<&'static str>> {
    parse_rows(
        MATRIX,
        "backend\trepository\ttarget\timplementation_stage\thost_pr\trequired_behavior\thost_ci\tcompiler_positive_negative\tguest_execution",
        9,
    )
}

fn cases() -> Vec<Vec<&'static str>> {
    parse_rows(
        CASES,
        "case_id\tkind\trequired_observation\tfixture\texecution_status",
        5,
    )
}

#[test]
fn all_eleven_exact_implementation_repositories_are_accounted_for() {
    let rows = matrix();
    let expected = [
        "java", "llvm", "net", "wasm", "forge", "rs", "js", "cranelift",
        "hdl", "realtime", "atto",
    ];
    assert_eq!(rows.len(), expected.len());
    let mut seen = BTreeSet::new();
    for row in rows {
        let backend = row[0];
        assert!(expected.contains(&backend), "unknown backend: {backend}");
        assert!(seen.insert(backend), "duplicate backend: {backend}");
        assert_eq!(row[1], format!("atto-lang/atto-source.{backend}"));
        assert!(row[2].chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'));
        assert_eq!(&row[6..9], &["NOT_EXECUTED", "NOT_EXECUTED", "NOT_EXECUTED"]);
        assert_ne!(row[5], "PASS", "a required behavior is not CI evidence");
        if row[4] != "-" {
            assert!(row[4].parse::<u32>().unwrap_or(0) > 0, "invalid backend PR");
        }
    }
    assert_eq!(seen.len(), 11);
}

#[test]
fn thirty_case_oracles_are_unique_and_target_only() {
    let rows = cases();
    assert_eq!(rows.len(), 30);
    let mut ids = BTreeSet::new();
    let mut categories = BTreeSet::new();
    for row in rows {
        assert!(ids.insert(row[0]), "duplicate case id: {}", row[0]);
        assert!(row[0].chars().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-'));
        assert_eq!(row[4], "NOT_EXECUTED", "no runner/guest receipts exist");
        assert!(!row[2].contains("PASSED"), "never self-certify target case");
        categories.insert(row[1]);
        if row[3] != "-" {
            let path = Path::new(row[3]);
            assert_eq!(path.extension().and_then(|ext| ext.to_str()), Some("atto"));
            assert!(path.is_file(), "missing canonical fixture: {}", row[3]);
        }
    }
    assert!(categories.contains("COMPILE_NEGATIVE"));
    assert!(categories.contains("GUEST_RUNTIME"));
    assert!(categories.contains("SECURITY"));
    assert!(categories.contains("TARGET_REJECT_OR_PROFILE"));
    assert!(ids.contains("pool-grow-two-to-eight"));
    assert!(ids.contains("serial-method-during-await"));
    assert!(ids.contains("default-overlapping-receives"));
    assert!(ids.contains("stale-worker-inventory"));
    assert!(ids.contains("actor-task-shared-cap"));
    assert!(ids.contains("tenant-domain-confinement"));
    assert!(ids.contains("unsupported-no-fallback"));
}

#[test]
fn hardware_and_realtime_do_not_implicitly_use_hosted_worker_semantics() {
    let rows = matrix();
    let by_name = |name| -> Vec<String> {
        rows.iter()
            .find(|row| row[0] == name)
            .expect("backend missing")
            .iter()
            .map(|field| (*field).to_owned())
            .collect()
    };
    let hdl = by_name("hdl");
    let realtime = by_name("realtime");
    let self_hosted = by_name("atto");
    assert_eq!(hdl[5], "EXPLICIT_REJECT_DYNAMIC_CARRIER_POLICY");
    assert_eq!(realtime[5], "REJECT_DYNAMIC_UNLESS_PREALLOCATED_STATIC_PROFILE");
    assert_eq!(self_hosted[5], "EXPLICIT_REJECT_UNTIL_BOOTSTRAPPED");
    assert_eq!(hdl[8], "NOT_EXECUTED");
    assert_eq!(realtime[8], "NOT_EXECUTED");
    assert_eq!(self_hosted[8], "NOT_EXECUTED");
}

#[test]
fn versioned_registry_denies_empty_and_malformed_oracle_rows() {
    let header = "case_id\tkind\trequired_observation\tfixture\texecution_status";
    let missing = format!("# versioned\n{header}\ncase-1\tGUEST_RUNTIME\tvalue\t-\n");
    assert!(std::panic::catch_unwind(|| parse_rows(&missing, header, 5)).is_err());
    let blank = format!("# versioned\n{header}\ncase-1\t\tvalue\t-\tNOT_EXECUTED\n");
    assert!(std::panic::catch_unwind(|| parse_rows(&blank, header, 5)).is_err());
}
