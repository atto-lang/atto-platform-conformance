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
