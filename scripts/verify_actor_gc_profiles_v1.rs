//! Immutable six-toolchain actor GC release policy. This tests POLICY ONLY.
 //! No interpreter/compiler guest is run by this validator.
use std::{fs, str};

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

#[derive(Debug, PartialEq, Eq)]
struct Token<'a> { kind: u8, raw: &'a str }
fn scan(bytes: &[u8]) -> Result<Vec<Token<'_>>, String> {
    if bytes.len() > 65_536 || bytes.starts_with(&[0xef, 0xbb, 0xbf])
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
    let result = fs::read("contracts/actor_gc_profiles_v1.json")
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
}
