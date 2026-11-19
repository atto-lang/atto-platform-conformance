//! Fail-closed identity gate for the canonical 15 typed-actor Atto source fixtures.
//! SOURCE-ONLY. This neither compiles AttoLang nor proves runtime parity.
#![forbid(unsafe_code)]
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

const EXPECTED: [&str; 15] = [
    "7b6cf8a13ca4bc93f99ec129779f3a570d77597f",
    "9e1234f5a7b7ea4658b8c69ccce76420b7876027",
    "c399c28ba7228cd99eb2410a680486a7c0694cc5",
    "997f1ea524a74bf648eaf618704ded03910b08a5",
    "3db886a3a1b81f8d3572a673731924f21ffbfc1c",
    "ca6509cdab8353c40b912110247f4ae64f455e54",
    "dfc363a098f8f2620adaf7fc20afed4ffb6610cd",
    "9550c950cd0c6665b2199652f09c53540de29050",
    "c9b37cb3de589328b893b507048cbe0ca9b0e835",
    "e8253f9f68c4bb779ce8c480e614771f3f5cd59d",
    "5562069c89812fb67d999d80600a77002f20af8a",
    "195bcd8c4ff9944d9972e908566187dc76b2f9e1",
    "d993e9e20bb062bd8d2f503e937045126a1979a8",
    "4cc96737c2b549259bc19953357ca6ed1ebbb1c7",
    "36a8b524bcc23e372e7b4e47ce8e9ba82684d3f1",
];

fn git_blob_sha(bytes: &[u8]) -> Result<String, String> {
    let mut child = Command::new("git")
        .args(["hash-object", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("git hash-object unavailable: {e}"))?;
    child.stdin.take().ok_or("git stdin absent")?
        .write_all(bytes).map_err(|e| format!("failed to hash exact source: {e}"))?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("git hash-object failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(String::from_utf8(output.stdout).map_err(|e| e.to_string())?.trim().to_owned())
}

fn indexed_sha(root: &Path, relative: &str) -> Result<String, String> {
    let output = Command::new("git").current_dir(root)
        .args(["ls-files", "--stage", "--", relative])
        .output().map_err(|e| format!("git index unavailable: {e}"))?;
    if !output.status.success() {
        return Err(format!("git ls-files failure: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let raw = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let (meta, path) = raw.trim_end_matches('\n')
        .split_once('\t').ok_or(format!("missing Git index blob for {relative}"))?;
    if path != relative { return Err(format!("unexpected index path: {path}")); }
    let mut fields = meta.split_whitespace();
    if fields.next() != Some("100644") {
        return Err(format!("fixture must be a regular Git blob (100644): {relative}"));
    }
    let sha = fields.next().ok_or("missing index SHA")?;
    if fields.next() != Some("0") || fields.next().is_some() {
        return Err(format!("invalid index stage for {relative}"));
    }
    Ok(sha.to_owned())
}

fn verify(root: &Path) -> Result<usize, String> {
    for (index, sha) in EXPECTED.iter().enumerate() {
        let relative = format!("fixtures/typed-actor-v1/actor-typed-{:02}.atto", index + 1);
        let file = root.join(&relative);
        let mode = fs::symlink_metadata(&file).map_err(|e| format!("{relative}: {e}"))?;
        if !mode.file_type().is_file() {
            return Err(format!("{relative}: symlinks, dirs and other file types forbidden"));
        }
        let bytes = fs::read(&file).map_err(|e| format!("{relative}: {e}"))?;
        if bytes.is_empty() || bytes.len() > 65536 {
            return Err(format!("{relative}: invalid fixture length"));
        }
        let actual = git_blob_sha(&bytes)?;
        if actual != *sha { return Err(format!("{relative}: fixture content SHA mismatch: {actual}")); }
        let tracked = indexed_sha(root, &relative)?;
        if tracked != *sha { return Err(format!("{relative}: Git index blob SHA mismatch: {tracked}")); }
    }
    Ok(EXPECTED.len())
}

fn main() {
    match verify(Path::new(".")) {
        Ok(n) => println!("{n} exact typed-actor fixture SHA pins verified; GUEST_NOT_EXECUTED"),
        Err(e) => { eprintln!("FIXTURE_IDENTITY_DENIED: {e}"); std::process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_15_source_blobs_and_git_modes_are_exact() {
        assert_eq!(verify(Path::new(".")), Ok(15));
    }

    #[test]
    fn one_byte_mutations_invalidate_each_pinned_source_blob() {
        for (index, sha) in EXPECTED.iter().enumerate() {
            let relative = format!("fixtures/typed-actor-v1/actor-typed-{:02}.atto", index + 1);
            let mut bytes = fs::read(&relative).expect("fixture missing");
            bytes.push(0);
            assert_ne!(git_blob_sha(&bytes).expect("git hashing failed"), *sha);
        }
    }

    #[test]
    fn all_pins_are_unique_and_full_git_sha1_ids() {
        let mut unique = std::collections::HashSet::new();
        for sha in EXPECTED {
            assert_eq!(sha.len(), 40);
            assert!(sha.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
            assert!(unique.insert(sha), "duplicate fixture pin");
        }
    }
}
