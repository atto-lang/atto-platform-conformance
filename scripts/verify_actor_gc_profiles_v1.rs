//! Immutable six-toolchain actor GC release policy. This tests POLICY ONLY.
 //! No interpreter/compiler guest is run by this validator.
use std::{fs, io::Read, str};

const MAX_POLICY_BYTES: usize = 65_536;


/// Immutable reviewed policy, independent of the external file under test.
/// A policy edit requires reviewing the same change in this source guard.
const APPROVED: &str = r###"{
  "schemaVersion": 1,
  "scope": "actor-owned-memory-gc-admission-v1",
  "evidenceLevel": "source-only-policy",
  "verifiedGeneralGuestZeroGcBackends": [],
  "verifiedHardRealtimeBackends": [],
  "profiles": {
    "strictGuestNoTracingTargets": [
      "llvm",
      "wasm"
    ],
    "nearZeroManagedHostTargets": [
      "java",
      "net"
    ],
    "additionalNativeTargets": [
      "cranelift",
      "forge"
    ],
    "hardRealtimeTarget": "llvm"
  },
  "backends": {
    "java": {
      "host": "jvm-graal",
      "hostTracingGcPossible": true,
      "actorHeapStage": "host-arena-substrate",
      "sourceActorHeapLoweringCertified": false,
      "guestZeroTracingCertified": false,
      "fullProcessZeroGcCertified": false
    },
    "llvm": {
      "host": "native-cpp",
      "hostTracingGcPossible": false,
      "actorHeapStage": "native-arena-substrate",
      "sourceActorHeapLoweringCertified": false,
      "guestZeroTracingCertified": false,
      "fullProcessZeroGcCertified": false
    },
    "wasm": {
      "host": "node-webassembly",
      "hostTracingGcPossible": true,
      "actorHeapStage": "host-linear-memory-substrate",
      "sourceActorHeapLoweringCertified": false,
      "guestZeroTracingCertified": false,
      "fullProcessZeroGcCertified": false
    },
    "cranelift": {
      "host": "rust-native-jit",
      "hostTracingGcPossible": false,
      "actorHeapStage": "unsupported-scalar-only",
      "sourceActorHeapLoweringCertified": false,
      "guestZeroTracingCertified": false,
      "fullProcessZeroGcCertified": false
    },
    "net": {
      "host": "clr-nativeaot",
      "hostTracingGcPossible": true,
      "actorHeapStage": "unmanaged-arena-substrate",
      "sourceActorHeapLoweringCertified": false,
      "guestZeroTracingCertified": false,
      "fullProcessZeroGcCertified": false
    },
    "forge": {
      "host": "cpp-native",
      "hostTracingGcPossible": false,
      "actorHeapStage": "native-arena-substrate",
      "sourceActorHeapLoweringCertified": false,
      "guestZeroTracingCertified": false,
      "fullProcessZeroGcCertified": false
    }
  },
  "requiredProofs": [
    "compiled-source-allocation-site-closure",
    "native-layout-and-drop-glue-for-every-noncopy-value",
    "drop-on-return-throw-raise-panic-cancellation-and-hot-reload",
    "checked-partial-init-and-move-drop-flags",
    "no-implicit-strong-cross-actor-cycles",
    "closed-ffi-import-and-callback-allocation-set",
    "actor-turn-borrow-async-and-ffi-quiescence",
    "generation-fenced-actor-and-incarnation-handles",
    "persistent-survives-turn-scratch-does-not",
    "scrub-and-physical-reclaim-after-last-external-lease",
    "bounded-quotas-no-unaccounted-overflow-or-double-refund",
    "backend-generated-ir-binary-and-runtime-allocation-evidence",
    "exact-source-head-target-artifact-hash-and-stepful-runner-provenance"
  ],
  "requiredConformanceCases": [
    "persistent-two-actor-turn-isolation",
    "scratch-after-yield-rejected",
    "take-move-then-read-rejected",
    "borrow-across-suspend-admission",
    "cross-actor-pointer-smuggling-rejected",
    "foreign-handle-and-restart-generation-rejected",
    "actor-stop-while-async-ffi-io-pin-outstanding",
    "late-callback-cannot-reopen-retired-actor",
    "double-release-and-partial-constructor-failure",
    "nested-drop-return-break-continue-early-exit",
    "throw-raise-panic-supervision-drop-paths",
    "hot-reload-and-supervisor-restart-quiescence",
    "arena-cyclic-graph-nonowning-handles",
    "shared-immutable-graph-no-unbounded-rc-cycle",
    "allocator-quota-failure-no-counter-mutation",
    "wasm-gc-reference-types-and-host-imports-rejected-in-strict-profile",
    "llvm-statepoint-and-unexpected-gc-runtime-call-rejected",
    "host-collector-versus-guest-collector-claims-distinguished"
  ],
  "releaseRule": "A declaration-only fixture cannot prove compiler lowering, runtime behavior, zero guest tracing GC, zero process GC, or hard-real-time latency."
}
"###;
const REQUIRED_PROOFS: &[&str] = &["compiled-source-allocation-site-closure","native-layout-and-drop-glue-for-every-noncopy-value","drop-on-return-throw-raise-panic-cancellation-and-hot-reload","checked-partial-init-and-move-drop-flags","no-implicit-strong-cross-actor-cycles","closed-ffi-import-and-callback-allocation-set","actor-turn-borrow-async-and-ffi-quiescence","generation-fenced-actor-and-incarnation-handles","persistent-survives-turn-scratch-does-not","scrub-and-physical-reclaim-after-last-external-lease","bounded-quotas-no-unaccounted-overflow-or-double-refund","backend-generated-ir-binary-and-runtime-allocation-evidence","exact-source-head-target-artifact-hash-and-stepful-runner-provenance"];
const REQUIRED_CASES: &[&str] = &["persistent-two-actor-turn-isolation","scratch-after-yield-rejected","take-move-then-read-rejected","borrow-across-suspend-admission","cross-actor-pointer-smuggling-rejected","foreign-handle-and-restart-generation-rejected","actor-stop-while-async-ffi-io-pin-outstanding","late-callback-cannot-reopen-retired-actor","double-release-and-partial-constructor-failure","nested-drop-return-break-continue-early-exit","throw-raise-panic-supervision-drop-paths","hot-reload-and-supervisor-restart-quiescence","arena-cyclic-graph-nonowning-handles","shared-immutable-graph-no-unbounded-rc-cycle","allocator-quota-failure-no-counter-mutation","wasm-gc-reference-types-and-host-imports-rejected-in-strict-profile","llvm-statepoint-and-unexpected-gc-runtime-call-rejected","host-collector-versus-guest-collector-claims-distinguished"];

