//! Real compiled guest admission gate. Build with:
//! rustc --edition=2021 -D warnings tools/actor_aot_guest_gate.rs -o actor_aot_guest_gate
//! This is a runner protocol; each backend must implement a reviewed adapter.
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

fn required_hex_env(name: &str, len: usize) -> Result<String, String> {
    let v = env::var(name).map_err(|_| format!("missing {name}"))?;
    if v.len() != len || !v.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("invalid {name}: need {len} hex digits"));
    }
    Ok(v)
}
fn exec(adapter: &Path, subcommand: &str, file: &Path, artifact: Option<&Path>) -> Result<Output, String> {
    let mut cmd = Command::new(adapter);
    cmd.arg(subcommand).arg(file);
    if let Some(artifact) = artifact { cmd.arg(artifact); }
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("could not execute adapter: {e}"))?;
    let start = Instant::now();
    loop {
        if let Some(_) = child.try_wait().map_err(|e| e.to_string())? { break; }
        if start.elapsed() > Duration::from_secs(30) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("adapter {subcommand} timed out"));
        }
        thread::sleep(Duration::from_millis(20));
    }
    child.wait_with_output().map_err(|e| e.to_string())
}
fn is_aot_artifact(path: &Path) -> Result<(), String> {
    let data = fs::read(path).map_err(|e| format!("no compiled artifact: {e}"))?;
    if data.len() < 64 { return Err("artifact too small to be AOT binary".into()); }
    let elf = data.starts_with(b"\x7fELF");
    let wasm = data.starts_with(b"\x00asm");
    let pe = data.starts_with(b"MZ");
    let macho = [b"\xfe\xed\xfa\xce", b"\xce\xfa\xed\xfe",
                 b"\xfe\xed\xfa\xcf", b"\xcf\xfa\xed\xfe"]
        .iter().any(|sig| data.starts_with(*sig));
    if !(elf || wasm || pe || macho) {
        return Err("not ELF/PE/Mach-O/Wasm: refusing IR/source/mock artifact".into());
    }
    Ok(())
}
fn check_case(adapter: &Path, fixtures: &Path, scratch: &Path) -> Result<(), String> {
    let positive = fixtures.join("two_actors.atto");
    let negative = fixtures.join("recursive_actor_call.atto");
    let output = scratch.join("actor_positive.aot");
    let rejected_output = scratch.join("actor_negative.aot");
    fs::create_dir_all(scratch).map_err(|e| e.to_string())?;
    // A stale binary must never make a failed compile look like a success.
    for p in [&output, &rejected_output] { let _ = fs::remove_file(p); }
    let compile = exec(adapter, "compile", &positive, Some(&output))?;
    if !compile.status.success() {
        return Err(format!("positive compiled source failed: {}",
            String::from_utf8_lossy(&compile.stderr)));
    }
    is_aot_artifact(&output)?;
    let run = exec(adapter, "run", &output, None)?;
    if !run.status.success() {
        return Err(format!("guest failed with {}: {}", run.status,
            String::from_utf8_lossy(&run.stderr)));
    }
    let stdout = std::str::from_utf8(&run.stdout).map_err(|e| e.to_string())?;
    let mut lines: Vec<_> = stdout.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines.sort_unstable();
    if lines != ["1", "42"] { return Err(format!("wrong guest stdout lines: {lines:?}")); }
    let neg = exec(adapter, "compile", &negative, Some(&rejected_output))?;
    if neg.status.success() { return Err("recursive actor source unexpectedly compiled".into()); }
    if rejected_output.exists() { return Err("rejected source emitted an artifact".into()); }
    let diagnostics = String::from_utf8_lossy(&neg.stderr);
    if !diagnostics.contains("E_ACTOR_STACK_RECURSION") {
        return Err(format!("missing required failure diagnostic: {diagnostics}"));
    }
    Ok(())
}
fn main() {
    let result: Result<(), String> = (|| {
        let args: Vec<_> = env::args_os().collect();
        if args.len() != 4 {
            return Err("usage: actor_aot_guest_gate <absolute-adapter> <fixture-dir> <scratch-dir>".into());
        }
        let adapter = PathBuf::from(args[1].clone());
        if !adapter.is_absolute() || !adapter.is_file() {
            return Err("adapter must be an existing absolute executable file".into());
        }
        let fixtures = fs::canonicalize(PathBuf::from(args[2].clone()))
            .map_err(|e| e.to_string())?;
        let scratch = PathBuf::from(args[3].clone());
        if !scratch.is_absolute() { return Err("scratch directory must be absolute".into()); }
        let backend = env::var("ATTO_AOT_BACKEND").map_err(|_| "missing ATTO_AOT_BACKEND")?;
        if !["llvm", "rust-wasm", "java-graal-native-image", "dotnet-nativeaot", "forge"]
            .contains(&backend.as_str()) { return Err("invalid backend name".into()); }
        let head = required_hex_env("ATTO_AOT_HEAD_SHA", 40)?;
        let compiler = required_hex_env("ATTO_AOT_COMPILER_SHA256", 64)?;
        check_case(&adapter, &fixtures, &scratch)?;
        println!("AOT_GUEST_GATE_PASS backend={backend} head={head} compiler_sha256={compiler} cases=2");
        Ok(())
    })();
    if let Err(message) = result {
        eprintln!("AOT_GUEST_GATE_NOT_VERIFIED: {message}");
        std::process::exit(1);
    }
}