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
        // Candidate identifies a known compiler slice, NOT an executed result.
        let expected_admission = match c.operation {
            "implicit_borrow" | "write_loan" => "PROFILE_CANDIDATE_DRAFT",
            "copy_deep" => "COMPILER_CANDIDATE_MERGED",
            _ => "TARGET_ONLY",
        };
        assert_eq!(c.admission, expected_admission, "unexpected compiler admission label for {}", c.id);
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
        let first = source.lines().next().unwrap_or_default();
        let id_header = format!("// {}", c.id);
        if c.admission == "PROFILE_CANDIDATE_DRAFT" {
            // The Rust/Wasm compiler's experimental opt-in MUST be physical line 1.
            assert_eq!(first, "// atto-ownership: borrow-default-v1", "migration profile missing for {}", c.id);
            assert!(source.lines().nth(1).unwrap_or_default().starts_with(&id_header), "case identity must follow profile: {}", c.id);
        } else {
            assert!(first.starts_with(&id_header), "missing case identity: {}", c.id);
        }
        if c.admission != "TARGET_ONLY" {
            let oracle = if c.verdict == "PASS" { "// expect-exit: 42".to_owned() }
                         else { format!("// expect-error: {}", c.oracle) };
            assert!(source.lines().take(5).any(|line| line == oracle), "compiler-candidate oracle header mismatch for {}", c.id);
        }
        assert!(source.contains(&format!(" {} ", c.operation)), "wrong operation header: {}", c.id);
        assert!(source.contains("pub fnc main()"), "no standalone main(): {}", c.id);
        assert!(source.ends_with('\n'), "no trailing newline: {}", c.id);
        assert!(!source.contains("import python"), "Atto-only guests: {}", c.id);
    }
}

#[test]
fn canonical_bang_vocabulary_and_implicit_call_loans_are_covered() {
    // Source-level coverage only: this guard cannot prove any Atto guest ran.
    let root = Path::new(file!()).parent().expect("tests/").parent().expect("root/");
    let samples: &[(&str, &[&str])] = &[
        ("implicit-borrow", &["inspect(original)", "inspect(borrow! original)"]),
        ("write-loan", &["update(mut counter)", "read(borrow! counter)"]),
        ("read-loan", &["borrow!"]),
        ("take", &["take!"]),
        ("share", &["share!"]),
        ("copy-shallow", &["copy!"]),
        ("copy-deep", &["copy!!"]),
        ("pin", &["pin! take!"]),
        ("drop", &["drop!"]),
        ("freeze", &["freeze!"]),
        ("weak", &["weak!"]),
    ];
    for (fixture, required) in samples {
        let path = root.join(format!("fixtures/borrow-checker-v1/pass/{fixture}.atto"));
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        for spelling in *required {
            assert!(source.contains(spelling),
                "{} must exercise canonical ownership spelling: {spelling}", path.display());
        }
    }

    // Legacy Oreslang rt-borrow spellings must never re-enter Atto guest fixtures.
    // Omitted borrow! at a nonprimitive call site is intentional, not a move.
    for c in cases() {
        let source = std::fs::read_to_string(root.join(c.fixture))
            .unwrap_or_else(|e| panic!("{}: {e}", c.fixture));
        for legacy in ["rt borrow ", "rt mut borrow ", "rt take ", "rt copy "] {
            assert!(!source.contains(legacy),
                "{} reintroduces legacy ownership syntax: {legacy}", c.fixture);
        }
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
