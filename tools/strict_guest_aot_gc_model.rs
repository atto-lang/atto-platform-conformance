//! SOURCE-FREE MODEL ONLY: no compiler, guest, allocator, GitHub API or runner is exercised.
//! Never promote synthetic model tests into backend or release certification.
#![forbid(unsafe_code)]

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Backend { Graalvm, Llvm, Net, Wasm, Forge, Cranelift, Js }
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Profile { SealedGuestAot, HostAot, GovernedModuleAot, Hybrid }
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GcClaim { GuestZeroTracing, ProcessZeroGc, ManagedHost }
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum NegativeFeature {
    Eval, RuntimeClass, RuntimeMethod, OpenReflection, UnknownProxy,
    PrivateProxy, ErasedDispatch, EscapingBorrow, StrongCycle,
    ClosureChannel, StaleGeneration, MissingCleanup, UngovernedModule,
    JitFallback, UnboundedQuota, NonSendable,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum PositiveFeature {
    VirtualDispatch, StaticProxy, ClosureCapture, ActorChurn,
    TaskFrameCleanup, GenerationRetirement, QuotaOom, SendableMove,
}
const NEGATIVE_FEATURES: [NegativeFeature; 16] = [
    NegativeFeature::Eval, NegativeFeature::RuntimeClass,
    NegativeFeature::RuntimeMethod, NegativeFeature::OpenReflection,
    NegativeFeature::UnknownProxy, NegativeFeature::PrivateProxy,
    NegativeFeature::ErasedDispatch, NegativeFeature::EscapingBorrow,
    NegativeFeature::StrongCycle, NegativeFeature::ClosureChannel,
    NegativeFeature::StaleGeneration, NegativeFeature::MissingCleanup,
    NegativeFeature::UngovernedModule, NegativeFeature::JitFallback,
    NegativeFeature::UnboundedQuota, NegativeFeature::NonSendable,
];
const POSITIVE_FEATURES: [PositiveFeature; 8] = [
    PositiveFeature::VirtualDispatch, PositiveFeature::StaticProxy,
    PositiveFeature::ClosureCapture, PositiveFeature::ActorChurn,
    PositiveFeature::TaskFrameCleanup, PositiveFeature::GenerationRetirement,
    PositiveFeature::QuotaOom, PositiveFeature::SendableMove,
];

#[derive(Clone, Debug)]
struct NegativeCase {
    feature: NegativeFeature,
    fixture_sha: String,
    compiler_executed: bool,
    rejected: bool,
    rejection_before_ir: bool,
    stable_diagnostic: bool,
}
#[derive(Clone, Debug)]
struct PositiveCase {
    feature: PositiveFeature,
    fixture_sha: String,
    guest_compiled: bool,
    guest_executed: bool,
    artifact_sha: String,
}
#[derive(Clone, Debug)]
struct SyntheticReceipt {
    backend: Backend,
    profile: Profile,
    gc_claim: GcClaim,
    expected_head: String,
    observed_head: String,
    expected_tree: String,
    observed_tree: String,
    compiler_sha: String,
    artifact_sha: String,
    source_repository_id: u64,
    runner_repository_id: u64,
    author_id: u64,
    reviewer_id: u64,
    branch_protected: bool,
    workflow_trusted: bool,
    independently_approved: bool,
    artifact_bound_to_head: bool,
    runner_id: u64,
    run_attempt: u64,
    run_completed_successfully: bool,
    job_completed_successfully: bool,
    executed_steps: Vec<&'static str>,
    compiled_guest: bool,
    executed_guest_artifact: bool,
    host_interpreter_or_jit_fallback: bool,
    allocator_instrumented: bool,
    process_gc_instrumented: bool,
    negatives: Vec<NegativeCase>,
    positives: Vec<PositiveCase>,
}

fn valid_sha(s: &str, digits: usize) -> bool {
    s.len() == digits
        && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && s.bytes().any(|b| b != b'0')
}

/// Checks only a synthetic *candidate for external verification*. This is
/// deliberately not a real attestation verifier: all fields are caller supplied.
fn check(r: &SyntheticReceipt) -> Result<(), &'static str> {
    if !valid_sha(&r.expected_head, 40) || r.expected_head != r.observed_head
        || !valid_sha(&r.expected_tree, 40) || r.expected_tree != r.observed_tree
        || !valid_sha(&r.compiler_sha, 64) || !valid_sha(&r.artifact_sha, 64)
    { return Err("exact source/tree/compiler/artifact identity missing or stale"); }
    if r.source_repository_id == 0 || r.runner_repository_id == 0
        || r.source_repository_id != r.runner_repository_id
    { return Err("source-free model forbids unapproved cross-repository source transfer"); }
    if r.author_id == 0 || r.reviewer_id == 0 || r.author_id == r.reviewer_id
        || !r.branch_protected || !r.workflow_trusted || !r.independently_approved
    { return Err("independent review or trusted protected workflow missing"); }
    if !r.artifact_bound_to_head { return Err("artifact is not bound to source head"); }
    if r.profile != Profile::SealedGuestAot { return Err("not sealed full guest AOT"); }
    if r.backend == Backend::Js { return Err("transpiled JavaScript is not sealed native guest AOT"); }
    if r.gc_claim == GcClaim::ManagedHost { return Err("no guest zero tracing-GC claim"); }
    if r.gc_claim == GcClaim::ProcessZeroGc {
        if matches!(r.backend, Backend::Graalvm | Backend::Net | Backend::Wasm | Backend::Js)
            || !r.process_gc_instrumented
        { return Err("process zero-GC not independently substantiated"); }
    }
    if r.runner_id == 0 || r.run_attempt == 0 || !r.run_completed_successfully
        || !r.job_completed_successfully
    { return Err("no successful executed workflow attempt"); }
    if r.executed_steps.len() < 4 { return Err("required named steps absent"); }
    for required in ["checkout-exact-head", "compile-guest", "execute-guest", "allocator-probe"] {
        if r.executed_steps.iter().filter(|s| **s == required).count() != 1 {
            return Err("missing or duplicated required step");
        }
    }
    if !r.compiled_guest || !r.executed_guest_artifact || r.host_interpreter_or_jit_fallback
        || !r.allocator_instrumented
    { return Err("guest AOT execution or allocator proof absent"); }
    if r.negatives.len() != NEGATIVE_FEATURES.len() { return Err("negative matrix incomplete"); }
    let mut seen_negative = std::collections::BTreeSet::new();
    for case in &r.negatives {
        if !NEGATIVE_FEATURES.contains(&case.feature) || !seen_negative.insert(case.feature)
            || !valid_sha(&case.fixture_sha, 64) || !case.compiler_executed
            || !case.rejected || !case.rejection_before_ir || !case.stable_diagnostic
        { return Err("negative fixture missing, repeated, or not rejected before IR"); }
    }
    if r.positives.len() != POSITIVE_FEATURES.len() { return Err("positive matrix incomplete"); }
    let mut seen_positive = std::collections::BTreeSet::new();
    for case in &r.positives {
        if !POSITIVE_FEATURES.contains(&case.feature) || !seen_positive.insert(case.feature)
            || !valid_sha(&case.fixture_sha, 64) || !valid_sha(&case.artifact_sha, 64)
            || !case.guest_compiled || !case.guest_executed
        { return Err("positive guest fixture missing, repeated, or not executed"); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn synthetic() -> SyntheticReceipt {
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let c = "c".repeat(64);
        let d = "d".repeat(64);
        SyntheticReceipt {
            backend: Backend::Llvm,
            profile: Profile::SealedGuestAot,
            gc_claim: GcClaim::GuestZeroTracing,
            expected_head: a.clone(), observed_head: a,
            expected_tree: b.clone(), observed_tree: b,
            compiler_sha: c.clone(), artifact_sha: d.clone(),
            source_repository_id: 17, runner_repository_id: 17,
            author_id: 9, reviewer_id: 10,
            branch_protected: true, workflow_trusted: true,
            independently_approved: true, artifact_bound_to_head: true,
            runner_id: 74, run_attempt: 2,
            run_completed_successfully: true, job_completed_successfully: true,
            executed_steps: vec!["checkout-exact-head", "compile-guest", "execute-guest", "allocator-probe"],
            compiled_guest: true, executed_guest_artifact: true,
            host_interpreter_or_jit_fallback: false,
            allocator_instrumented: true, process_gc_instrumented: false,
            negatives: NEGATIVE_FEATURES.iter().map(|&feature| NegativeCase {
                feature, fixture_sha: c.clone(), compiler_executed: true,
                rejected: true, rejection_before_ir: true, stable_diagnostic: true,
            }).collect(),
            positives: POSITIVE_FEATURES.iter().map(|&feature| PositiveCase {
                feature, fixture_sha: c.clone(), artifact_sha: d.clone(),
                guest_compiled: true, guest_executed: true,
            }).collect(),
        }
    }
    #[test] fn synthetic_candidates_cover_six_aot_backend_families() {
        for backend in [Backend::Graalvm, Backend::Llvm, Backend::Net,
                        Backend::Wasm, Backend::Forge, Backend::Cranelift] {
            let mut r = synthetic(); r.backend = backend;
            assert_eq!(check(&r), Ok(()), "synthetic model {backend:?}");
        }
    }
    #[test] fn no_host_aot_or_jit_relabeling() {
        for p in [Profile::HostAot, Profile::GovernedModuleAot, Profile::Hybrid] {
            let mut r=synthetic();r.profile=p;assert!(check(&r).is_err());
        }
    }
    #[test] fn js_transpilation_is_not_guest_native_aot() {
        let mut r=synthetic();r.backend=Backend::Js;assert!(check(&r).is_err());
    }
    #[test] fn managed_host_claim_cannot_pass_as_zero_gc() {
        let mut r=synthetic();r.gc_claim=GcClaim::ManagedHost;assert!(check(&r).is_err());
    }
    #[test] fn process_zero_gc_not_inferred_for_managed_host_backends() {
        for backend in [Backend::Graalvm,Backend::Net,Backend::Wasm,Backend::Js] {
            let mut r=synthetic();r.backend=backend;r.gc_claim=GcClaim::ProcessZeroGc;
            r.process_gc_instrumented=true;assert!(check(&r).is_err());
        }
    }
    #[test] fn native_process_claim_requires_process_gc_instrumentation() {
        for backend in [Backend::Llvm, Backend::Forge, Backend::Cranelift] {
            let mut r=synthetic();r.backend=backend;r.gc_claim=GcClaim::ProcessZeroGc;
            assert!(check(&r).is_err());
            r.process_gc_instrumented=true;assert_eq!(check(&r),Ok(()));
        }
    }
    #[test] fn missing_or_stale_head_is_rejected() {
        let mut r=synthetic();r.observed_head="e".repeat(40);assert!(check(&r).is_err());
        r=synthetic();r.expected_head="A".repeat(40);assert!(check(&r).is_err());
        r=synthetic();r.expected_head="0".repeat(40);r.observed_head=r.expected_head.clone();assert!(check(&r).is_err());
        r=synthetic();r.expected_head="a".repeat(39);r.observed_head=r.expected_head.clone();assert!(check(&r).is_err());
    }
    #[test] fn missing_or_stale_tree_is_rejected() {
        let mut r=synthetic();r.observed_tree="e".repeat(40);assert!(check(&r).is_err());
        r=synthetic();r.expected_tree="0".repeat(40);r.observed_tree=r.expected_tree.clone();assert!(check(&r).is_err());
    }
    #[test] fn compiler_and_artifact_digests_require_64_lowercase_hex() {
        let mut r=synthetic();r.compiler_sha="a".repeat(40);assert!(check(&r).is_err());
        r=synthetic();r.artifact_sha="A".repeat(64);assert!(check(&r).is_err());
        r=synthetic();r.compiler_sha="0".repeat(64);assert!(check(&r).is_err());
    }
    #[test] fn cross_repo_transfer_without_authorization_denied() {
        let mut r=synthetic();r.runner_repository_id=99;assert!(check(&r).is_err());
        r=synthetic();r.source_repository_id=0;assert!(check(&r).is_err());
        r=synthetic();r.runner_repository_id=0;assert!(check(&r).is_err());
    }
    #[test] fn self_approval_or_missing_review_denied() {
        let mut r=synthetic();r.reviewer_id=r.author_id;assert!(check(&r).is_err());
        r=synthetic();r.reviewer_id=0;assert!(check(&r).is_err());
        r=synthetic();r.author_id=0;assert!(check(&r).is_err());
        r=synthetic();r.independently_approved=false;assert!(check(&r).is_err());
    }
    #[test] fn unprotected_branch_or_untrusted_workflow_denied() {
        let mut r=synthetic();r.branch_protected=false;assert!(check(&r).is_err());
        r=synthetic();r.workflow_trusted=false;assert!(check(&r).is_err());
    }
    #[test] fn artifact_provenance_must_be_bound_to_exact_head() {
        let mut r=synthetic();r.artifact_bound_to_head=false;assert!(check(&r).is_err());
    }
    #[test] fn zero_runner_and_missing_attempt_denied() {
        let mut r=synthetic();r.runner_id=0;assert!(check(&r).is_err());
        r=synthetic();r.run_attempt=0;assert!(check(&r).is_err());
    }
    #[test] fn failed_or_skipped_workflow_cannot_be_promoted() {
        let mut r=synthetic();r.run_completed_successfully=false;assert!(check(&r).is_err());
        r=synthetic();r.job_completed_successfully=false;assert!(check(&r).is_err());
    }
    #[test] fn empty_and_partial_step_sets_denied() {
        let mut r=synthetic();r.executed_steps.clear();assert!(check(&r).is_err());
        for required in ["checkout-exact-head","compile-guest","execute-guest","allocator-probe"] {
            let mut r=synthetic();r.executed_steps.retain(|s|*s!=required);
            assert!(check(&r).is_err(),"missing {required}");
        }
    }
    #[test] fn duplicate_step_names_denied() {
        let mut r=synthetic();r.executed_steps.push("compile-guest");assert!(check(&r).is_err());
        r=synthetic();r.executed_steps[1]="checkout-exact-head";assert!(check(&r).is_err());
    }
    #[test] fn host_only_and_parser_only_results_denied() {
        let mut r=synthetic();r.compiled_guest=false;assert!(check(&r).is_err());
        r=synthetic();r.executed_guest_artifact=false;assert!(check(&r).is_err());
    }
    #[test] fn interpreter_or_jit_fallback_denied_in_sealed_profile() {
        let mut r=synthetic();r.host_interpreter_or_jit_fallback=true;assert!(check(&r).is_err());
    }
    #[test] fn missing_allocator_probe_denied() {
        let mut r=synthetic();r.allocator_instrumented=false;assert!(check(&r).is_err());
    }
    #[test] fn missing_and_duplicate_negative_cases_denied() {
        let mut r=synthetic();r.negatives.pop();assert!(check(&r).is_err());
        r=synthetic();let duplicate=r.negatives[1].clone();r.negatives[0]=duplicate;assert!(check(&r).is_err());
    }
    #[test] fn every_negative_requires_real_compiler_rejection_before_ir() {
        for i in 0..NEGATIVE_FEATURES.len() {
            let mut r=synthetic();r.negatives[i].compiler_executed=false;assert!(check(&r).is_err());
            r=synthetic();r.negatives[i].rejected=false;assert!(check(&r).is_err());
            r=synthetic();r.negatives[i].rejection_before_ir=false;assert!(check(&r).is_err());
            r=synthetic();r.negatives[i].stable_diagnostic=false;assert!(check(&r).is_err());
            r=synthetic();r.negatives[i].fixture_sha="bad".into();assert!(check(&r).is_err());
        }
    }
    #[test] fn missing_and_duplicate_positive_cases_denied() {
        let mut r=synthetic();r.positives.pop();assert!(check(&r).is_err());
        r=synthetic();let duplicate=r.positives[1].clone();r.positives[0]=duplicate;assert!(check(&r).is_err());
    }
    #[test] fn every_positive_requires_emitted_and_executed_guest_artifact() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].guest_compiled=false;assert!(check(&r).is_err());
            r=synthetic();r.positives[i].guest_executed=false;assert!(check(&r).is_err());
            r=synthetic();r.positives[i].fixture_sha="bad".into();assert!(check(&r).is_err());
            r=synthetic();r.positives[i].artifact_sha="bad".into();assert!(check(&r).is_err());
        }
    }
    #[test] fn never_treat_synthetic_success_as_release_certification() {
        assert_eq!(check(&synthetic()),Ok(()));
        // check() validates caller-supplied model fields only, not authenticated
        // API data, signed artifacts, compiler output or allocator traces.
        const RELEASE_CERTIFIED: bool = false;
        assert!(!RELEASE_CERTIFIED);
    }
}
