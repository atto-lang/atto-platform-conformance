//! Exact-source admission gate for typed ActorMail<string> guest targets.
//! Verifies fixture identities and source-only status; DOES NOT compile Atto.
#![forbid(unsafe_code)]
use std::{fs, path::Path, process::Command};

const EXPECTED: [[&str; 6]; 5] = [
    ["ACTOR-STRING-01", "ACCEPT", "NOT_EXECUTED", "NONE",
     "fixtures/typed-actor-string-v1/01-router-string-positive.atto",
     "ba0c2fce9eb7e5a980d22c8ff22a0689b7b8b352"],
    ["ACTOR-STRING-02", "REJECT", "NOT_EXECUTED", "E_TYPE",
     "fixtures/typed-actor-string-v1/02-wrong-incoming-payload.atto",
     "c3bf9c6013db45bfd04a553bedc48dea4f1268c9"],
    ["ACTOR-STRING-03", "REJECT", "NOT_EXECUTED", "E_ACTOR_RECEIVES",
     "fixtures/typed-actor-string-v1/03-wrong-mail-handler.atto",
     "53ec128b2f6369e3885ca1485f1dbccd8e20080f"],
    ["ACTOR-STRING-04", "REJECT", "NOT_EXECUTED", "E_ACTOR_SEND_CONTRACT",
     "fixtures/typed-actor-string-v1/04-outbound-effect-violation.atto",
     "becbb1a9630f0865e4a7eaeac90d683aa2e2512b"],
    ["ACTOR-STRING-05", "REJECT", "NOT_EXECUTED", "E_ACTOR_CONTRACT",
     "fixtures/typed-actor-string-v1/05-duplicate-sends.atto",
     "c9c9fb943c29e3259607fb747a477caa64c59f3d"],
];

fn check_row(row: &str, expected: &[&str; 6]) -> Result<(), String> {
    let fields: Vec<_> = row.split('\t').collect();
    if fields.as_slice() != expected {
        return Err(format!("incorrect source-only contract row: {}", expected[0]));
    }
    Ok(())
}

fn verify(root: &Path) -> Result<usize, String> {
    let catalog = fs::read_to_string(root.join("contracts/typed-actor-string-v1.tsv"))
        .map_err(|e| format!("catalog unavailable: {e}"))?;
    let rows: Vec<_> = catalog.lines()
        .filter(|row| !row.is_empty() && !row.starts_with('#')).collect();
    if rows.len() != EXPECTED.len() {
        return Err("missing, extra or duplicate string contract rows".into());
    }
    for (row, expected) in rows.into_iter().zip(EXPECTED.iter()) {
        check_row(row, expected)?;
        let relative = expected[4];
        let path = root.join(relative);
        let meta = fs::symlink_metadata(&path)
            .map_err(|e| format!("fixture {relative} missing: {e}"))?;
        if !meta.file_type().is_file() {
            return Err(format!("unsafe non-file fixture: {relative}"));
        }
        let source = fs::read_to_string(&path)
            .map_err(|e| format!("invalid source UTF-8 {relative}: {e}"))?;
        if source.len() > 65536 || !source.contains(expected[0])
            || !source.contains("NOT_EXECUTED")
            || !source.contains("define actor ")
            || !source.contains("receives ")
            || !source.contains("sends ") {
            return Err(format!("malformed target fixture: {relative}"));
        }
        let output = Command::new("git").current_dir(root)
            .args(["hash-object", "--", relative])
            .output().map_err(|e| format!("git hashing unavailable: {e}"))?;
        if !output.status.success() {
            return Err(format!("git hash-object failed for {relative}"));
        }
        let digest = std::str::from_utf8(&output.stdout)
            .map_err(|e| e.to_string())?.trim();
        if digest != expected[5] {
            return Err(format!("fixture blob identity mismatch: {relative}"));
        }
    }
    Ok(EXPECTED.len())
}

fn main() {
    match verify(Path::new(".")) {
        Ok(n) => println!("{n} actor string TARGET fixtures pinned; GUEST_NOT_EXECUTED"),
        Err(e) => { eprintln!("ACTOR_STRING_FIXTURE_DENIED: {e}"); std::process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_five_unexecuted_guest_targets() {
        assert_eq!(verify(Path::new(".")), Ok(5));
    }

    #[test]
    fn forged_evidence_is_rejected() {
        let valid = EXPECTED[0].join("\t");
        assert!(check_row(&valid, &EXPECTED[0]).is_ok());
        let fraudulent = valid.replace("NOT_EXECUTED", "PASSED");
        assert!(check_row(&fraudulent, &EXPECTED[0]).is_err());
    }

    #[test]
    fn mutated_file_identity_is_rejected() {
        for fields in EXPECTED {
            let mut bytes = fs::read(fields[4]).unwrap();
            bytes.push(0);
            let mut child = Command::new("git")
                .args(["hash-object", "--stdin"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn().unwrap();
            use std::io::Write;
            child.stdin.take().unwrap().write_all(&bytes).unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(output.status.success());
            assert_ne!(std::str::from_utf8(&output.stdout).unwrap().trim(), fields[5]);
        }
    }
}
