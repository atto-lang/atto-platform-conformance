//! Rust-only read-only planner for pinned AOT cases and 11-backend inventories.
//! Generates NOT_EXECUTED planning entries; never runs or certifies Atto guests.
use std::collections::BTreeSet;
use std::io::Write;
use std::process::{Command, Stdio};
use std::{env, fs, process};

const CONTRACT_BLOB: &str = "b31f8a5b86a4d9529b89cd1ff2a8b379c33d3dfa";
const BACKENDS: [&str;11] = ["llvm","wasm","rs","java","net","js","forge","cranelift","atto","hdl","realtime"];
const FEATURES: [&str;10] = ["native_aot","wasm_codegen","wasm_host","jit",
    "soft_real_time","hard_real_time","tenant_vm","actor_runtime","zero_guest_gc","ownership_borrowing"];
const HEADER: &str = "backend\tfeature\tintent\toutcome\tsource_sha\tcompiler_sha\tartifact_sha256\tevidence_sha256\texecuted_cases\tguest_executed";
const INTENTS: [&str;6] = ["PRIMARY","SECONDARY","HOST_DELEGATED","CONSTRAINED",
    "SECURITY_PROOF_REQUIRED","NOT_APPLICABLE"];
const PROFILES: [(&str,&str);7] = [
    ("forge-native-aot","forge"),
    ("graal-native-epsilon-aot","java"),
    ("graal-native-managed-aot","java"),
    ("java-jvm-low-gc","java"),
    ("llvm-native-aot","llvm"),
    ("net-native-aot","net"),
    ("wasm-precompiled-aot","wasm")
];
const CASES: [(&str,&str,&str,bool);6] = [
    ("counter-source-aot","counter","compiled-guest",false),
    ("fleet-source-aot","fleet","compiled-guest",false),
    ("two-tenant-state-isolation","counter","tenant-security",true),
    ("stale-actor-handle-denial","counter","tenant-security",true),
    ("actor-tenant-recycling-soak","fleet","memory-soak",false),
    ("cross-tenant-unauthorized-pointer","counter","tenant-security",true)
];
#[derive(Debug,Clone)]
struct Entry<'a> { backend: &'a str, feature: &'a str, intent: &'a str }

