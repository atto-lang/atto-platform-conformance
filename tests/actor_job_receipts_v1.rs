//! Dependency-free reference state machine for actor job admissions and receipts.
//! HOST_MODEL_ONLY: this does not compile/run Atto guests or prove persistence.

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct JobKey {
    namespace: String,
    job_id: String,
}

impl JobKey {
    fn new(namespace: &str, job_id: &str) -> Result<Self, Error> {
        if namespace.is_empty() || job_id.is_empty() ||
            namespace.len() + job_id.len() > 4096 {
            return Err(Error::InvalidKey);
        }
        Ok(Self { namespace: namespace.to_owned(), job_id: job_id.to_owned() })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Actor {
    runtime_epoch: u64,
    slot: u32,
    incarnation: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Reserved, Admitted, Started, Completed, Failed, Rejected, Indeterminate,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Error {
    InvalidKey, Conflict, Full, Missing, ForgedOrStale, WrongPhase,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Reservation {
    New(u64),
    Duplicate(Phase),
}

#[derive(Clone, Debug)]
struct Record {
    target: String,
    payload_fingerprint: u64,
    token: u64,
    owner: Option<Actor>,
    phase: Phase,
}

struct Ledger {
    slots: HashMap<JobKey, Record>,
    capacity: usize,
    next_token: u64,
}

impl Ledger {
    fn new(capacity: usize) -> Self {
        assert!(capacity > 0);
        Self { slots: HashMap::new(), capacity, next_token: 0 }
    }

    fn reserve(&mut self, key: JobKey, target: &str, fingerprint: u64) -> Result<Reservation, Error> {
        if target.is_empty() { return Err(Error::InvalidKey); }
        if let Some(old) = self.slots.get(&key) {
            if old.target != target || old.payload_fingerprint != fingerprint {
                return Err(Error::Conflict);
            }
            return Ok(Reservation::Duplicate(old.phase));
        }
        if self.slots.len() >= self.capacity { return Err(Error::Full); }
        // A real runtime uses an opaque unpredictable token scoped to a registry
        // epoch; this monotonic model token only checks ABA and value equality.
        self.next_token = self.next_token.checked_add(1).ok_or(Error::Full)?;
        let token = self.next_token;
        self.slots.insert(key, Record {
            target: target.to_owned(), payload_fingerprint: fingerprint,
            token, owner: None, phase: Phase::Reserved,
        });
        Ok(Reservation::New(token))
    }

    fn exact(&mut self, key: &JobKey, token: u64, owner: Option<Actor>) -> Result<&mut Record, Error> {
        let r = self.slots.get_mut(key).ok_or(Error::Missing)?;
        if r.token != token || (owner.is_some() && owner != r.owner) {
            return Err(Error::ForgedOrStale);
        }
        Ok(r)
    }

    fn admit(&mut self, key: &JobKey, token: u64, owner: Actor) -> Result<(), Error> {
        let r = self.exact(key, token, None)?;
        if r.phase != Phase::Reserved || r.owner.is_some() {
            return Err(Error::WrongPhase);
        }
        r.owner = Some(owner);
        r.phase = Phase::Admitted;
        Ok(())
    }

    fn start(&mut self, key: &JobKey, token: u64, owner: Actor) -> Result<(), Error> {
        let r = self.exact(key, token, Some(owner))?;
        if r.phase != Phase::Admitted { return Err(Error::WrongPhase); }
        r.phase = Phase::Started;
        Ok(())
    }

    fn complete(&mut self, key: &JobKey, token: u64, owner: Actor) -> Result<(), Error> {
        let r = self.exact(key, token, Some(owner))?;
        if r.phase == Phase::Completed { return Ok(()); } // exact duplicate receipt
        if r.phase != Phase::Started { return Err(Error::WrongPhase); }
        r.phase = Phase::Completed;
        Ok(())
    }

    fn fail(&mut self, key: &JobKey, token: u64, owner: Actor) -> Result<(), Error> {
        let r = self.exact(key, token, Some(owner))?;
        if !matches!(r.phase, Phase::Admitted | Phase::Started) {
            return Err(Error::WrongPhase);
        }
        r.phase = Phase::Failed;
        Ok(())
    }

    fn reject_before_send(&mut self, key: &JobKey, token: u64) -> Result<(), Error> {
        let r = self.exact(key, token, None)?;
        if r.phase != Phase::Reserved { return Err(Error::WrongPhase); }
        r.phase = Phase::Rejected;
        Ok(())
    }

    fn uncertain(&mut self, key: &JobKey, token: u64) -> Result<(), Error> {
        let r = self.exact(key, token, None)?;
        if !matches!(r.phase, Phase::Reserved | Phase::Admitted | Phase::Started) {
            return Err(Error::WrongPhase);
        }
        r.phase = Phase::Indeterminate;
        Ok(())
    }

    fn phase(&self, key: &JobKey) -> Option<Phase> {
        self.slots.get(key).map(|r| r.phase)
    }
}

// Deterministic rendezvous score independent of HashMap randomization. Choosing
// a member is NOT a send or a receipt. An independent host must revalidate
// permissions, liveness and incarnation at mailbox admission.
fn score(key: &JobKey, a: Actor) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in key.namespace.as_bytes().iter().chain(key.job_id.as_bytes())
        .copied().chain(a.runtime_epoch.to_le_bytes()).chain(a.slot.to_le_bytes())
        .chain(a.incarnation.to_le_bytes())
    {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
    }
    hash
}

fn select_one(key: &JobKey, eligible: &[Actor]) -> Option<Actor> {
    eligible.iter().copied()
        .max_by_key(|a| (score(key, *a), *a))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier, Mutex};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;

    fn key(name: &str) -> JobKey { JobKey::new("tenant-a", name).unwrap() }
    fn actor(incarnation: u64) -> Actor {
        Actor { runtime_epoch: 5, slot: 17, incarnation }
    }

    #[test]
    fn one_reservation_for_1024_contenders_on_32_threads() {
        let ledger = Arc::new(Mutex::new(Ledger::new(5)));
        let barrier = Arc::new(Barrier::new(33));
        let created = Arc::new(AtomicUsize::new(0));
        let mut threads = vec![];
        for _ in 0..32 {
            let (l,b,c) = (ledger.clone(),barrier.clone(),created.clone());
            threads.push(thread::spawn(move || {
                b.wait();
                for _ in 0..32 {
                    let result = l.lock().unwrap().reserve(key("invoice-1"), "actor:billing", 42).unwrap();
                    if matches!(result, Reservation::New(_)) {
                        c.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }));
        }
        barrier.wait();
        for t in threads { t.join().unwrap(); }
        assert_eq!(created.load(Ordering::SeqCst), 1);
        assert_eq!(ledger.lock().unwrap().slots.len(), 1);
    }

    #[test]
    fn namespaces_isolate_ids_but_same_namespace_conflicts_fail_closed() {
        let mut l = Ledger::new(2);
        let id = key("1");
        assert!(matches!(l.reserve(id.clone(), "actor:orders", 11), Ok(Reservation::New(_))));
        assert_eq!(l.reserve(id.clone(), "group:orders", 11), Err(Error::Conflict));
        assert_eq!(l.reserve(id, "actor:orders", 12), Err(Error::Conflict));
        let other = JobKey::new("tenant-b", "1").unwrap();
        assert!(matches!(l.reserve(other, "actor:orders", 11), Ok(Reservation::New(_))));
    }

    #[test]
    fn no_false_completion_after_mailbox_admission() {
        let mut l = Ledger::new(1); let id=key("a");
        let Reservation::New(t) = l.reserve(id.clone(), "actor:orders", 1).unwrap() else { panic!() };
        l.admit(&id, t, actor(1)).unwrap();
        assert_eq!(l.phase(&id), Some(Phase::Admitted));
        assert_eq!(l.complete(&id, t, actor(1)), Err(Error::WrongPhase));
        l.start(&id, t, actor(1)).unwrap();
        l.complete(&id, t, actor(1)).unwrap();
        assert_eq!(l.phase(&id), Some(Phase::Completed));
        assert_eq!(l.complete(&id, t, actor(1)), Ok(()));
    }

    #[test]
    fn stale_epoch_generation_and_token_cannot_settle_successor() {
        let mut l = Ledger::new(1);let id=key("a");
        let Reservation::New(t) = l.reserve(id.clone(),"actor:a",1).unwrap() else {panic!()};
        l.admit(&id,t,actor(2)).unwrap();
        assert_eq!(l.start(&id,t,actor(1)),Err(Error::ForgedOrStale));
        assert_eq!(l.start(&id,t+1,actor(2)),Err(Error::ForgedOrStale));
        assert_eq!(l.complete(&id,t,Actor{runtime_epoch:6,..actor(2)}),Err(Error::ForgedOrStale));
        l.start(&id,t,actor(2)).unwrap();
        l.complete(&id,t,actor(2)).unwrap();
    }

    #[test]
    fn uncertain_after_send_forbids_reassignment_even_when_worker_dies() {
        let mut l=Ledger::new(1);let id=key("work");
        let Reservation::New(t)=l.reserve(id.clone(),"group:workers",7).unwrap() else {panic!()};
        l.admit(&id,t,actor(1)).unwrap();
        l.uncertain(&id,t).unwrap();
        assert_eq!(l.phase(&id),Some(Phase::Indeterminate));
        assert_eq!(l.complete(&id,t,actor(1)),Err(Error::WrongPhase));
        assert_eq!(l.admit(&id,t,actor(2)),Err(Error::WrongPhase));
        assert_eq!(l.reserve(id,"group:workers",7),Ok(Reservation::Duplicate(Phase::Indeterminate)));
    }

    #[test]
    fn proven_pre_send_rejection_does_not_claim_admission() {
        let mut l=Ledger::new(1);let id=key("rejected");
        let Reservation::New(t)=l.reserve(id.clone(),"actor:a",7).unwrap() else {panic!()};
        l.reject_before_send(&id,t).unwrap();
        assert_eq!(l.phase(&id),Some(Phase::Rejected));
        assert_eq!(l.admit(&id,t,actor(1)),Err(Error::WrongPhase));
        assert_eq!(l.start(&id,t,actor(1)),Err(Error::ForgedOrStale));
    }

    #[test]
    fn failed_attempt_does_not_automatically_redeliver() {
        let mut l=Ledger::new(1);let id=key("fail");
        let Reservation::New(t)=l.reserve(id.clone(),"actor:a",7).unwrap() else {panic!()};
        l.admit(&id,t,actor(1)).unwrap();
        l.fail(&id,t,actor(1)).unwrap();
        assert_eq!(l.phase(&id),Some(Phase::Failed));
        assert_eq!(l.admit(&id,t,actor(2)),Err(Error::WrongPhase));
    }

    #[test]
    fn bounded_keys_and_capacity_fail_atomically() {
        assert_eq!(JobKey::new("", "a"),Err(Error::InvalidKey));
        assert_eq!(JobKey::new("tenant", ""),Err(Error::InvalidKey));
        assert_eq!(JobKey::new("a", &"z".repeat(4096)),Err(Error::InvalidKey));
        let mut l=Ledger::new(1);
        assert!(l.reserve(key("a"),"actor:a",1).is_ok());
        assert_eq!(l.reserve(key("b"),"actor:b",1),Err(Error::Full));
        assert_eq!(l.slots.len(),1);
    }

    #[test]
    fn groups_choose_exactly_one_member_independent_of_iteration_order() {
        let job=key("stable");
        let a=actor(1);let b=Actor{slot:18,..actor(1)};
        let c=Actor{slot:19,..actor(1)};
        let pick=select_one(&job,&[a,b,c]).unwrap();
        assert_eq!(select_one(&job,&[c,a,b]),Some(pick));
        assert_eq!(select_one(&job,&[]),None);
        let survivors=[a,b,c].into_iter().filter(|member|*member!=pick).collect::<Vec<_>>();
        assert_ne!(select_one(&job,&survivors),Some(pick));
    }

    #[test]
    fn volatile_model_restart_has_no_deduplication_guarantee() {
        let mut l=Ledger::new(1);let id=key("a");
        assert!(matches!(l.reserve(id.clone(),"actor:a",1),Ok(Reservation::New(_))));
        let mut fresh_process=Ledger::new(1);
        assert!(matches!(fresh_process.reserve(id,"actor:a",1),Ok(Reservation::New(_))));
        // This is precisely why a durable WAL/transactional ledger is required.
    }

    #[test]
    fn distinct_jobs_compete_for_fixed_quota_without_over_admission() {
        let ledger=Arc::new(Mutex::new(Ledger::new(128)));
        let barrier=Arc::new(Barrier::new(17));
        let accepted=Arc::new(AtomicUsize::new(0));
        let mut workers=vec![];
        for worker in 0..16 {
            let (l,b,ok)=(ledger.clone(),barrier.clone(),accepted.clone());
            workers.push(thread::spawn(move||{
                b.wait();
                for n in 0..32 {
                    let id=key(&format!("worker-{worker}-job-{n}"));
                    let result=l.lock().unwrap().reserve(id,"actor:billing",42);
                    match result {
                        Ok(Reservation::New(_))=>{ok.fetch_add(1,Ordering::SeqCst);},
                        Err(Error::Full)=>{},
                        other=>panic!("unexpected capacity outcome: {other:?}")
                    }
                }
            }));
        }
        barrier.wait();
        for t in workers {t.join().unwrap();}
        assert_eq!(accepted.load(Ordering::SeqCst),128);
        assert_eq!(ledger.lock().unwrap().slots.len(),128);
    }

    #[test]
    fn competing_payloads_cannot_both_reserve_same_job_identity() {
        let ledger=Arc::new(Mutex::new(Ledger::new(1)));
        let barrier=Arc::new(Barrier::new(33));
        let mut workers=vec![];
        for i in 0..32 {
            let (l,b)=(ledger.clone(),barrier.clone());
            workers.push(thread::spawn(move||{
                b.wait();
                l.lock().unwrap().reserve(key("conflict"),"actor:billing",i)
            }));
        }
        barrier.wait();
        let outcomes:Vec<_>=workers.into_iter().map(|w|w.join().unwrap()).collect();
        assert_eq!(outcomes.iter().filter(|x|matches!(x,Ok(Reservation::New(_)))).count(),1);
        assert_eq!(outcomes.iter().filter(|x|matches!(x,Err(Error::Conflict))).count(),31);
        assert_eq!(ledger.lock().unwrap().slots.len(),1);
    }

    #[test]
    fn exact_id_bytes_distinguish_unicode_separator_and_nul_keys() {
        let mut l=Ledger::new(8);
        for id in ["a:b","a\0b","a","e\u{301}","\u{e9}","\u{1f680}"] {
            assert!(matches!(l.reserve(key(id),"actor:billing",11),Ok(Reservation::New(_))));
        }
        assert_eq!(l.slots.len(),6);
        assert_ne!(key("e\u{301}"),key("\u{e9}"));
        assert_eq!(JobKey::new("tenant","a:b").unwrap().job_id,"a:b");
    }

    #[test]
    fn rejected_identity_is_retained_and_cannot_be_conflicted_or_reused() {
        let mut l=Ledger::new(1);let id=key("denied");
        let Reservation::New(token)=l.reserve(id.clone(),"actor:jobs",1).unwrap() else {panic!()};
        l.reject_before_send(&id,token).unwrap();
        assert_eq!(l.reserve(id.clone(),"actor:jobs",1),Ok(Reservation::Duplicate(Phase::Rejected)));
        assert_eq!(l.reserve(id,"actor:jobs",2),Err(Error::Conflict));
        assert_eq!(l.slots.len(),1);
    }

    #[test]
    fn terminal_receipts_cannot_be_mutated_to_another_terminal_outcome() {
        let mut l=Ledger::new(2);let id=key("done");
        let Reservation::New(token)=l.reserve(id.clone(),"actor:jobs",1).unwrap() else {panic!()};
        l.admit(&id,token,actor(1)).unwrap();
        l.start(&id,token,actor(1)).unwrap();
        l.complete(&id,token,actor(1)).unwrap();
        assert_eq!(l.fail(&id,token,actor(1)),Err(Error::WrongPhase));
        assert_eq!(l.uncertain(&id,token),Err(Error::WrongPhase));
        assert_eq!(l.reject_before_send(&id,token),Err(Error::WrongPhase));
        assert_eq!(l.phase(&id),Some(Phase::Completed));
    }

    #[test]
    fn terminal_failure_cannot_be_completed_or_reopened() {
        let mut l=Ledger::new(1);let id=key("fail-terminal");
        let Reservation::New(token)=l.reserve(id.clone(),"actor:jobs",1).unwrap() else {panic!()};
        l.admit(&id,token,actor(1)).unwrap();
        l.start(&id,token,actor(1)).unwrap();
        l.fail(&id,token,actor(1)).unwrap();
        assert_eq!(l.complete(&id,token,actor(1)),Err(Error::WrongPhase));
        assert_eq!(l.start(&id,token,actor(1)),Err(Error::WrongPhase));
        assert_eq!(l.fail(&id,token,actor(1)),Err(Error::WrongPhase));
    }

    #[test]
    fn uncertainty_before_confirmed_admission_never_permits_blind_send() {
        let mut l=Ledger::new(1);let id=key("pre-admission");
        let Reservation::New(token)=l.reserve(id.clone(),"group:workers",1).unwrap() else {panic!()};
        l.uncertain(&id,token).unwrap();
        assert_eq!(l.admit(&id,token,actor(1)),Err(Error::WrongPhase));
        assert_eq!(l.reject_before_send(&id,token),Err(Error::WrongPhase));
        assert_eq!(l.phase(&id),Some(Phase::Indeterminate));
    }

    #[test]
    fn uncertainty_after_handler_start_never_accepts_late_completion() {
        let mut l=Ledger::new(1);let id=key("started-crash");
        let Reservation::New(token)=l.reserve(id.clone(),"actor:billing",1).unwrap() else {panic!()};
        l.admit(&id,token,actor(1)).unwrap();
        l.start(&id,token,actor(1)).unwrap();
        l.uncertain(&id,token).unwrap();
        assert_eq!(l.complete(&id,token,actor(1)),Err(Error::WrongPhase));
        assert_eq!(l.admit(&id,token,actor(2)),Err(Error::WrongPhase));
        assert_eq!(l.phase(&id),Some(Phase::Indeterminate));
    }

    #[test]
    fn different_key_receipt_tokens_cannot_settle_another_job() {
        let mut l=Ledger::new(2);let a=key("a");let b=key("b");
        let Reservation::New(ta)=l.reserve(a.clone(),"actor:jobs",1).unwrap() else {panic!()};
        let Reservation::New(tb)=l.reserve(b.clone(),"actor:jobs",1).unwrap() else {panic!()};
        assert_ne!(ta,tb);
        l.admit(&a,ta,actor(1)).unwrap();
        l.admit(&b,tb,actor(1)).unwrap();
        assert_eq!(l.start(&a,tb,actor(1)),Err(Error::ForgedOrStale));
        assert_eq!(l.start(&b,ta,actor(1)),Err(Error::ForgedOrStale));
        assert_eq!(l.phase(&a),Some(Phase::Admitted));
        assert_eq!(l.phase(&b),Some(Phase::Admitted));
    }

    #[test]
    fn forged_actor_slot_cannot_claim_correct_generation_receipt() {
        let mut l=Ledger::new(1);let id=key("a");
        let Reservation::New(token)=l.reserve(id.clone(),"actor:a",1).unwrap() else {panic!()};
        l.admit(&id,token,actor(1)).unwrap();
        let alien=Actor{slot:18,..actor(1)};
        assert_eq!(l.start(&id,token,alien),Err(Error::ForgedOrStale));
        l.start(&id,token,actor(1)).unwrap();
        assert_eq!(l.complete(&id,token,alien),Err(Error::ForgedOrStale));
    }

    #[test]
    fn reservation_tokens_advance_and_cannot_wrap_on_overflow() {
        let mut l=Ledger::new(3);
        let Reservation::New(first)=l.reserve(key("one"),"actor:jobs",1).unwrap() else {panic!()};
        let Reservation::New(second)=l.reserve(key("two"),"actor:jobs",1).unwrap() else {panic!()};
        assert!(second>first);
        l.next_token=u64::MAX;
        assert_eq!(l.reserve(key("three"),"actor:jobs",1),Err(Error::Full));
        assert_eq!(l.slots.len(),2);
        assert_eq!(l.reserve(key("one"),"actor:jobs",1),Ok(Reservation::Duplicate(Phase::Reserved)));
    }

    #[test]
    fn missing_receipt_operations_cannot_allocate_phantom_jobs() {
        let mut l=Ledger::new(1);let id=key("phantom");
        assert_eq!(l.phase(&id),None);
        assert_eq!(l.admit(&id,1,actor(1)),Err(Error::Missing));
        assert_eq!(l.start(&id,1,actor(1)),Err(Error::Missing));
        assert_eq!(l.complete(&id,1,actor(1)),Err(Error::Missing));
        assert_eq!(l.fail(&id,1,actor(1)),Err(Error::Missing));
        assert_eq!(l.uncertain(&id,1),Err(Error::Missing));
        assert_eq!(l.reject_before_send(&id,1),Err(Error::Missing));
        assert_eq!(l.slots.len(),0);
    }

    #[test]
    fn even_after_completion_bounded_volatile_ledger_keeps_dedup_identity() {
        let mut l=Ledger::new(1);let id=key("terminal");
        let Reservation::New(token)=l.reserve(id.clone(),"actor:jobs",1).unwrap() else {panic!()};
        l.admit(&id,token,actor(1)).unwrap();
        l.start(&id,token,actor(1)).unwrap();
        l.complete(&id,token,actor(1)).unwrap();
        assert_eq!(l.reserve(id,"actor:jobs",1),Ok(Reservation::Duplicate(Phase::Completed)));
        assert_eq!(l.reserve(key("other"),"actor:jobs",1),Err(Error::Full));
    }

    #[test]
    fn different_tenants_have_independent_receipts_with_identical_job_ids() {
        let mut l=Ledger::new(2);
        let a=JobKey::new("a","shared").unwrap();
        let b=JobKey::new("b","shared").unwrap();
        let Reservation::New(ta)=l.reserve(a.clone(),"actor:jobs",42).unwrap() else {panic!()};
        let Reservation::New(tb)=l.reserve(b.clone(),"actor:jobs",42).unwrap() else {panic!()};
        assert_ne!(ta,tb);
        l.admit(&a,ta,actor(1)).unwrap();
        l.admit(&b,tb,actor(1)).unwrap();
        l.start(&a,ta,actor(1)).unwrap();
        assert_eq!(l.phase(&b),Some(Phase::Admitted));
        assert_eq!(l.complete(&b,ta,actor(1)),Err(Error::ForgedOrStale));
    }

    #[test]
    fn group_placement_is_order_independent_for_1024_distinct_jobs() {
        let members:Vec<Actor>=(0..32).map(|slot|Actor{
            runtime_epoch:7,slot,incarnation:1
        }).collect();
        let mut reversed=members.clone();reversed.reverse();
        for i in 0..1024 {
            let id=key(&format!("job-{i}"));
            let winner=select_one(&id,&members).unwrap();
            assert!(members.contains(&winner));
            assert_eq!(select_one(&id,&reversed),Some(winner));
        }
        assert_eq!(select_one(&key("job"),&[]),None);
    }

    #[test]
    fn terminal_receipt_cannot_be_replayed_into_new_registry_epoch() {
        let mut old=Ledger::new(1);let id=key("restart");
        let Reservation::New(token)=old.reserve(id.clone(),"actor:jobs",1).unwrap() else {panic!()};
        old.admit(&id,token,actor(1)).unwrap();
        old.start(&id,token,actor(1)).unwrap();
        old.complete(&id,token,actor(1)).unwrap();
        let mut next=Ledger::new(1);
        let Reservation::New(new_token)=next.reserve(id.clone(),"actor:jobs",1).unwrap() else {panic!()};
        // The toy volatile model deliberately reuses token 1 after restart.
        // A real receipt must bind registry epoch in its opaque authority.
        assert_eq!(token,new_token);
        let replacement=Actor{runtime_epoch:6,..actor(1)};
        next.admit(&id,new_token,replacement).unwrap();
        assert_eq!(next.start(&id,token,actor(1)),Err(Error::ForgedOrStale));
        assert_eq!(next.complete(&id,token,actor(1)),Err(Error::ForgedOrStale));
    }

}