// Bound reads *before* allocating a full untrusted policy file. The scanner
// remains an independent second limit and rejects any noncanonical content.
fn read_bounded<R: Read>(input: R) -> Result<Vec<u8>, String> {
    let mut limited = input.take((MAX_POLICY_BYTES + 1) as u64);
    let mut bytes = Vec::new();
    limited.read_to_end(&mut bytes).map_err(|e| format!("policy read failed: {e}"))?;
    if bytes.len() > MAX_POLICY_BYTES {
        return Err("noncanonical encoding or oversized policy".into());
    }
    Ok(bytes)
}

// This verifier reads only a fixed checked-out repository path. Deny parent
// traversal and symlinked ancestor directories, not merely the final symlink.
// This is a pre-open integrity gate, not an atomic directory-handle traversal.
fn check_policy_ancestors(path: &std::path::Path) -> Result<(), String> {
    if path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("policy parent traversal denied".into());
    }
    for parent in path.ancestors().skip(1) {
        if parent.as_os_str().is_empty() { continue; }
        let metadata = fs::symlink_metadata(parent)
            .map_err(|e| format!("policy ancestor stat failed: {e}"))?;
        if !metadata.file_type().is_dir() {
            return Err("policy ancestor must be a real directory".into());
        }
    }
    Ok(())
}

