//! Exact-source, fail-closed execution gate for a *single* admitted BCV1 case.
//! This is optional tooling: no compiler guest runs merely by checking it in.
//! No shell interpolation, no Python, no implicit upgrading of TARGET_ONLY.
use std::{env, fs, path::{Path, PathBuf}, process::Command, time::{SystemTime, UNIX_EPOCH}};

const MANIFEST: &str = include_str!("../contracts/borrow-checker-v1.tsv");

#[derive(Debug)]
struct Case<'a> {
    id: &'a str, verdict: &'a str, oracle: &'a str,
    fixture: &'a str, admission: &'a str, status: &'a str,
}
fn find_case(id: &str) -> Result<Case<'static>, String> {
    let mut found = None;
    for line in MANIFEST.lines().skip(1).filter(|line| !line.trim().is_empty()) {
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() != 8 { return Err(format!("malformed contract TSV: {line}")); }
        if f[0] == id {
            if found.is_some() { return Err(format!("duplicate ID {id}")); }
            found = Some(Case { id: f[0], verdict: f[2], oracle: f[3],
                fixture: f[4], admission: f[7], status: f[6] });
        }
    }
    found.ok_or_else(|| format!("unknown case {id}"))
}
fn sha_is_valid(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|c| c.is_ascii_hexdigit())
}
fn git_rev(repo: &Path, revision: &str) -> Result<String, String> {
    let output = Command::new("git").arg("-C").arg(repo).arg("rev-parse")
        .arg(revision).output().map_err(|e| format!("git rev-parse: {e}"))?;
    if !output.status.success() { return Err(format!("git rev-parse {revision} failed")); }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
fn git_blob(path: &Path) -> Result<String, String> {
    let output = Command::new("git").arg("hash-object").arg(path).output()
        .map_err(|e| format!("git hash-object: {e}"))?;
    if !output.status.success() { return Err(format!("git hash-object failed for {}", path.display())); }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
fn actual_sha256(path: &Path) -> Result<String, String> {
    let output = Command::new("sha256sum").arg(path).output()
        .map_err(|e| format!("sha256sum (Linux): {e}"))?;
    if !output.status.success() { return Err("sha256sum failed".to_owned()); }
    Ok(String::from_utf8_lossy(&output.stdout).split_whitespace()
        .next().unwrap_or_default().to_owned())
}
struct Args {
    case_id: String, compiler: PathBuf, compiler_repo: PathBuf,
    compiler_head: String, compiler_tree: String, compiler_digest: String,
    fixture_blob: String, manifest_blob: String,
    guest_runner: Option<PathBuf>, guest_args: Vec<String>,
    compiler_args: Vec<String>, allow_draft: bool,
}
fn parse_args() -> Result<Args, String> {
    let mut args = env::args().skip(1);
    let (mut id, mut compiler, mut repo, mut head, mut tree, mut digest,
        mut fixture_blob, mut manifest_blob, mut runner) =
        (None, None, None, None, None, None, None, None, None);
    let mut runner_args = Vec::new();
    let mut compiler_args = Vec::new();
    let mut draft = false;
    while let Some(flag) = args.next() {
        let value = if flag == "--allow-draft-profile" { None }
            else { Some(args.next().ok_or_else(|| format!("{flag} needs a value"))?) };
        match flag.as_str() {
            "--case" => id = value,
            "--compiler" => compiler = value.map(PathBuf::from),
            "--compiler-repo" => repo = value.map(PathBuf::from),
            "--compiler-head" => head = value,
            "--compiler-tree" => tree = value,
            "--compiler-sha256" => digest = value,
            "--fixture-blob-sha" => fixture_blob = value,
            "--manifest-blob-sha" => manifest_blob = value,
            "--guest-runner" => runner = value.map(PathBuf::from),
            "--guest-arg" => runner_args.push(value.unwrap_or_default()),
            "--compiler-arg" => compiler_args.push(value.unwrap_or_default()),
            "--allow-draft-profile" => draft = true,
            _ => return Err(format!("unknown flag {flag}")),
        }
    }
    Ok(Args {
        case_id: id.ok_or("missing --case")?,
        compiler: compiler.map(|p| fs::canonicalize(&p).unwrap_or(p))
            .ok_or("missing --compiler")?,
        compiler_repo: repo.ok_or("missing --compiler-repo")?,
        compiler_head: head.ok_or("missing --compiler-head")?,
        compiler_tree: tree.ok_or("missing --compiler-tree")?,
        compiler_digest: digest.ok_or("missing --compiler-sha256")?,
        fixture_blob: fixture_blob.ok_or("missing --fixture-blob-sha")?,
        manifest_blob: manifest_blob.ok_or("missing --manifest-blob-sha")?,
        guest_runner: runner, guest_args: runner_args, compiler_args,
        allow_draft: draft,
    })
}
fn run() -> Result<(), String> {
    let opt = parse_args()?;
    let case = find_case(&opt.case_id)?;
    if case.status != "NOT_EXECUTED" {
        return Err(format!("contract status was modified without a verified evidence receipt: {}", case.status));
    }
    if case.admission == "TARGET_ONLY" {
        return Err(format!("UNSUPPORTED: {} is target-only; no safe compiler admission claimed", case.id));
    }
    if case.admission == "PROFILE_CANDIDATE_DRAFT" && !opt.allow_draft {
        return Err("UNSUPPORTED: draft compiler profile requires --allow-draft-profile".to_owned());
    }
    if !matches!(case.admission, "PROFILE_CANDIDATE_DRAFT" | "COMPILER_CANDIDATE_MERGED") {
        return Err(format!("unknown admission mode {}", case.admission));
    }
    if !sha_is_valid(&opt.compiler_head, 40) || !sha_is_valid(&opt.compiler_tree, 40)
        || !sha_is_valid(&opt.compiler_digest, 64)
        || !sha_is_valid(&opt.fixture_blob, 40) || !sha_is_valid(&opt.manifest_blob, 40) {
        return Err("require exact 40-hex source/head/tree and Git blobs plus 64-hex compiler SHA-256".to_owned());
    }
    let actual_head = git_rev(&opt.compiler_repo, "HEAD")?;
    let actual_tree = git_rev(&opt.compiler_repo, "HEAD^{tree}")?;
    if actual_head != opt.compiler_head || actual_tree != opt.compiler_tree {
        return Err(format!("compiler source HEAD/TREE mismatch: {actual_head} {actual_tree}"));
    }
    let actual_binary = actual_sha256(&opt.compiler)?;
    if actual_binary != opt.compiler_digest {
        return Err(format!("compiler binary SHA-256 mismatch: {actual_binary}"));
    }
    let root = Path::new(file!()).parent().and_then(Path::parent)
        .ok_or_else(|| "cannot locate fixture repo root".to_owned())?;
    if !case.fixture.starts_with("fixtures/borrow-checker-v1/")
        || case.fixture.contains("..") { return Err("unsafe fixture path".to_owned()); }
    let fixture = fs::canonicalize(root.join(case.fixture))
        .map_err(|e| format!("fixture missing {}: {e}", case.fixture))?;
    let manifest = root.join("contracts/borrow-checker-v1.tsv");
    let on_disk_manifest = fs::read_to_string(&manifest).map_err(|e| e.to_string())?;
    if on_disk_manifest != MANIFEST {
        return Err("manifest changed since the Rust runner was compiled".to_owned());
    }
    if git_blob(&manifest)? != opt.manifest_blob || git_blob(&fixture)? != opt.fixture_blob {
        return Err("unverified Git blob: manifest/fixture does not match exact-source receipt".to_owned());
    }
    let content = fs::read_to_string(&fixture).map_err(|e| e.to_string())?;
    if case.admission == "PROFILE_CANDIDATE_DRAFT"
        && content.lines().next() != Some("// atto-ownership: borrow-default-v1") {
        return Err("experimental ownership header must be the physical first line".to_owned());
    }
    let epoch = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_nanos();
    let temp = env::temp_dir().join(format!("atto-bcv1-{}-{}-{}", case.id, std::process::id(), epoch));
    fs::create_dir(&temp).map_err(|e| format!("cannot create isolated output directory: {e}"))?;
    let artifact = temp.join("guest.wasm");
    let compiled = Command::new(&opt.compiler).arg(&fixture)
        .args(&opt.compiler_args).arg("-o").arg(&artifact).output()
        .map_err(|e| format!("compiler did not run: {e}"))?;
    let diagnostics = format!("{}\n{}", String::from_utf8_lossy(&compiled.stdout),
        String::from_utf8_lossy(&compiled.stderr));
    let emitted = fs::metadata(&artifact).map(|m| m.len() > 0).unwrap_or(false);
    println!("CASE={} SOURCE_HEAD={} SOURCE_TREE={} COMPILER_SHA256={}",
        case.id, actual_head, actual_tree, actual_binary);
    println!("FIXTURE={} FIXTURE_BLOB={} MANIFEST_BLOB={} OUTPUT_DIR={}",
        fixture.display(), opt.fixture_blob, opt.manifest_blob, temp.display());
    println!("COMPILE_EXIT={:?} COMPILE_STDOUT_STDERR:\n{}", compiled.status.code(), diagnostics);
    match case.verdict {
        "REJECT" => {
            if compiled.status.success() || emitted || !diagnostics.contains(case.oracle)
                || diagnostics.contains("E_SYNTAX") {
                return Err(format!("FAILED: expected {} with no guest artifact and no syntax surrogate", case.oracle));
            }
            println!("PASS_COMPILER_REJECTION={} NO_ARTIFACT=true", case.oracle);
            Ok(())
        }
        "PASS" => {
            if !compiled.status.success() || !emitted {
                return Err("FAILED: positive source did not produce nonempty executable".to_owned());
            }
            let runner = opt.guest_runner.ok_or(
                "NOT_EXECUTED: a guest runtime must be explicitly provided via --guest-runner")?;
            let guest = Command::new(&runner).args(&opt.guest_args).arg(&artifact).output()
                .map_err(|e| format!("NOT_EXECUTED: guest runner failed to start: {e}"))?;
            println!("GUEST_EXIT={:?} GUEST_STDOUT:\n{} GUEST_STDERR:\n{}",
                guest.status.code(), String::from_utf8_lossy(&guest.stdout),
                String::from_utf8_lossy(&guest.stderr));
            if guest.status.code() != Some(42) {
                return Err("FAILED: positive guest did not exit 42".to_owned());
            }
            println!("PASS_COMPILED_GUEST=true");
            Ok(())
        }
        _ => Err(format!("invalid expected verdict {}", case.verdict)),
    }
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(if e.starts_with("UNSUPPORTED:") || e.starts_with("NOT_EXECUTED:") { 2 } else { 1 });
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn matrix_driven_candidate_admission() {
        assert_eq!(find_case("BCV1-003").unwrap().admission, "PROFILE_CANDIDATE_DRAFT");
        assert_eq!(find_case("BCV1-015").unwrap().admission, "COMPILER_CANDIDATE_MERGED");
        assert_eq!(find_case("BCV1-025").unwrap().admission, "TARGET_ONLY");
        assert!(find_case("BCV1-999").is_err());
    }
    #[test] fn full_sha_provenance_required() {
        assert!(sha_is_valid(&"a".repeat(40), 40));
        assert!(!sha_is_valid("short", 40));
        assert!(!sha_is_valid(&"x".repeat(64), 64));
    }
    #[test] fn no_unknown_candidate_silently_passes() {
        for line in MANIFEST.lines().skip(1) {
            let f: Vec<&str> = line.split('\t').collect();
            assert!(matches!(f[7], "TARGET_ONLY" | "PROFILE_CANDIDATE_DRAFT" |
                "COMPILER_CANDIDATE_MERGED"));
            assert_eq!(f[6], "NOT_EXECUTED");
        }
    }
}
