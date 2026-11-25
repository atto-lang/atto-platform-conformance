//! Fail-closed SOURCE_ONLY SHA/evidence gate for typed actor bool / sends never.
//! It does not compile .atto and cannot promote any backend guest status.
#![forbid(unsafe_code)]
use std::{fs, path::Path, process::Command};

const CASES: [(&str, &str, &str, &str, &str); 4] = [
    ("ACTOR-BOOL-01", "ACCEPT", "NONE",
     "fixtures/typed-actor-bool-v1/actor-bool-never-parity-v1.atto",
     "a103999dd9b047e24ae79fedd88398374bc10590"),
    ("ACTOR-BOOL-02", "REJECT", "E_ACTOR_RECEIVES",
     "fixtures/typed-actor-bool-v1/02-receives-handler-mismatch.atto",
     "fe76f70ef141b7bba74254ecaf7708f881144f32"),
    ("ACTOR-BOOL-03", "REJECT", "E_ACTOR_SEND_CONTRACT",
     "fixtures/typed-actor-bool-v1/03-sends-void-invalid.atto",
     "0f1637268858eeac654cccc7f0c925e4f9c88572"),
    ("ACTOR-BOOL-04", "REJECT", "E_ACTOR_CONTRACT",
     "fixtures/typed-actor-bool-v1/04-duplicate-sends-clause.atto",
     "df6aa49bd474e95d7df5092cea4ff41236c286a6"),
];

fn verify(root: &Path) -> Result<usize, String> {
    let registry = fs::read_to_string(root.join("contracts/typed-actor-bool-v1.tsv"))
        .map_err(|e| format!("missing registry: {e}"))?;
    let rows: Vec<&str> = registry.lines()
        .filter(|line| !line.trim().is_empty() && !line.starts_with('#')).collect();
    if rows.len() != CASES.len() {
        return Err("unexpected number of actor bool cases".to_owned());
    }
    for ((id, expected, diagnostic, path, sha), row) in CASES.into_iter().zip(rows) {
        let canonical = format!("{id}\t{expected}\t{diagnostic}\tNOT_EXECUTED\t{path}\t{sha}");
        if row != canonical {
            return Err(format!("invalid evidence label or expected diagnostic: {id}"));
        }
        let absolute = root.join(path);
        let mode = fs::symlink_metadata(&absolute)
            .map_err(|e| format!("{path}: {e}"))?;
        if !mode.file_type().is_file() || mode.len() == 0 || mode.len() > 65_536 {
            return Err(format!("invalid source fixture: {path}"));
        }
        let source = fs::read_to_string(&absolute)
            .map_err(|e| format!("bad source UTF-8 {path}: {e}"))?;
        if !source.contains("define actor Flag") ||
           !source.contains("receive(ActorMail<bool>") ||
           !source.contains("sends ") {
            return Err(format!("expected actor syntax absent: {id}"));
        }
        let digest = Command::new("git").current_dir(root)
            .args(["hash-object", "--", path]).output()
            .map_err(|e| format!("Git hash unavailable: {e}"))?;
        if !digest.status.success() {
            return Err(format!("Git cannot hash {path}"));
        }
        let actual = String::from_utf8(digest.stdout).map_err(|e| e.to_string())?;
        if actual.trim() != sha {
            return Err(format!("SHA mismatch for {id}"));
        }
    }
    Ok(CASES.len())
}

fn main() {
    match verify(Path::new(".")) {
        Ok(n) => println!("{n} pinned bool actor SOURCE_ONLY fixtures; GUEST_NOT_EXECUTED"),
        Err(e) => { eprintln!("ACTOR_BOOL_SOURCE_DENIED: {e}"); std::process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pins_four_canonical_fixtures() {
        assert_eq!(verify(Path::new(".")), Ok(4));
    }
    #[test]
    fn registry_can_never_promote_a_guest_pass() {
        for (id, expected, diag, path, sha) in CASES {
            let canonical = format!("{id}\t{expected}\t{diag}\tNOT_EXECUTED\t{path}\t{sha}");
            let fraudulent = canonical.replace("NOT_EXECUTED", "PASSED");
            assert_ne!(canonical, fraudulent);
        }
    }
}
