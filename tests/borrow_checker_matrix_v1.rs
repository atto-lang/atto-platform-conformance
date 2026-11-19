//! Dependency-free, host-only static validation of borrow-checker-v1.tsv.
//! This test DOES NOT compile or execute Atto guest programs.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const MANIFEST: &str = include_str!("../contracts/borrow-checker-v1.tsv");
const HEADER: &str = "id\toperation\tverdict\toracle\tfixture\tspec_reference\tbackend_status\tadmission";

#[derive(Debug)]
struct Case<'a> {
    id: &'a str, operation: &'a str, verdict: &'a str, oracle: &'a str,
    fixture: &'a str, spec: &'a str, status: &'a str, admission: &'a str,
}

fn cases() -> Vec<Case<'static>> {
    let mut lines = MANIFEST.lines();
    assert_eq!(lines.next(), Some(HEADER), "versioned TSV schema mismatch");
    lines.filter(|line| !line.trim().is_empty() && !line.starts_with('#'))
        .map(|line| {
            let fields: Vec<&str> = line.split('\t').collect();
            assert_eq!(fields.len(), 8, "expected 8 TSV fields: {line}");
            Case { id: fields[0], operation: fields[1], verdict: fields[2],
                oracle: fields[3], fixture: fields[4], spec: fields[5],
                status: fields[6], admission: fields[7] }
        })
        .collect()
}

#[test]
fn complete_pairwise_coverage() {
    let cases = cases();
    assert_eq!(cases.len(), 40, "20 paired operation families expected");
    let mut ops: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut paths = BTreeSet::new();
    for c in &cases {
        assert!(c.id.starts_with("BCV1-"), "bad id: {}", c.id);
        assert!(ids.insert(c.id), "duplicate id: {}", c.id);
        assert!(paths.insert(c.fixture), "duplicate fixture: {}", c.fixture);
        assert!(!c.operation.is_empty());
        assert!(c.spec.contains('#'), "missing PR provenance for {}", c.id);
        assert_eq!(c.status, "NOT_EXECUTED", "unproven backend success for {}", c.id);
        assert_eq!(c.admission, "TARGET_ONLY", "never infer compiler admission from a static registry");
        match c.verdict {
            "PASS" => assert_eq!(c.oracle, "RETURNS_42"),
            "REJECT" => assert!(c.oracle.starts_with("E_"), "no rejection diagnostic: {}", c.id),
            other => panic!("unsupported verdict {} in {}", other, c.id),
        }
        ops.entry(c.operation).or_default().insert(c.verdict);
    }
    assert_eq!(ops.len(), 20);
    for (op, verdicts) in ops {
        assert_eq!(verdicts, BTreeSet::from(["PASS", "REJECT"]), "incomplete pair for {op}");
    }
}

#[test]
fn fixtures_exist_and_match_case_identity() {
    // The workflow invokes this test from the repository root.
    let root = Path::new(file!()).parent().expect("tests/").parent().expect("root/");
    for c in cases() {
        assert!(c.fixture.starts_with("fixtures/borrow-checker-v1/"));
        assert!(c.fixture.ends_with(".atto"));
        assert!(!c.fixture.contains(".."), "path traversal: {}", c.fixture);
        let expected_dir = if c.verdict == "PASS" { "/pass/" } else { "/fail/" };
        assert!(c.fixture.contains(expected_dir), "fixture directory disagrees with verdict");
        let path = root.join(c.fixture);
        let source = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        assert!(source.starts_with(&format!("// {}", c.id)), "missing case identity: {}", c.id);
        assert!(source.contains(&format!(" {} ", c.operation)), "wrong operation header: {}", c.id);
        assert!(source.contains("pub fnc main()"), "no standalone main(): {}", c.id);
        assert!(source.ends_with('\n'), "no trailing newline: {}", c.id);
        assert!(!source.contains("import python"), "Atto-only guests: {}", c.id);
    }
}

#[test]
fn do_not_conflate_oracle_with_evidence() {
    // The integration matrix begins without real source-to-guest evidence.
    for c in cases() {
        assert!(matches!(c.status, "NOT_EXECUTED"));
        assert!(matches!(c.verdict, "PASS" | "REJECT"));
        assert_ne!(c.oracle, "PASSED");
        assert_ne!(c.oracle, "UNSUPPORTED");
    }
}
