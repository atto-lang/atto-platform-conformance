//! Contract-only authority-intersection oracle. NOT a guest runtime or a CLI parser.
//! Run on a Rust toolchain: rustc --edition=2021 --test tests/host-permissions-v1.rs -o /tmp/atto-permissions-oracle && /tmp/atto-permissions-oracle
use std::collections::HashSet;

fn matches(scope: &str, resource: &str) -> bool {
    scope == "*" || scope == resource
}

fn admit(fields: &[&str]) -> bool {
    let resource = fields[1];
    // All positive ceilings must independently contain the resource.
    let allowed = fields[2..8].iter().all(|scope| matches(scope, resource));
    // Explicit deny overrides every layer's positive decision. No fallback.
    let denied = fields[8] != "-" && matches(fields[8], resource);
    allowed && !denied
}

#[test]
fn canonical_host_permission_vectors() {
    let table = include_str!("../contracts/host-permissions-v1.tsv");
    let mut lines = table.lines();
    assert_eq!(
        lines.next(),
        Some("id\tresource\thost\tartifact\truntime\ttenant\tactor\tdelegated\texplicit_deny\texpected")
    );
    let mut seen = HashSet::new();
    let mut count = 0;
    let mut positive = 0;
    let mut negative = 0;
    for (line_number, line) in lines.enumerate() {
        let fields: Vec<&str> = line.split('\t').collect();
        assert_eq!(fields.len(), 10, "line {} arity", line_number + 2);
        assert!(seen.insert(fields[0]), "duplicate case id {}", fields[0]);
        assert!(!fields[1].is_empty(), "empty resource");
        assert!(fields[2..9].iter().all(|s| !s.is_empty()), "empty authority scope");
        let expected = match fields[9] {
            "ALLOW" => { positive += 1; true },
            "DENY" => { negative += 1; false },
            other => panic!("unknown expectation {other}"),
        };
        assert_eq!(admit(&fields), expected, "mismatched vector {}", fields[0]);
        count += 1;
    }
    assert_eq!(count, 26, "case count changed; review the contract");
    assert!(positive >= 5 && negative >= 10, "negative test coverage degraded");
}

#[test]
fn missing_runtime_grant_does_not_inherit_host_access() {
    let fields = ["missing", "fs.read:secret", "*", "*", "-", "*", "*", "*", "-", "DENY"];
    assert!(!admit(&fields));
}

#[test]
fn denying_all_cannot_be_overridden_by_unrestricted_grants() {
    let fields = ["explicit-deny", "net.connect:example.com:443", "*", "*", "*", "*", "*", "*", "*", "DENY"];
    assert!(!admit(&fields));
}