fn git_blob(input: &str) -> Result<String,String> {
    let mut child = Command::new("git").args(["hash-object","--stdin"])
        .stdin(Stdio::piped()).stdout(Stdio::piped())
        .stderr(Stdio::null()).spawn()
        .map_err(|_| "E_PLAN: git hash-object unavailable")?;
    child.stdin.take().ok_or("E_PLAN: missing git stdin")?
        .write_all(input.as_bytes()).map_err(|_| "E_PLAN: cannot hash input")?;
    let done = child.wait_with_output().map_err(|_| "E_PLAN: hash process failed")?;
    if !done.status.success() { return Err("E_PLAN: hash failed".into()); }
    let sha = String::from_utf8(done.stdout).map_err(|_| "E_PLAN: nonascii hash")?;
    Ok(sha.trim().to_owned())
}
fn plan_aot(contract: &str, backend: Option<&str>) -> Result<String,String> {
    if git_blob(contract)? != CONTRACT_BLOB { return Err("E_PLAN: unreviewed AOT contract changes".into()); }
    if let Some(name) = backend {
        if !BACKENDS.contains(&name) { return Err("E_PLAN: unknown backend".into()); }
        if !PROFILES.iter().any(|(_,b)|*b==name) { return Err("E_PLAN: no AOT profiles for backend".into()); }
    }
    let mut parts = Vec::new();
    for (profile,b) in PROFILES {
        if backend.is_some() && backend != Some(b) { continue; }
        for (id,fixture,kind,security) in CASES {
            parts.push(format!(
                "{{\"profile\":\"{profile}\",\"backend\":\"{b}\",\"case_id\":\"{id}\",\"fixture\":\"{fixture}\",\"kind\":\"{kind}\",\"require_tenant_security\":{security},\"status\":\"NOT_EXECUTED\"}}"));
        }
    }
    Ok(format!("{{\"schema\":\"atto.conformance-plan.v2\",\"source_contract\":\"atto.aot-gc-tenant-evidence.v1\",\"source_git_blob\":\"{CONTRACT_BLOB}\",\"certification\":\"NOT_CERTIFIED\",\"guest_executed\":false,\"entries\":[{}]}}",parts.join(",")))
}
fn plan_capabilities(inventory: &str, backend: Option<&str>) -> Result<String,String> {
    if inventory.len()>262_144 || inventory.contains('\r') || inventory.contains('\0') {
        return Err("E_PLAN: invalid inventory encoding or size".into());
    }
    let mut lines=inventory.lines();
    if lines.next()!=Some(HEADER) { return Err("E_PLAN: unsupported registry header".into()); }
    if let Some(b)=backend { if !BACKENDS.contains(&b) { return Err("E_PLAN: unknown backend".into()); }}
    let mut seen=BTreeSet::new();
    let mut records=Vec::new();
    for line in lines {
        let f:Vec<&str>=line.split('\t').collect();
        if f.len()!=10 || !BACKENDS.contains(&f[0]) || !FEATURES.contains(&f[1]) ||
           !INTENTS.contains(&f[2]) || f[3]!="NOT_EXECUTED" ||
           f[4..8].iter().any(|v|*v!="-") || f[8]!="0" || f[9]!="false" {
            return Err("E_PLAN: invalid, promoted, or uncertified capability record".into());
        }
        if !seen.insert((f[0],f[1])) { return Err("E_PLAN: duplicate backend/feature".into()); }
        records.push(Entry {backend:f[0],feature:f[1],intent:f[2]});
    }
    for b in BACKENDS { for feature in FEATURES {
        if !seen.contains(&(b,feature)) {
            return Err(format!("E_PLAN: missing {b}/{feature}"));
        }
    }}
    if seen.len()!=110 { return Err("E_PLAN: wrong capability inventory cardinality".into()); }
    let digest=git_blob(inventory)?;
    let entries=records.into_iter().filter(|v|backend.is_none()||backend==Some(v.backend))
        .map(|v|format!("{{\"backend\":\"{}\",\"feature\":\"{}\",\"intent\":\"{}\",\"status\":\"NOT_EXECUTED\"}}",
                        v.backend,v.feature,v.intent)).collect::<Vec<_>>();
    Ok(format!("{{\"schema\":\"atto.capability-plan.v1\",\"source_contract\":\"atto-target-profiles/profiles/compiler-feature-capabilities-v1.tsv\",\"source_git_blob\":\"{digest}\",\"certification\":\"NOT_CERTIFIED\",\"guest_executed\":false,\"entries\":[{}]}}",entries.join(",")))
}
fn main() {
    let args:Vec<String>=env::args().skip(1).collect();
    let valid=(args.len()==2 || args.len()==4) &&
        (args[0]=="--aot-contract" || args[0]=="--inventory") &&
        (args.len()==2 || args[2]=="--backend");
    if !valid {
        eprintln!("usage: plan_capabilities --aot-contract|--inventory <path> [--backend <name>]");
        process::exit(2);
    }
    let content=fs::read_to_string(&args[1]).unwrap_or_else(|_|{
        eprintln!("E_PLAN: cannot read source contract"); process::exit(1)
    });
    let backend=if args.len()==4 {Some(args[3].as_str())} else {None};
    let result=if args[0]=="--inventory" {plan_capabilities(&content,backend)}
               else {plan_aot(&content,backend)};
    match result {
        Ok(out)=>println!("{out}"),
        Err(e)=>{eprintln!("{e}");process::exit(1)}
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const CONTRACT: &str = include_str!("../contracts/aot-gc-tenant-evidence-v1.json");
    const REGISTRY: &str = include_str!("../tests/fixtures/capability-inventory-v1.tsv");
    #[test] fn full_aot_plan_keeps_all_42_entries_unexecuted() {
        let p=plan_aot(CONTRACT,None).unwrap();
        assert_eq!(p.matches("\"case_id\":").count(),42);
        assert!(!p.contains("\"status\":\"PASSED\""));
        assert!(p.contains("\"guest_executed\":false"));
    }
    #[test] fn aot_backend_filter_is_complete() {
        let p=plan_aot(CONTRACT,Some("java")).unwrap();
        assert_eq!(p.matches("\"case_id\":").count(),18);
        assert_eq!(plan_aot(CONTRACT,Some("cranelift")).err().unwrap(),"E_PLAN: no AOT profiles for backend");
    }
    #[test] fn changed_contract_cannot_claim_proof() {
        assert!(plan_aot(&CONTRACT.replace("NOT_EXECUTED_ALL_BACKENDS","PASSED"),None).is_err());
    }
    #[test] fn all_110_backend_feature_plans_are_not_executed() {
        let p=plan_capabilities(REGISTRY,None).unwrap();
        assert_eq!(p.matches("\"feature\":").count(),110);
        assert!(p.contains("\"certification\":\"NOT_CERTIFIED\""));
        assert!(!p.contains("\"status\":\"PASSED\""));
    }
    #[test] fn backend_filter_is_precise() {
        let p=plan_capabilities(REGISTRY,Some("realtime")).unwrap();
        assert_eq!(p.matches("\"feature\":").count(),10);
        assert!(!p.contains("\"backend\":\"llvm\""));
    }
    #[test] fn fake_status_promotion_rejected() {
        assert!(plan_capabilities(&REGISTRY.replacen("NOT_EXECUTED","PASSED",1),None).is_err());
    }
    #[test] fn duplicate_row_rejected() {
        assert!(plan_capabilities(&format!("{REGISTRY}{}\n",REGISTRY.lines().nth(1).unwrap()),None).is_err());
    }
    #[test] fn missing_row_rejected() {
        let s=REGISTRY.lines().filter(|x|!x.starts_with("llvm\tnative_aot\t")).collect::<Vec<_>>().join("\n");
        assert!(plan_capabilities(&s,None).is_err());
    }
    #[test] fn wrong_guest_flag_rejected() {
        assert!(plan_capabilities(&REGISTRY.replacen("\t0\tfalse","\t0\ttrue",1),None).is_err());
    }
    #[test] fn unknown_backend_rejected() {
        assert!(plan_capabilities(REGISTRY,Some("unknown")).is_err());
    }
    #[test] fn unknown_intent_rejected() {
        assert!(plan_capabilities(&REGISTRY.replacen("PRIMARY","UNSAFE_ASSUMPTION",1),None).is_err());
    }
    #[test] fn pinned_source_file_is_immutable_snapshot() {
        assert_eq!(git_blob(REGISTRY).unwrap(),"c2ffbd435f1360a82c47162fc97a56fee05bc282");
        assert_eq!(git_blob(CONTRACT).unwrap(),CONTRACT_BLOB);
    }
}
