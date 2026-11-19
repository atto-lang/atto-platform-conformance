//! Immutable source-identity gate for the four portable actor-message fixtures.
//!
//! This is deliberately a Git-blob check, NOT a compiler, runtime, or
//! cross-backend parity test. The Java and conformance copies must be compared
//! independently at their exact source commits before claiming pairwise parity.
//! The test fails closed on missing Git, a subprocess failure, or changed bytes.

use std::io::Write;
use std::process::{Command, Stdio};

const FIXTURES: [(&str, &[u8], &str); 4] = [
    (
        "positive-multiple-recipients.atto",
        include_bytes!("../../../contracts/actor-message-v1/positive-multiple-recipients.atto"),
        "96e4e4e256024b811ce13aca30ddf7f97efacf95",
    ),
    (
        "negative-wrong-downstream-payload.atto",
        include_bytes!("../../../contracts/actor-message-v1/negative-wrong-downstream-payload.atto"),
        "3ccbdfff9bca98fc57b316b17402f97ce2df403c",
    ),
    (
        "negative-unverified-sends.atto",
        include_bytes!("../../../contracts/actor-message-v1/negative-unverified-sends.atto"),
        "a89af0af93806a0f97152fe19cbde4519467c9ab",
    ),
    (
        "negative-receives-never.atto",
        include_bytes!("../../../contracts/actor-message-v1/negative-receives-never.atto"),
        "66f81c7778f7a8ead36c9a4ad46fe79ee3990da6",
    ),
];

fn git_blob_sha(data: &[u8]) -> String {
    // Git hashes "blob <size>\0<bytes>". Hash stdin directly so this test
    // cannot accidentally use the index, a different branch, or a cached blob.
    let mut child = Command::new("git")
        .args(["hash-object", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("git hash-object is required for exact fixture-identity checks");
    {
        let mut stdin = child.stdin.take().expect("git hash-object stdin unavailable");
        stdin
            .write_all(data)
            .expect("failed writing exact fixture bytes to git hash-object");
    }
    let output = child.wait_with_output().expect("git hash-object failed to finish");
    assert!(
        output.status.success(),
        "git hash-object failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git hash-object did not emit UTF-8")
        .trim()
        .to_owned()
}

#[test]
fn four_portable_atto_fixtures_have_the_exact_approved_git_blobs() {
    for (name, bytes, expected) in FIXTURES {
        assert_eq!(
            git_blob_sha(bytes),
            expected,
            "{name}: fixture bytes changed; reapprove both exact source heads"
        );
    }
}

fn indexed_fixture_sha(repo_root: &std::path::Path, path: &str) -> String {
    // A byte-identical symlink target is NOT an identical tracked Git blob.
    // Require an ordinary (100644) stage-zero file at the exact path.
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(["ls-files", "--stage", "--"])
        .arg(path)
        .output()
        .expect("git ls-files must be available for source identity");
    assert!(
        output.status.success(),
        "git ls-files failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let output = std::str::from_utf8(&output.stdout).expect("Git index entry is not UTF-8");
    let (entry, indexed_path) = output
        .trim_end_matches('\n')
        .split_once('\t')
        .expect("fixture missing from Git index or malformed index entry");
    assert_eq!(indexed_path, path, "unexpected Git index fixture path");
    let mut fields = entry.split_whitespace();
    assert_eq!(fields.next(), Some("100644"), "{path}: not a regular Git blob");
    let sha = fields.next().expect("fixture index entry lacks blob SHA");
    assert_eq!(fields.next(), Some("0"), "{path}: nonzero Git index stage");
    assert_eq!(fields.next(), None, "{path}: malformed Git index entry");
    sha.to_owned()
}

#[test]
fn four_fixtures_are_regular_tracked_git_blobs_matching_embedded_bytes() {
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (name, bytes, expected) in FIXTURES {
        let rel_path = format!("contracts/actor-message-v1/{name}");
        let fixture_path = repo_root.join(&rel_path);
        let metadata =
            std::fs::symlink_metadata(&fixture_path).expect("fixture missing from checkout");
        assert!(
            metadata.file_type().is_file(),
            "{name}: symlinks and non-files are not permitted"
        );
        assert_eq!(
            std::fs::read(&fixture_path).expect("failed reading fixture"),
            bytes,
            "{name}: checked-out fixture differs from embedded bytes"
        );
        assert_eq!(
            indexed_fixture_sha(&repo_root, &rel_path),
            expected,
            "{name}: Git index blob identity or file mode differs from approved source"
        );
    }
}

#[test]
fn single_byte_fixture_mutations_are_detected() {
    for (name, bytes, expected) in FIXTURES {
        let mut modified = bytes.to_vec();
        modified.push(0);
        assert_ne!(
            git_blob_sha(&modified),
            expected,
            "{name}: a mutated fixture must never satisfy its original pin"
        );
    }
}
