//! Source-linked proof *replay*, not provenance attestation or compiler verification.
//! Requires real Git checkout, sha256sum, timeout and an explicitly pinned Z3 executable.
//! No Python, network, tokens, dynamic dependencies or OresVM runtime dependencies.
use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

const MAX_QUERY: u64 = 262_144;
const MAX_OUTPUT: usize = 4096;
const MAX_SPECS: usize = 128;

#[derive(Debug, PartialEq, Eq)]
enum Expect { Unsat, Sat }
#[derive(Debug)]
struct Spec { id: String, relative: String, sha256: String, expect: Expect }

fn require(ok: bool, why: &str) -> Result<(), String> {
    if ok { Ok(()) } else { Err(why.to_owned()) }
}
fn hex(s: &str, n: usize) -> bool { s.len()==n && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) }
fn path_component_check(s: &str) -> Result<(), String> {
    require(!s.is_empty() && s.len() <= 300 && !s.contains('\0'), "empty/oversized path")?;
    let path=Path::new(s);
    require(!path.is_absolute() && !s.contains('\\') && s.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
        && path.components().all(|c| matches!(c, Component::Normal(_))),
            "absolute/traversal/non-normal relative path")
}
fn parse_spec(s: &str, expect: Expect) -> Result<Spec,String> {
    let fields: Vec<&str> = s.split(':').collect();
    require(fields.len()==3, "spec must be id:relative-query-path:sha256")?;
    require(fields[0].len()>=2 && fields[0].len()<=80 &&
        fields[0].bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c==b'-') &&
        fields[0].bytes().next().unwrap().is_ascii_lowercase(), "invalid unique obligation id")?;
    path_component_check(fields[1])?;
    require(hex(fields[2],64), "noncanonical expected query digest")?;
    Ok(Spec{id:fields[0].to_owned(),relative:fields[1].to_owned(),
       sha256:fields[2].to_owned(),expect})
}
fn capture(command: &mut Command, label: &str) -> Result<String,String> {
    let result=command.output().map_err(|e| format!("{label}: could not execute: {e}"))?;
    require(result.status.success(), &format!("{label}: executable failed (status {})",result.status))?;
    require(result.stdout.len()<=MAX_OUTPUT, &format!("{label}: excess output"))?;
    String::from_utf8(result.stdout).map_err(|_| format!("{label}: non-UTF8 stdout"))
}
fn exact_path(root: &Path, relative: &str) -> Result<PathBuf,String> {
    path_component_check(relative)?;
    let path=root.join(relative);
    let mut traversed=root.to_path_buf();
    for component in Path::new(relative).components() {
        traversed.push(component.as_os_str());
        let part=fs::symlink_metadata(&traversed).map_err(|e|format!("path component missing: {e}"))?;
        require(!part.file_type().is_symlink(), "symlinked path component rejected")?;
    }
    let meta=fs::symlink_metadata(&path).map_err(|e|format!("input missing: {e}"))?;
    require(meta.file_type().is_file() && !meta.file_type().is_symlink(), "input not a regular non-symlink file")?;
    let canonical=fs::canonicalize(&path).map_err(|e|format!("canonicalization failed: {e}"))?;
    require(canonical.starts_with(root), "input escapes reference root")?;
    Ok(canonical)
}
fn sha256(path: &Path) -> Result<String,String> {
    let out=capture(Command::new("sha256sum").arg("--").arg(path),"sha256sum")?;
    let first=out.split_ascii_whitespace().next().ok_or("missing sha256 digest")?;
    require(hex(first,64), "malformed sha256sum output")?;
    Ok(first.to_owned())
}
fn verdict(stdout: &str, expected: &Expect) -> Result<(),String> {
    let s=stdout.strip_suffix('\n').unwrap_or(stdout);
    let ok = match expected { Expect::Unsat=>s=="unsat",Expect::Sat=>s=="sat" };
    require(ok, "solver returned unknown, partial, extra, or wrong proof/negative-control result")
}
fn run() -> Result<(),String> {
    let mut named=BTreeMap::<String,String>::new();
    let mut specs=Vec::<Spec>::new();
    let mut a=env::args().skip(1);
    while let Some(flag)=a.next() {
        let value=a.next().ok_or(format!("missing value for {flag}"))?;
        match flag.as_str() {
            "--proof"=>specs.push(parse_spec(&value,Expect::Unsat)?),
            "--mutant"=>specs.push(parse_spec(&value,Expect::Sat)?),
            "--repository"|"--commit"|"--source"|"--source-blob"|
            "--query-root"|"--solver"|"--solver-sha256" => {
                require(named.insert(flag,value).is_none(),"duplicate command-line option")?;
            }
            _=>return Err(format!("unknown option {flag}"))
        }
    }
    const REQUIRED:[&str;7]=["--repository","--commit","--source","--source-blob","--query-root","--solver","--solver-sha256"];
    require(named.len()==REQUIRED.len(),"missing required option")?;
    let get=|key:&str| named.get(key).map(String::as_str).ok_or(format!("missing {key}"));
    let commit=get("--commit")?;
    let blob=get("--source-blob")?;
    require(hex(commit,40)&&hex(blob,40),"noncanonical Git commit or blob id")?;
    let solver_sha=get("--solver-sha256")?;
    require(hex(solver_sha,64),"noncanonical solver SHA256")?;
    require(specs.len()>=2&&specs.len()<=MAX_SPECS,"bounded proof and mutant obligations required")?;
    require(specs.iter().any(|s|s.expect==Expect::Unsat)&&specs.iter().any(|s|s.expect==Expect::Sat),
        "require at least one UNSAT proof and one SAT negative mutant")?;
    let mut identities=HashSet::new();
    for s in &specs { require(identities.insert(s.id.clone()),"duplicate obligation identity")?; }

    let repo=fs::canonicalize(get("--repository")?).map_err(|e|format!("repo path: {e}"))?;
    require(repo.is_dir(),"repository must be directory")?;
    let root=fs::canonicalize(get("--query-root")?).map_err(|e|format!("query root: {e}"))?;
    require(root.is_dir(),"query root must be directory")?;
    let source_rel=get("--source")?;
    let source=exact_path(&repo,source_rel)?;
    let head=capture(Command::new("git").arg("-C").arg(&repo).args(["rev-parse","HEAD"]),"git rev-parse")?;
    require(head.trim_end()==commit,"Git checkout not at exact pinned head")?;
    let actual_blob=capture(Command::new("git").arg("-C").arg(&repo)
        .arg("hash-object").arg("--").arg(&source),"git hash-object")?;
    require(actual_blob.trim_end()==blob,"source Git blob differs from pinned bytes")?;
    let solver=fs::canonicalize(get("--solver")?).map_err(|e|format!("solver path: {e}"))?;
    require(solver.is_file(),"solver must be a regular executable")?;
    require(sha256(&solver)?==solver_sha,"solver executable SHA256 mismatch")?;

    for s in &specs {
        let file=exact_path(&root,&s.relative)?;
        require(fs::metadata(&file).map_err(|e|e.to_string())?.len()<=MAX_QUERY,"SMT query exceeds size budget")?;
        require(sha256(&file)?==s.sha256, "proof or mutant query SHA256 mismatch")?;
        // timeout is an external, real watchdog; Z3's own -T:10 is a second limit.
        let output=capture(Command::new("timeout").args(["-k","1s","15s"])
            .arg(&solver).args(["-T:10","-smt2"]).arg(&file),"actual Z3 SMT replay")?;
        verdict(&output,&s.expect)?;
        println!("REPLAY|{}|{}|{}",s.id,if s.expect==Expect::Unsat{"unsat"}else{"sat"},s.sha256);
    }
    println!("LOCAL_PROOF_REPLAY_PASSED_UNATTESTED|obligations={}|commit={}|source_blob={}|solver_sha256={}",
         specs.len(),commit,blob,solver_sha);
    eprintln!("NOT a proof of source-to-SMT translation, runtime backend refinement, or authenticated CI provenance.");
    Ok(())
}
fn main() {
    if let Err(why)=run() { eprintln!("PROOF_REPLAY_REJECTED: {why}");std::process::exit(2); }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn paths_reject_traversal_and_absolute() {
        for s in ["../bad","x/../y","./bad","/tmp/file","x//y",""] { assert!(path_component_check(s).is_err(),"{s}"); }
        assert!(path_component_check("proofs/min.smt2").is_ok());
    }
    #[test] fn proof_mutants_are_distinct_and_sha_restricted() {
        let x=format!("min-law:positive.smt2:{}", "a".repeat(64));
        assert_eq!(parse_spec(&x,Expect::Unsat).unwrap().expect,Expect::Unsat);
        for s in ["bad:x:zz",":x:aaaaaaaa","xx:../m:abcdef","xx:/tmp/file:bad"] {
            assert!(parse_spec(s,Expect::Sat).is_err(),"{s}");
        }
    }
    #[test] fn solver_output_is_exact_and_fail_closed() {
        assert!(verdict("unsat\n",&Expect::Unsat).is_ok());
        assert!(verdict("sat\n",&Expect::Sat).is_ok());
        for v in ["unknown\n","sat\nunsat\n","unsat\nsat\n","","(error \"failed\")\n"] {
            assert!(verdict(v,&Expect::Unsat).is_err(),"{v}");
        }
    }
    #[test] fn sha_ids_require_lowercase_exact_length() {
        assert!(hex(&"a".repeat(40),40)); assert!(hex(&"1".repeat(64),64));
        assert!(!hex(&"A".repeat(40),40)); assert!(!hex("0xabcd",40));
    }
}
