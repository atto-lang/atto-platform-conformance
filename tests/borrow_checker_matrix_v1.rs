//! Dependency-free, host-only static validation of borrow-checker-v1.tsv.
//! This test DOES NOT compile or execute Atto guest programs.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const MANIFEST: &str = include_str!("../contracts/borrow-checker-v1.tsv");
const RECEIPTS: &str = include_str!("../contracts/borrow-checker-execution-v1.tsv");
const PARITY: &str = include_str!("../contracts/borrow-checker-host-parity-v1.tsv");
const VERIFIED_SLICE: &str = "VERIFIED_NATIVE_RUST_TO_WASM_GUEST";
fn expected_case_status(id: &str) -> &'static str {
    match id {
        "BCV1-003" | "BCV1-004" | "BCV1-007" | "BCV1-008" | "BCV1-015" | "BCV1-016" => VERIFIED_SLICE,
        _ => "NOT_EXECUTED",
    }
}

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
        assert_eq!(c.status, expected_case_status(c.id), "unproven or incorrectly generalized backend result for {}", c.id);
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
            assert!(source.contains(*spelling),
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
    // The only executed slice has exact per-case receipts; all other cases remain unexecuted.
    for c in cases() {
        assert_eq!(c.status, expected_case_status(c.id));
        assert!(matches!(c.verdict, "PASS" | "REJECT"));
        assert_ne!(c.oracle, "PASSED");
        assert_ne!(c.oracle, "UNSUPPORTED");
    }
}


#[test]
fn native_and_wasm32_compiler_parity_receipts_bind_original_execution() {
    // This is a *receipt integrity check*, not a new compiled guest run.
    let mut src = PARITY.lines();
    assert_eq!(src.next(), Some("id\tcompiler_tree\tnative_compiler_sha256\twasm32_compiler_sha256\tfixture_blob_sha\tguest_artifact_sha256\tresult\tcarrier_run_id\tcarrier_job_id"));
    let prior: BTreeMap<&str, Vec<&str>> = RECEIPTS.lines().skip(1)
        .map(|l| {
            let f: Vec<_> = l.split('\t').collect();
            assert_eq!(f.len(), 13);
            (f[0], f)
        }).collect();
    let all = cases();
    let mut seen = BTreeSet::new();
    for l in src {
        let v: Vec<&str> = l.split('\t').collect();
        assert_eq!(v.len(), 9, "bad native-vs-Wasm32 parity receipt row");
        let id = v[0];
        assert!(seen.insert(id), "duplicate parity case {}", id);
        let c = all.iter().find(|c| c.id == id).expect("unknown parity case");
        assert_eq!(c.status, VERIFIED_SLICE, "no parity promotion of target-only cases");
        let original = prior.get(id).expect("missing prior guest receipt");
        assert_eq!(v[1], original[6], "compiler source Git tree changed");
        assert_eq!(v[2], original[7], "native compiler binary changed");
        assert_eq!(v[4], original[8], "fixture Git blob changed");
        assert_eq!(v[5], original[9], "compiled guest digest changed");
        for i in [2usize, 3usize] {
            assert_eq!(v[i].len(), 64, "short compiler digest: {}", id);
            assert!(v[i].bytes().all(|b| b.is_ascii_hexdigit()));
        }
        assert_eq!(v[7], "44449360766", "unreviewed parity run");
        assert_eq!(v[8], "135309223758", "unreviewed parity job");
        let expected = match c.verdict {
            "PASS" => "BYTE_IDENTICAL_GUEST_EXIT_42".to_owned(),
            "REJECT" => format!("BOTH_HOSTS_REJECT_{}_NO_ARTIFACT", c.oracle),
            other => panic!("bad case verdict: {}", other),
        };
        assert_eq!(v[6], expected, "unreviewed parity result for {}", id);
        let expected_wasm = match c.operation {
            "implicit_borrow" | "write_loan" => "13da68a9329f3e1f2a191473334965d4476a92a9d4866d06daaa2ec975328cf9",
            "copy_deep" => "de0cd07b7239d07141d06f678ba0e056fa7b678ebe1ab30466526236967712da",
            _ => panic!("unadmitted parity operation"),
        };
        assert_eq!(v[3], expected_wasm, "unexpected wasm32-hosted compiler output");
    }
    assert_eq!(seen.len(), 6, "exact six-case compiler differential expected");
    assert_eq!(seen.len(), prior.len(), "missing or extra parity receipts");
}

#[test]
fn native_rust_wasm_guest_receipts_bind_exact_case_blobs() {
    let mut entries = RECEIPTS.lines();
    assert_eq!(entries.next(), Some("id\tbackend\tresult\tsource_head\tsource_tree\tcompiler_head\tcompiler_tree\tcompiler_sha256\tfixture_blob_sha\tguest_artifact_sha256\tdiagnostic\tcarrier_run_id\tcarrier_job_id"));
    let all = cases();
    let root = Path::new(file!()).parent().expect("tests/").parent().expect("root/");
    let mut seen = BTreeSet::new();
    for line in entries {
        let f: Vec<&str> = line.split('\t').collect();
        assert_eq!(f.len(), 13, "malformed exact execution receipt");
        let c = all.iter().find(|c| c.id == f[0]).expect("receipt must reference real case");
        assert_eq!(c.status, VERIFIED_SLICE);
        assert!(seen.insert(f[0]), "duplicated executed case");
        assert_eq!(f[1], "native_rust_compiler_to_wasm_guest");
        assert_eq!(f[3], "7adbc6341d408236d9f8bcb705def915db5e22ab");
        assert_eq!(f[4], "de57c0a7f46d2b2a1cbd830e032fc0587b67c80d");
        for i in [3, 4, 5, 6, 8] {
            assert_eq!(f[i].len(), 40, "short Git SHA in {}", c.id);
            assert!(f[i].bytes().all(|b| b.is_ascii_hexdigit()));
        }
        assert_eq!(f[7].len(), 64, "compiler binary SHA-256 missing");
        assert!(f[7].bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(f[11], "44446731449");
        match c.verdict {
            "PASS" => {
                assert_eq!(f[2], "GUEST_EXIT_42");
                assert_eq!(f[9].len(), 64);
                assert_eq!(f[10], "-");
            }
            "REJECT" => {
                assert_eq!(f[2], "NO_ARTIFACT_REJECTION");
                assert_eq!(f[9], "-");
                assert_eq!(f[10], c.oracle);
            }
            _ => panic!("unsupported verdict"),
        }
        let path = root.join(c.fixture);
        let output = std::process::Command::new("git").arg("hash-object").arg(&path)
            .output().expect("git hash-object must execute");
        assert!(output.status.success(), "cannot hash receipt fixture {}", c.id);
        let actual = String::from_utf8(output.stdout).expect("UTF-8 blob SHA");
        assert_eq!(actual.trim(), f[8], "receipt fixture bytes drifted: {}", c.id);
    }
    assert_eq!(seen.len(), 6, "exactly six admitted fixture receipts");
    for c in all {
        assert_eq!(seen.contains(c.id), c.status == VERIFIED_SLICE);
    }
}