// Linux: openat2 resolves the entire path under a directory descriptor.
// O_NOFOLLOW alone guards only the final component, and a swapped parent
// symlink to the SAME inode bypasses the earlier dev/inode equality check.
// Do not silently downgrade to open() when openat2 is unavailable.
#[cfg(all(target_os = "linux", any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64")))]
fn open_policy_checked(path: &std::path::Path) -> Result<fs::File, String> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::raw::c_long;
    use std::os::unix::ffi::OsStrExt;
    #[repr(C)]
    struct OpenHow {
        flags: u64,
        mode: u64,
        resolve: u64,
    }
    unsafe extern "C" {
        fn syscall(number: c_long, ...) -> c_long;
    }
    // Linux syscall table (x86_64, aarch64, riscv64).
    const SYS_OPENAT2: c_long = 437;
    // Linux fcntl.h: O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC.
    const OPEN_FLAGS: u64 = 0o400000 | 0o4000 | 0o2000000;
    // linux/openat2.h: NO_MAGICLINKS | NO_SYMLINKS | BENEATH.
    const RESOLVE_FLAGS: u64 = 0x02 | 0x04 | 0x08;

    // Absolute paths are expressed relative to the opened root directory;
    // relative paths use a descriptor for the current working directory.
    let anchor = fs::File::open(if path.is_absolute() { "/" } else { "." })
        .map_err(|e| format!("policy anchor open failed: {e}"))?;
    let relative = if path.is_absolute() {
        path.strip_prefix("/")
            .map_err(|e| format!("policy absolute path failed: {e}"))?
    } else {
        path
    };
    let c_path = CString::new(relative.as_os_str().as_bytes())
        .map_err(|_| "policy path contains NUL".to_string())?;
    let how = OpenHow {
        flags: OPEN_FLAGS,
        mode: 0,
        resolve: RESOLVE_FLAGS,
    };
    // SAFETY: valid NUL-terminated path; valid OpenHow pointer and size.
    let fd = unsafe {
        syscall(
            SYS_OPENAT2,
            anchor.as_raw_fd(),
            c_path.as_ptr(),
            &how as *const OpenHow,
            std::mem::size_of::<OpenHow>(),
        )
    };
    if fd < 0 {
        return Err(format!(
            "policy openat2 denied or unavailable: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: successful openat2 returns a fresh, owned fd.
    Ok(unsafe { fs::File::from_raw_fd(fd as i32) })
}

// The kernel ABI above is intentionally limited to reviewed architectures.
#[cfg(all(target_os = "linux", not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "riscv64"))))]
fn open_policy_checked(_path: &std::path::Path) -> Result<fs::File, String> {
    Err("policy secure openat2 unsupported on this Linux architecture".into())
}

// Non-Linux fallback: bounded and FD-verified, but NOT race-free for ancestor
// replacement; do not claim Linux-strength pathname containment here.
#[cfg(not(target_os = "linux"))]
fn open_policy_checked(path: &std::path::Path) -> Result<fs::File, String> {
    fs::File::open(path).map_err(|e| format!("policy open failed: {e}"))
}

// Kept separate so tests can deterministically simulate changes *after*
// symlink_metadata, rather than depending on a flaky concurrent race.
fn read_policy_after_stat(path: &std::path::Path, before: &fs::Metadata) -> Result<Vec<u8>, String> {
    if !before.file_type().is_file() {
        return Err("policy must be a regular non-symlink file".into());
    }
    if before.len() > MAX_POLICY_BYTES as u64 {
        return Err("noncanonical encoding or oversized policy".into());
    }
    let file = open_policy_checked(path)?;
    let opened = file.metadata().map_err(|e| format!("policy fstat failed: {e}"))?;
    if !opened.is_file() {
        return Err("policy opened as non-regular file".into());
    }
    if opened.len() > MAX_POLICY_BYTES as u64 {
        return Err("noncanonical encoding or oversized policy".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != opened.dev() || before.ino() != opened.ino() {
            return Err("policy identity changed during open".into());
        }
    }
    read_bounded(file)
}

fn read_policy_file(path: &std::path::Path) -> Result<Vec<u8>, String> {
    check_policy_ancestors(path)?;
    let before = fs::symlink_metadata(path).map_err(|e| format!("policy stat failed: {e}"))?;
    read_policy_after_stat(path, &before)
}

#[derive(Debug, PartialEq, Eq)]
struct Token<'a> { kind: u8, raw: &'a str }
fn scan(bytes: &[u8]) -> Result<Vec<Token<'_>>, String> {
    if bytes.len() > MAX_POLICY_BYTES || bytes.starts_with(&[0xef, 0xbb, 0xbf])
        || bytes.contains(&b'\r') || bytes.contains(&0) {
        return Err("noncanonical encoding or oversized policy".into());
    }
    let text = str::from_utf8(bytes).map_err(|_| "policy must be UTF-8")?;
    let mut out = Vec::new(); let mut i = 0;
    while i < bytes.len() {
        if matches!(bytes[i], b' ' | b'\t' | b'\n') { i += 1; continue; }
        let start = i;
        if bytes[i] == b'"' {
            i += 1;
            loop {
                let byte = *bytes.get(i).ok_or("unterminated JSON string")?;
                if byte == b'"' { i += 1; break; }
                // This version deliberately denies escaped JSON spellings;
                // the reviewed immutable contract uses no escape sequences.
                if byte == b'\\' || byte < 0x20 {
                    return Err("unapproved JSON string escape/control byte".into());
                }
                i += 1;
            }
            out.push(Token { kind: b'"', raw: &text[start..i] });
        } else if b"{}[]:,".contains(&bytes[i]) {
            i += 1;
            out.push(Token { kind: bytes[start], raw: &text[start..i] });
        } else {
            while i < bytes.len() && !b"{}[]:, \t\n\"".contains(&bytes[i]) {
                if bytes[i] == b'\\' || bytes[i] < 0x20 {
                    return Err("illegal JSON control or escape".into());
                }
                i += 1;
            }
            if i == start { return Err("invalid JSON token".into()); }
            out.push(Token { kind: b'w', raw: &text[start..i] });
        }
        if out.len() > 4096 { return Err("policy token budget exceeded".into()); }
    }
    Ok(out)
}
fn validate(raw: &[u8]) -> Result<(), String> {
    let reviewed = scan(APPROVED.as_bytes())?;
    let submitted = scan(raw)?;
    if submitted != reviewed {
        return Err("policy schema, immutable inventory or certification claim changed".into());
    }
    Ok(())
}
fn main() {
    if std::env::args().len() != 1 {
        eprintln!("usage: verify_actor_gc_profiles_v1 (no arguments)");
        std::process::exit(1);
    }
    let result = read_policy_file(std::path::Path::new("contracts/actor_gc_profiles_v1.json"))
        .map_err(|e| e.to_string()).and_then(|raw| validate(&raw));
    if let Err(err) = result {
        eprintln!("actor GC profiles: {err}");
        std::process::exit(1);
    }
    println!(r#"{{"backend_count":6,"required_proof_count":{},"conformance_case_count":{},"executed_guest_tests":0,"zero_gc_certified":false}}"#, REQUIRED_PROOFS.len(), REQUIRED_CASES.len());
}
#[cfg(test)]
mod tests {
    use super::*;
    fn reject(raw: Vec<u8>) { assert!(validate(&raw).is_err()); }
    // The compiled test binary must also exercise the on-disk checked-in
    // contract. Otherwise an edited contract could pass `rustc --test` by
    // validating only the embedded baseline while the standalone binary fails.
    #[test] fn checked_in_policy_matches_reviewed_baseline() {
        let on_disk = include_bytes!("../contracts/actor_gc_profiles_v1.json");
        validate(on_disk).expect("checked-in JSON must match reviewed policy");
        assert_eq!(scan(on_disk).unwrap(), scan(APPROVED.as_bytes()).unwrap());
    }
    #[test] fn trailing_data_and_truncation_denied() {
        // Removing the final newline is NOT truncation: the scanner
        // intentionally normalizes whitespace. Remove the closing brace to
        // make the JSON token stream genuinely incomplete instead.
        let mut truncated = APPROVED.as_bytes().to_vec();
        let closing_brace = truncated.iter().rposition(|byte| *byte == b'}')
            .expect("approved policy must have a closing object");
        truncated.truncate(closing_brace);
        reject(truncated);
        let mut added = APPROVED.as_bytes().to_vec();
        added.extend_from_slice(b" true");
        reject(added);
        let too_large = vec![b' '; 65_537];
        reject(too_large);
    }
    #[test] fn canonical_admitted() {
        validate(APPROVED.as_bytes()).unwrap();
        assert_eq!(REQUIRED_PROOFS.len(), 13);
        assert_eq!(REQUIRED_CASES.len(), 18);
        for name in REQUIRED_PROOFS.iter().chain(REQUIRED_CASES.iter()) {
            assert!(APPROVED.contains(name), "missing immutable inventory item: {name}");
        }
    }
    #[test] fn duplicate_key_and_rewritten_host_denied() {
        reject(APPROVED.replacen(r#""host": "jvm-graal","#, r#""host": "jvm-graal", "host": "jvm-graal","#, 1).into_bytes());
        reject(APPROVED.replacen("jvm-graal", "native-cpp", 1).into_bytes());
    }
    #[test] fn noncanonical_inputs_rejected() {
        for raw in [
            [vec![0xef,0xbb,0xbf], APPROVED.as_bytes().to_vec()].concat(),
            APPROVED.replace("\n","\r\n").into_bytes(),
            [APPROVED.as_bytes(), b"\0"].concat(),
            vec![0xff,0xfe],
            APPROVED.replace("schemaVersion", r#"schema\u0056ersion"#).into_bytes(),
            APPROVED.replace("schemaVersion", "schemaVersi\\\\on").into_bytes(),
        ] { reject(raw); }
    }
    #[test] fn six_toolchains_are_not_optional() {
        for name in ["java","llvm","wasm","cranelift","net","forge"] {
            reject(APPROVED.replacen(&format!(r#""{name}": {{"#), r#""removed": {"#, 1).into_bytes());
        }
        reject(APPROVED.replace(r#""cranelift""#, r#""invented""#).into_bytes());
    }
    #[test] fn invented_guest_and_realtime_proofs_denied() {
        for name in ["verifiedGeneralGuestZeroGcBackends","verifiedHardRealtimeBackends"] {
            reject(APPROVED.replace(&format!(r#""{name}": []"#), &format!(r#""{name}": ["llvm"]"#)).into_bytes());
        }
        for field in ["sourceActorHeapLoweringCertified","guestZeroTracingCertified","fullProcessZeroGcCertified"] {
            reject(APPROVED.replacen(&format!(r#""{field}": false"#), &format!(r#""{field}": true"#),1).into_bytes());
        }
    }
    #[test] fn managed_host_gc_cannot_be_erased() {
        for host in ["jvm-graal","node-webassembly","clr-nativeaot"] {
            let prefix = format!("\"host\": \"{host}\",\n      \"hostTracingGcPossible\": true");
            let after = format!("\"host\": \"{host}\",\n      \"hostTracingGcPossible\": false");
            assert!(APPROVED.contains(&prefix));
            reject(APPROVED.replacen(&prefix, &after, 1).into_bytes());
        }
    }
    #[test] fn unsupported_cranelift_heap_cannot_be_fabricated() {
        reject(APPROVED.replacen("unsupported-scalar-only", "native-arena-substrate", 1).into_bytes());
    }
    #[test] fn proof_obligations_never_disappear() {
        for name in REQUIRED_PROOFS {
            reject(APPROVED.replacen(&format!(r#""{name}""#), r#""removed""#, 1).into_bytes());
        }
    }
    #[test] fn required_adversarial_cases_never_disappear() {
        for name in REQUIRED_CASES {
            reject(APPROVED.replacen(&format!(r#""{name}""#), r#""removed""#, 1).into_bytes());
        }
    }
    #[test] fn profile_and_release_rule_changes_denied() {
        for old in ["hardRealtimeTarget", "strictGuestNoTracingTargets", "nearZeroManagedHostTargets",
            "additionalNativeTargets", "source-only-policy", "hard-real-time latency."] {
            reject(APPROVED.replacen(old, "forged-change", 1).into_bytes());
        }
    }

    // All backend-wise claim mutations are independent: checking only the first
    // occurrence of a key leaves later backend entries vulnerable to drift.
    fn mutate_backend_field(backend: &str, field: &str, from: &str, to: &str) -> Vec<u8> {
        let anchor = format!("\"{backend}\": {{");
        let start = APPROVED.find(&anchor).expect("reviewed backend exists");
        let end = start + APPROVED[start..].find("\n    }").expect("backend block closes");
        let needle = format!("\"{field}\": {from}");
        let relative = APPROVED[start..end].find(&needle).expect("reviewed field exists");
        let begin = start + relative;
        let mut changed = APPROVED.to_string();
        changed.replace_range(begin..begin + needle.len(), &format!("\"{field}\": {to}"));
        changed.into_bytes()
    }

    #[test]
    fn all_six_backend_certification_bools_are_individually_fenced() {
        let fields = [
            "sourceActorHeapLoweringCertified",
            "guestZeroTracingCertified",
            "fullProcessZeroGcCertified",
        ];
        for backend in ["java", "llvm", "wasm", "cranelift", "net", "forge"] {
            for field in fields {
                reject(mutate_backend_field(backend, field, "false", "true"));
                reject(mutate_backend_field(backend, field, "false", "null"));
                reject(mutate_backend_field(backend, field, "false", r#""passed""#));
            }
        }
    }

    #[test]
    fn all_six_host_collector_claims_are_individually_fenced() {
        for (backend, expected) in [
            ("java", "true"), ("llvm", "false"), ("wasm", "true"),
            ("cranelift", "false"), ("net", "true"), ("forge", "false"),
        ] {
            let changed = if expected == "true" { "false" } else { "true" };
            reject(mutate_backend_field(backend, "hostTracingGcPossible", expected, changed));
            reject(mutate_backend_field(backend, "hostTracingGcPossible", expected, "null"));
        }
    }

    #[test]
    fn all_actor_heap_stages_require_explicit_review_before_promotion() {
        for (backend, stage) in [
            ("java", "host-arena-substrate"),
            ("llvm", "native-arena-substrate"),
            ("wasm", "host-linear-memory-substrate"),
            ("cranelift", "unsupported-scalar-only"),
            ("net", "unmanaged-arena-substrate"),
            ("forge", "native-arena-substrate"),
        ] {
            reject(mutate_backend_field(
                backend, "actorHeapStage",
                &format!("\"{stage}\""), r#""certified-actor-heap""#,
            ));
        }
    }

    #[test]
    fn every_backend_identity_is_immutable_not_just_backend_count() {
        for backend in ["java", "llvm", "wasm", "cranelift", "net", "forge"] {
            let from = format!("\"{backend}\": {{");
            let to = if backend == "java" { r#""llvm": {"# } else { r#""java": {"# };
            assert!(APPROVED.contains(&from));
            reject(APPROVED.replacen(&from, to, 1).into_bytes());
        }
    }

    #[test]
    fn duplicate_certification_field_in_each_backend_fails_closed() {
        for backend in ["java", "llvm", "wasm", "cranelift", "net", "forge"] {
            let from = format!("\"{backend}\": {{\n      \"host\":");
            let to = format!(
                "\"{backend}\": {{\n      \"guestZeroTracingCertified\": false,\n      \"host\":"
            );
            assert!(APPROVED.contains(&from));
            reject(APPROVED.replacen(&from, &to, 1).into_bytes());
        }
    }

    #[test]
    fn backend_section_reordering_cannot_hide_semantic_drift() {
        let first = "\"java\": {";
        let second = "\"llvm\": {";
        let changed = APPROVED.replacen(first, "BACKEND-SWAP-PLACEHOLDER", 1)
            .replacen(second, first, 1)
            .replacen("BACKEND-SWAP-PLACEHOLDER", second, 1);
        reject(changed.into_bytes());
    }

    #[test]
    fn invented_execution_and_approval_evidence_is_rejected() {
        for inserted in [
            "\"compiledGuestTestsPassed\": true,\n  ",
            "\"independentReviewApproved\": true,\n  ",
            "\"runtimeArtifactSha256\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n  ",
            "\"releaseCertified\": true,\n  ",
        ] {
            let altered = APPROVED.replacen("\"releaseRule\":", &format!("{inserted}\"releaseRule\":"), 1);
            reject(altered.into_bytes());
        }
    }

    #[test]
    fn evidence_scope_and_release_boundary_are_immutable() {
        for (from, to) in [
            ("source-only-policy", "compiler-backed-guest-pass"),
            ("A declaration-only fixture", "A complete guest proof"),
            ("hard-real-time latency.", "hard-real-time certified."),
        ] {
            assert!(APPROVED.contains(from));
            reject(APPROVED.replacen(from, to, 1).into_bytes());
        }
    }

    #[test]
    fn proof_inventory_reordering_and_duplication_are_denied() {
        let first = REQUIRED_PROOFS[0];
        let second = REQUIRED_PROOFS[1];
        let swapped = APPROVED.replacen(first, "PROOF-SWAP-PLACEHOLDER", 1)
            .replacen(second, first, 1)
            .replacen("PROOF-SWAP-PLACEHOLDER", second, 1);
        reject(swapped.into_bytes());
        let duplicated = APPROVED.replacen(second, first, 1);
        reject(duplicated.into_bytes());
    }

    #[test]
    fn adversarial_case_inventory_reordering_and_duplication_are_denied() {
        let first = REQUIRED_CASES[0];
        let second = REQUIRED_CASES[1];
        let swapped = APPROVED.replacen(first, "CASE-SWAP-PLACEHOLDER", 1)
            .replacen(second, first, 1)
            .replacen("CASE-SWAP-PLACEHOLDER", second, 1);
        reject(swapped.into_bytes());
        let duplicated = APPROVED.replacen(second, first, 1);
        reject(duplicated.into_bytes());
    }

    #[test]
    fn scanner_enforces_token_budget_independently_of_byte_budget() {
        // 4097 short punctuation tokens fit comfortably below the 64 KiB cap.
        let many_tokens = vec![b'['; 4097];
        assert_eq!(
            scan(&many_tokens).expect_err("token explosion must fail"),
            "policy token budget exceeded"
        );
        let too_many_bytes = vec![b' '; 65_537];
        assert_eq!(
            scan(&too_many_bytes).expect_err("oversize must fail"),
            "noncanonical encoding or oversized policy"
        );
    }

    #[test]
    fn malformed_unicode_control_and_embedded_nul_fail_closed() {
        let mut mid_invalid_utf8 = APPROVED.as_bytes().to_vec();
        let idx = APPROVED.find("source-only-policy").unwrap();
        mid_invalid_utf8[idx] = 0xff;
        reject(mid_invalid_utf8);
        for byte in [0u8, 0x01, 0x1f, 0x7f] {
            let mut changed = APPROVED.as_bytes().to_vec();
            changed[idx] = byte;
            reject(changed);
        }
        reject(APPROVED.replacen("source-only-policy", r#"source-\u006fnly-policy"#, 1).into_bytes());
    }

    #[test]
    fn harmless_outside_string_whitespace_does_not_change_meaning() {
        let spaced = APPROVED.replacen(
            "\"schemaVersion\": 1,",
            "\"schemaVersion\" :  1 ,",
            1,
        );
        validate(spaced.as_bytes()).expect("insignificant JSON whitespace is allowed");
    }


    #[test]
    fn bounded_reader_accepts_exact_limit_and_rejects_one_more_byte() {
        let within = read_bounded(std::io::Cursor::new(vec![b' '; MAX_POLICY_BYTES]))
            .expect("reader must permit exactly the budget");
        assert_eq!(within.len(), MAX_POLICY_BYTES);
        let err = read_bounded(std::io::Cursor::new(vec![b' '; MAX_POLICY_BYTES + 1]))
            .expect_err("reader must reject the first oversized byte");
        assert_eq!(err, "noncanonical encoding or oversized policy");
    }

    #[test]
    fn bounded_reader_denies_infinite_stream_without_unbounded_allocation() {
        // A never-ending input must terminate at exactly the first excess byte,
        // rather than waiting for EOF or trying to materialize the whole stream.
        let error = read_bounded(std::io::repeat(b'x'))
            .expect_err("infinite stream must fail at the budget");
        assert_eq!(error, "noncanonical encoding or oversized policy");
    }

    #[test]
    fn bounded_reader_surfaces_io_errors_instead_of_accepting_partial_data() {
        struct FailMidStream { count: usize }
        impl Read for FailMidStream {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if self.count >= 3 {
                    return Err(std::io::Error::other("forced read failure"));
                }
                let n = (3 - self.count).min(buf.len());
                buf[..n].fill(b'{');
                self.count += n;
                Ok(n)
            }
        }
        let err = read_bounded(FailMidStream { count: 0 })
            .expect_err("partial read followed by error is not a complete policy");
        assert!(err.contains("forced read failure"), "{err}");
    }

    #[test]
    fn on_disk_policy_reader_denies_symlinks_directories_and_oversized_files() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
            .expect("system clock").as_nanos();
        let dir = std::env::temp_dir()
            .join(format!("atto-gc-policy-test-{}-{nonce}", std::process::id()));
        fs::create_dir(&dir).expect("private test directory");
        let regular = dir.join("policy.json");
        fs::write(&regular, APPROVED.as_bytes()).expect("write baseline fixture");
        let readback = read_policy_file(&regular).expect("regular baseline policy");
        validate(&readback).expect("readback must be precisely the reviewed policy");
        assert!(read_policy_file(&dir).is_err(), "directory is not policy input");

        let oversized = dir.join("oversized.json");
        fs::write(&oversized, vec![b' '; MAX_POLICY_BYTES + 1])
            .expect("write oversized fixture");
        assert!(read_policy_file(&oversized).is_err(), "oversized regular file denied");

        #[cfg(unix)]
        {
            let link = dir.join("policy.link");
            std::os::unix::fs::symlink(&regular, &link).expect("create symlink fixture");
            assert_eq!(
                read_policy_file(&link).expect_err("symlink must be denied"),
                "policy must be a regular non-symlink file",
            );
        }
        fs::remove_dir_all(&dir).expect("remove owned test directory");
    }

    #[test]
    fn normal_policy_bytes_remain_valid_under_bounded_reader() {
        let raw = read_bounded(std::io::Cursor::new(APPROVED.as_bytes()))
            .expect("read immutable policy");
        validate(&raw).expect("bounded read must preserve exact policy tokens");
    }


    #[test]
    fn parent_traversal_is_denied_before_any_filesystem_read() {
        let err = read_policy_file(std::path::Path::new("contracts/../contracts/actor_gc_profiles_v1.json"))
            .expect_err("parent traversal must not be accepted");
        assert_eq!(err, "policy parent traversal denied");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_parent_directory_is_denied() {
        use std::os::unix::fs::symlink;
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
            .expect("clock").as_nanos();
        let root = std::env::temp_dir().canonicalize().expect("canonical temp directory")
            .join(format!("atto-gc-parent-symlink-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).expect("test root");
        let real = root.join("real");
        fs::create_dir(&real).expect("real directory");
        fs::write(real.join("policy.json"), APPROVED).expect("write policy");
        let alias = root.join("alias");
        symlink(&real, &alias).expect("symlink parent");
        let err = read_policy_file(&alias.join("policy.json"))
            .expect_err("symlinked ancestor must not be accepted");
        assert_eq!(err, "policy ancestor must be a real directory");
        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[cfg(unix)]
    #[test]
    fn post_stat_replaced_regular_inode_is_denied() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
            .expect("clock").as_nanos();
        let root = std::env::temp_dir().canonicalize().expect("canonical temp directory")
            .join(format!("atto-gc-inode-swap-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).expect("test root");
        let policy = root.join("policy.json");
        fs::write(&policy, APPROVED).expect("write baseline");
        let before = fs::symlink_metadata(&policy).expect("baseline metadata");
        fs::rename(&policy, root.join("old.json")).expect("preserve original inode");
        fs::write(&policy, APPROVED).expect("write new inode with equal content");
        let err = read_policy_after_stat(&policy, &before)
            .expect_err("changed inode must fail even if tokens are identical");
        assert_eq!(err, "policy identity changed during open");
        fs::remove_dir_all(&root).expect("remove test root");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn post_stat_symlink_swap_to_same_inode_is_denied_by_nofollow() {
        use std::os::unix::fs::symlink;
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
            .expect("clock").as_nanos();
        let root = std::env::temp_dir().canonicalize().expect("canonical temp directory")
            .join(format!("atto-gc-same-inode-swap-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).expect("test root");
        let policy = root.join("policy.json");
        fs::write(&policy, APPROVED).expect("write baseline");
        let before = fs::symlink_metadata(&policy).expect("baseline metadata");
        let backing = root.join("backing.json");
        fs::rename(&policy, &backing).expect("preserve inode");
        symlink(&backing, &policy).expect("swap to symlink of identical inode");
        let err = read_policy_after_stat(&policy, &before)
            .expect_err("O_NOFOLLOW must deny symlink-to-same-inode substitution");
        assert!(err.starts_with("policy open failed:"), "{err}");
        fs::remove_dir_all(&root).expect("remove test root");
    }


    #[cfg(target_os = "linux")]
    #[test]
    fn parent_symlink_swap_to_identical_inode_is_denied_by_openat2() {
        use std::os::unix::fs::{symlink, MetadataExt};
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
            .expect("clock").as_nanos();
        let root = std::env::temp_dir().canonicalize().expect("canonical temp")
            .join(format!("atto-gc-parent-swap-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).expect("test root");
        let parent = root.join("live");
        fs::create_dir(&parent).expect("original parent");
        let policy = parent.join("policy.json");
        fs::write(&policy, APPROVED).expect("write policy");
        let before = fs::symlink_metadata(&policy).expect("pre-swap stat");
        let retired = root.join("retired");
        fs::rename(&parent, &retired).expect("move real directory");
        symlink(&retired, &parent).expect("swap parent to symlink");
        let after = fs::metadata(&policy).expect("same policy inode still reachable");
        assert_eq!(before.ino(), after.ino());
        assert_eq!(before.dev(), after.dev());
        // Previously O_NOFOLLOW checked only the final component; the file
        // was identical, so the inode check was insufficient.
        let err = read_policy_after_stat(&policy, &before)
            .expect_err("entire symlinked path must be refused");
        assert!(err.starts_with("policy openat2 denied"), "{err}");
        fs::remove_dir_all(&root).expect("cleanup own root");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn fifo_replacement_after_stat_is_denied_without_blocking_open() {
        use std::ffi::CString;
        use std::os::raw::c_char;
        use std::os::unix::ffi::OsStrExt;
        use std::time::{SystemTime, UNIX_EPOCH};
        unsafe extern "C" {
            fn mkfifo(path: *const c_char, mode: u32) -> i32;
        }
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
            .expect("clock").as_nanos();
        let root = std::env::temp_dir().canonicalize().expect("canonical temp")
            .join(format!("atto-gc-fifo-replace-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).expect("test root");
        let policy = root.join("policy.json");
        fs::write(&policy, APPROVED).expect("write regular file");
        let before = fs::symlink_metadata(&policy).expect("pre-swap stat");
        fs::remove_file(&policy).expect("remove regular file");
        let c_path = CString::new(policy.as_os_str().as_bytes()).expect("no NUL");
        // SAFETY: NUL-terminated path; creating a private test FIFO.
        assert_eq!(unsafe { mkfifo(c_path.as_ptr(), 0o600) }, 0);
        let err = read_policy_after_stat(&policy, &before)
            .expect_err("FIFO must never be accepted");
        assert!(
            err == "policy opened as non-regular file"
                || err.starts_with("policy openat2 denied"),
            "{err}"
        );
        fs::remove_dir_all(&root).expect("cleanup own root");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn openat2_accepts_relative_and_absolute_canonical_policy() {
        let relative = std::path::Path::new("contracts/actor_gc_profiles_v1.json");
        let bytes = read_policy_file(relative).expect("relative policy permitted");
        validate(&bytes).expect("relative immutable contract");
        let absolute = std::env::current_dir().expect("cwd").join(relative);
        let bytes = read_policy_file(&absolute).expect("absolute policy permitted");
        validate(&bytes).expect("absolute immutable contract");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn openat2_rejects_nul_path_and_final_symlink() {
        let error = open_policy_checked(std::path::Path::new("contracts/policy\0evil"))
            .expect_err("interior NUL refused");
        assert_eq!(error, "policy path contains NUL");
        use std::os::unix::fs::symlink;
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)
            .expect("clock").as_nanos();
        let root = std::env::temp_dir().canonicalize().expect("canonical temp")
            .join(format!("atto-gc-link-final-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).expect("test root");
        let target = root.join("target.json");
        fs::write(&target, APPROVED).expect("create target");
        let link = root.join("policy.link");
        symlink(&target, &link).expect("create final symlink");
        let error = open_policy_checked(&link).expect_err("no-follow is mandatory");
        assert!(error.starts_with("policy openat2 denied"), "{error}");
        fs::remove_dir_all(&root).expect("cleanup own root");
    }

}
