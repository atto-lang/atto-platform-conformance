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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ReviewDecision { Approved, ChangesRequested, Dismissed, Pending }
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RunEvent { PullRequest, ManualDispatch }
#[derive(Clone, Debug)]
struct StepEvidence {
    number: u32, name: &'static str, status: &'static str,
    conclusion: &'static str, job_id: u64, attempt: u64,
    log_recorded: bool,
}
#[derive(Clone, Debug)]
struct NegativeCase {
    feature: NegativeFeature,
    fixture_sha: String,
    compiler_sha: String,
    job_id: u64,
    run_attempt: u64,
    compiler_executed: bool,
    rejected: bool,
    rejection_before_ir: bool,
    stable_diagnostic: bool,
}
#[derive(Clone, Debug)]
struct PositiveCase {
    feature: PositiveFeature,
    fixture_sha: String,
    compiler_sha: String,
    job_id: u64,
    run_attempt: u64,
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
    review_decision: ReviewDecision,
    reviewed_head: String,
    artifact_bound_to_head: bool,
    runner_id: u64,
    run_attempt: u64,
    run_id: u64,
    job_id: u64,
    job_run_id: u64,
    job_attempt: u64,
    run_head: String,
    job_head: String,
    run_event: RunEvent,
    checkout_head: String,
    checkout_tree: String,
    checkout_job_id: u64,
    checkout_step_number: u32,
    run_completed_successfully: bool,
    job_completed_successfully: bool,
    executed_steps: Vec<&'static str>,
    step_records: Vec<StepEvidence>,
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
    if r.review_decision != ReviewDecision::Approved || r.reviewed_head != r.expected_head
    { return Err("stale, unapproved or revoked exact-head review"); }
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
    if r.run_id == 0 || r.job_id == 0 || r.job_run_id != r.run_id
        || r.job_attempt != r.run_attempt || !valid_sha(&r.run_head, 40)
        || r.job_head != r.run_head || r.checkout_head != r.expected_head
        || r.checkout_tree != r.expected_tree || r.checkout_job_id != r.job_id
        || (r.run_event == RunEvent::PullRequest && r.run_head != r.expected_head)
    { return Err("run, job, event, checkout or attempt not bound to exact head"); }
    if r.executed_steps.len() < 4 { return Err("required named steps absent"); }
    for required in ["checkout-exact-head", "compile-guest", "execute-guest", "allocator-probe"] {
        if r.executed_steps.iter().filter(|s| **s == required).count() != 1 {
            return Err("missing or duplicated required step");
        }
    }
    if r.step_records.len() != r.executed_steps.len() {
        return Err("step metadata does not match named steps");
    }
    let mut step_numbers = std::collections::BTreeSet::new();
    let mut previous_step_number = 0;
    for (i, step) in r.step_records.iter().enumerate() {
        if step.name != r.executed_steps[i] || step.number <= previous_step_number
            || !step_numbers.insert(step.number) || step.job_id != r.job_id
            || step.attempt != r.run_attempt || step.status != "completed"
            || step.conclusion != "success" || !step.log_recorded {
            return Err("replayed, failed, ambiguous or unlogged step");
        }
        previous_step_number = step.number;
    }
    let mut last_required_step_number = 0;
    for name in ["checkout-exact-head", "compile-guest", "execute-guest", "allocator-probe"] {
        let step = r.step_records.iter().find(|step| step.name == name)
            .ok_or("required step has no executed record")?;
        if step.number <= last_required_step_number {
            return Err("required checkout/compile/execute/probe order violated");
        }
        last_required_step_number = step.number;
    }
    if !r.step_records.iter().any(|step| step.name == "checkout-exact-head"
        && step.number == r.checkout_step_number) {
        return Err("checkout proof missing from executed job");
    }
    if !r.compiled_guest || !r.executed_guest_artifact || r.host_interpreter_or_jit_fallback
        || !r.allocator_instrumented
    { return Err("guest AOT execution or allocator proof absent"); }
    if r.negatives.len() != NEGATIVE_FEATURES.len() { return Err("negative matrix incomplete"); }
    let mut seen_negative = std::collections::BTreeSet::new();
    let mut seen_fixtures = std::collections::BTreeSet::new();
    for case in &r.negatives {
        if !NEGATIVE_FEATURES.contains(&case.feature) || !seen_negative.insert(case.feature)
            || !valid_sha(&case.fixture_sha, 64)
            || !seen_fixtures.insert(case.fixture_sha.as_str())
            || case.compiler_sha != r.compiler_sha || case.job_id != r.job_id
            || case.run_attempt != r.run_attempt || !case.compiler_executed
            || !case.rejected || !case.rejection_before_ir || !case.stable_diagnostic
        { return Err("negative fixture missing, repeated, or not rejected before IR"); }
    }
    if r.positives.len() != POSITIVE_FEATURES.len() { return Err("positive matrix incomplete"); }
    let mut seen_positive = std::collections::BTreeSet::new();
    let mut main_artifact_referenced = false;
    for case in &r.positives {
        if !POSITIVE_FEATURES.contains(&case.feature) || !seen_positive.insert(case.feature)
            || !valid_sha(&case.fixture_sha, 64)
            || !seen_fixtures.insert(case.fixture_sha.as_str())
            || !valid_sha(&case.artifact_sha, 64)
            || case.compiler_sha != r.compiler_sha || case.job_id != r.job_id
            || case.run_attempt != r.run_attempt || !case.guest_compiled || !case.guest_executed
        { return Err("positive guest fixture missing, repeated, or not executed"); }
        main_artifact_referenced |= case.artifact_sha == r.artifact_sha;
    }
    if !main_artifact_referenced {
        return Err("top-level artifact absent from positive-case manifest");
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
            expected_head: a.clone(), observed_head: a.clone(),
            expected_tree: b.clone(), observed_tree: b.clone(),
            compiler_sha: c.clone(), artifact_sha: d.clone(),
            source_repository_id: 17, runner_repository_id: 17,
            author_id: 9, reviewer_id: 10,
            branch_protected: true, workflow_trusted: true,
            independently_approved: true,
            review_decision: ReviewDecision::Approved, reviewed_head: a.clone(),
            artifact_bound_to_head: true,
            runner_id: 74, run_attempt: 2,
            run_id: 501, job_id: 502, job_run_id: 501, job_attempt: 2,
            run_head: a.clone(), job_head: a.clone(),
            run_event: RunEvent::PullRequest,
            checkout_head: a.clone(), checkout_tree: b.clone(),
            checkout_job_id: 502, checkout_step_number: 1,
            run_completed_successfully: true, job_completed_successfully: true,
            executed_steps: vec!["checkout-exact-head", "compile-guest", "execute-guest", "allocator-probe"],
            step_records: ["checkout-exact-head", "compile-guest", "execute-guest", "allocator-probe"]
                .iter().enumerate().map(|(i, &name)| StepEvidence {
                    number: (i + 1) as u32, name, status: "completed",
                    conclusion: "success", job_id: 502, attempt: 2,
                    log_recorded: true,
                }).collect(),
            compiled_guest: true, executed_guest_artifact: true,
            host_interpreter_or_jit_fallback: false,
            allocator_instrumented: true, process_gc_instrumented: false,
            negatives: NEGATIVE_FEATURES.iter().enumerate().map(|(i, &feature)| NegativeCase {
                feature, fixture_sha: format!("{:064x}", i + 1),
                compiler_sha: c.clone(), job_id: 502, run_attempt: 2,
                compiler_executed: true,
                rejected: true, rejection_before_ir: true, stable_diagnostic: true,
            }).collect(),
            positives: POSITIVE_FEATURES.iter().enumerate().map(|(i, &feature)| PositiveCase {
                feature, fixture_sha: format!("{:064x}", i + 101),
                compiler_sha: c.clone(), job_id: 502, run_attempt: 2,
                artifact_sha: d.clone(),
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
    #[test] fn exact_head_review_does_not_replay_across_commits() {
        let mut r=synthetic();r.reviewed_head="e".repeat(40);assert!(check(&r).is_err());
    }
    #[test] fn dismissed_changes_requested_and_pending_review_not_approved() {
        for decision in [ReviewDecision::Dismissed, ReviewDecision::ChangesRequested, ReviewDecision::Pending] {
            let mut r=synthetic();r.review_decision=decision;assert!(check(&r).is_err());
        }
    }
    #[test] fn run_job_identity_and_attempt_fencing() {
        let mut r=synthetic();r.run_id=0;assert!(check(&r).is_err());
        r=synthetic();r.job_id=0;assert!(check(&r).is_err());
        r=synthetic();r.job_run_id+=1;assert!(check(&r).is_err());
        r=synthetic();r.job_attempt=1;assert!(check(&r).is_err());
    }
    #[test] fn stale_job_head_and_pull_request_run_head_denied() {
        let mut r=synthetic();r.job_head="e".repeat(40);assert!(check(&r).is_err());
        r=synthetic();r.run_head="e".repeat(40);assert!(check(&r).is_err());
    }
    #[test] fn manual_dispatch_uses_independent_exact_checkout_receipt() {
        let mut r=synthetic();r.run_event=RunEvent::ManualDispatch;r.run_head="e".repeat(40);
        r.job_head=r.run_head.clone();assert_eq!(check(&r),Ok(()));
        r.checkout_head="e".repeat(40);assert!(check(&r).is_err());
        r=synthetic();r.run_event=RunEvent::ManualDispatch;
        r.checkout_tree="e".repeat(40);assert!(check(&r).is_err());
    }
    #[test] fn checkout_job_and_step_bound_to_executed_job() {
        let mut r=synthetic();r.checkout_job_id=3;assert!(check(&r).is_err());
        r=synthetic();r.checkout_step_number=99;assert!(check(&r).is_err());
    }
    #[test] fn missing_partial_and_replayed_step_records_denied() {
        let mut r=synthetic();r.step_records.clear();assert!(check(&r).is_err());
        r=synthetic();r.step_records.pop();assert!(check(&r).is_err());
        r=synthetic();r.step_records[0].attempt=1;assert!(check(&r).is_err());
        r=synthetic();r.step_records[1].job_id=999;assert!(check(&r).is_err());
    }
    #[test] fn failed_cancelled_skipped_and_nonterminal_steps_denied() {
        for conclusion in ["failure","cancelled","skipped","neutral","timed_out"] {
            let mut r=synthetic();r.step_records[2].conclusion=conclusion;assert!(check(&r).is_err());
        }
        let mut r=synthetic();r.step_records[1].status="in_progress";assert!(check(&r).is_err());
    }
    #[test] fn duplicate_unnumbered_misordered_or_spliced_steps_denied() {
        let mut r=synthetic();r.step_records[0].number=0;assert!(check(&r).is_err());
        r=synthetic();r.step_records[2].number=2;assert!(check(&r).is_err());
        r=synthetic();r.step_records.swap(1,2);assert!(check(&r).is_err());
        r=synthetic();r.step_records[1].name="execute-guest";assert!(check(&r).is_err());
    }
    #[test] fn missing_step_logs_cannot_prove_guest_execution() {
        for i in 0..4 {
            let mut r=synthetic();r.step_records[i].log_recorded=false;
            assert!(check(&r).is_err(),"step {i}");
        }
    }
    #[test] fn duplicated_fixture_sha_cannot_fake_case_coverage() {
        let mut r=synthetic();r.negatives[1].fixture_sha=r.negatives[0].fixture_sha.clone();
        assert!(check(&r).is_err());
        r=synthetic();r.positives[1].fixture_sha=r.positives[0].fixture_sha.clone();
        assert!(check(&r).is_err());
        r=synthetic();r.positives[0].fixture_sha=r.negatives[0].fixture_sha.clone();
        assert!(check(&r).is_err());
    }
    #[test] fn fixture_permutations_remain_valid_with_unique_identity() {
        let mut r=synthetic();r.negatives.reverse();r.positives.reverse();
        assert_eq!(check(&r),Ok(()));
    }
    #[test] fn padding_step_names_without_real_step_records_denied() {
        let mut r=synthetic();r.executed_steps.push("unrelated");assert!(check(&r).is_err());
        r=synthetic();r.step_records.push(StepEvidence {
            number:5,name:"unrelated",status:"completed",conclusion:"success",
            job_id:502,attempt:2,log_recorded:true,
        });assert!(check(&r).is_err());
    }
    #[test] fn rejects_negative_fixture_compiler_splicing() {
        for i in 0..NEGATIVE_FEATURES.len() {
            let mut r=synthetic();r.negatives[i].compiler_sha="e".repeat(64);
            assert_eq!(check(&r),Err("negative fixture missing, repeated, or not rejected before IR"));
        }
    }
    #[test] fn rejects_positive_fixture_compiler_splicing() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].compiler_sha="e".repeat(64);
            assert_eq!(check(&r),Err("positive guest fixture missing, repeated, or not executed"));
        }
    }
    #[test] fn rejects_negative_cases_with_foreign_job_id() {
        for i in 0..NEGATIVE_FEATURES.len() {
            let mut r=synthetic();r.negatives[i].job_id=999;
            assert!(check(&r).is_err(),"negative case {i}");
        }
    }
    #[test] fn rejects_positive_cases_with_foreign_job_id() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].job_id=999;
            assert!(check(&r).is_err(),"positive case {i}");
        }
    }
    #[test] fn rejects_negative_case_replay_from_older_attempt() {
        for i in 0..NEGATIVE_FEATURES.len() {
            let mut r=synthetic();r.negatives[i].run_attempt=1;
            assert!(check(&r).is_err(),"negative case {i}");
        }
    }
    #[test] fn rejects_positive_case_replay_from_older_attempt() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].run_attempt=1;
            assert!(check(&r).is_err(),"positive case {i}");
        }
    }
    #[test] fn rejects_backwards_step_numbers_with_matching_names() {
        let mut r=synthetic();r.step_records[1].number=4;
        r.step_records[2].number=2;r.step_records[3].number=3;
        assert!(check(&r).is_err());
    }
    #[test] fn rejects_wrong_execution_order_despite_increasing_numbers() {
        let mut r=synthetic();r.executed_steps.swap(1,2);r.step_records.swap(1,2);
        r.step_records[1].number=2;r.step_records[2].number=3;
        assert_eq!(check(&r),Err("required checkout/compile/execute/probe order violated"));
    }
    #[test] fn accepts_nonconsecutive_monotonic_step_numbers() {
        let mut r=synthetic();
        for (step, number) in r.step_records.iter_mut().zip([3,5,9,11]) {
            step.number=number;
        }
        r.checkout_step_number=3;
        assert_eq!(check(&r),Ok(()));
    }
    #[test] fn rejects_unreferenced_main_artifact() {
        let mut r=synthetic();r.artifact_sha="e".repeat(64);
        assert_eq!(check(&r),Err("top-level artifact absent from positive-case manifest"));
    }
    #[test] fn accepts_distinct_positive_artifacts_when_main_is_present() {
        let mut r=synthetic();r.positives[0].artifact_sha="e".repeat(64);
        assert_eq!(check(&r),Ok(()));
        for case in r.positives.iter_mut().skip(1) {
            case.artifact_sha="f".repeat(64);
        }
        assert_eq!(check(&r),Err("top-level artifact absent from positive-case manifest"));
    }
    #[test] fn rejects_parent_compiler_changed_without_case_recompilation() {
        let mut r=synthetic();r.compiler_sha="e".repeat(64);
        assert_eq!(check(&r),Err("negative fixture missing, repeated, or not rejected before IR"));
    }
    #[test] fn accepts_same_compiler_and_attempt_across_all_distinct_fixtures() {
        let r=synthetic();
        assert!(r.negatives.iter().all(|c| c.compiler_sha==r.compiler_sha &&
            c.job_id==r.job_id && c.run_attempt==r.run_attempt));
        assert!(r.positives.iter().all(|c| c.compiler_sha==r.compiler_sha &&
            c.job_id==r.job_id && c.run_attempt==r.run_attempt));
        assert_eq!(check(&r),Ok(()));
    }
    #[test] fn every_negative_fixture_rejects_all_zero_hash() {
        for i in 0..NEGATIVE_FEATURES.len() {
            let mut r=synthetic();r.negatives[i].fixture_sha="0".repeat(64);
            assert!(check(&r).is_err(),"negative case {i}");
        }
    }
    #[test] fn every_negative_fixture_rejects_uppercase_hash() {
        for i in 0..NEGATIVE_FEATURES.len() {
            let mut r=synthetic();r.negatives[i].fixture_sha="A".repeat(64);
            assert!(check(&r).is_err(),"negative case {i}");
        }
    }
    #[test] fn every_negative_fixture_rejects_truncated_hash() {
        for i in 0..NEGATIVE_FEATURES.len() {
            let mut r=synthetic();r.negatives[i].fixture_sha="a".repeat(63);
            assert!(check(&r).is_err(),"negative case {i}");
        }
    }
    #[test] fn every_positive_fixture_rejects_all_zero_hash() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].fixture_sha="0".repeat(64);
            assert!(check(&r).is_err(),"positive case {i}");
        }
    }
    #[test] fn every_positive_fixture_rejects_uppercase_hash() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].fixture_sha="A".repeat(64);
            assert!(check(&r).is_err(),"positive case {i}");
        }
    }
    #[test] fn every_positive_fixture_rejects_truncated_hash() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].fixture_sha="a".repeat(63);
            assert!(check(&r).is_err(),"positive case {i}");
        }
    }
    #[test] fn every_positive_artifact_rejects_all_zero_hash() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].artifact_sha="0".repeat(64);
            assert!(check(&r).is_err(),"positive artifact {i}");
        }
    }
    #[test] fn every_positive_artifact_rejects_uppercase_hash() {
        for i in 0..POSITIVE_FEATURES.len() {
            let mut r=synthetic();r.positives[i].artifact_sha="A".repeat(64);
            assert!(check(&r).is_err(),"positive artifact {i}");
        }
    }
}
