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
}
