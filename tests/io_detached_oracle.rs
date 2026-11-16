//! Rust-only model of supervised detached I/O lifecycle. This is not an
//! AttoLang compiler-backed guest runtime or proof of concurrent linearizability.
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind { Read, Write }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Callback { None, SuccessOnly, Outcome }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Terminal { Admitted, ReadValue, Eof, Error, Cancelled }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AdmissionError { CreditsExhausted, OwnerStopped, ReadNeedsConsumer }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FinishError { Unknown, AlreadyFinished }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Notice { CallbackSuccess, CallbackOutcome(Terminal), Supervisor(Terminal) }

struct Ticket {
    owner: u64,
    kind: Kind,
    callback: Callback,
    terminal: Option<Terminal>,
    /// A payload remains owned by its pending ticket until successful write admission.
    payload: Option<String>,
}
struct Scheduler {
    bound: usize,
    pending: usize,
    next_id: u64,
    stopped: BTreeSet<u64>,
    tickets: BTreeMap<u64, Ticket>,
    events: Vec<(u64, Notice)>,
    delivered: Vec<String>,
}
impl Scheduler {
    fn new(bound: usize) -> Self {
        Self { bound, pending: 0, next_id: 0, stopped: BTreeSet::new(),
               tickets: BTreeMap::new(), events: Vec::new(), delivered: Vec::new() }
    }
    fn submit(&mut self, owner: u64, kind: Kind, callback: Callback, payload: Option<String>)
        -> Result<u64, (AdmissionError, Option<String>)>
    {
        if self.stopped.contains(&owner) { return Err((AdmissionError::OwnerStopped, payload)); }
        if kind == Kind::Read && callback != Callback::Outcome {
            return Err((AdmissionError::ReadNeedsConsumer, payload));
        }
        if self.pending >= self.bound { return Err((AdmissionError::CreditsExhausted, payload)); }
        let id = self.next_id;
        self.next_id += 1;
        self.pending += 1;
        self.tickets.insert(id, Ticket { owner, kind, callback, terminal: None, payload });
        Ok(id)
    }
    fn finish(&mut self, id: u64, terminal: Terminal) -> Result<(), FinishError> {
        let (owner, callback, kind, payload) = {
            let ticket = self.tickets.get_mut(&id).ok_or(FinishError::Unknown)?;
            if ticket.terminal.is_some() { return Err(FinishError::AlreadyFinished); }
            ticket.terminal = Some(terminal);
            // Ownership transfers only on an admitted write. Error/close/cancel
            // retains the original payload in the ticket for explicit reclamation.
            let payload = if terminal == Terminal::Admitted && ticket.kind == Kind::Write {
                ticket.payload.take()
            } else { None };
            (ticket.owner, ticket.callback, ticket.kind, payload)
        };
        self.pending -= 1;
        if let Some(value) = payload { self.delivered.push(value); }
        if self.stopped.contains(&owner) {
            // Owner is gone; callbacks must never run in a destroyed actor.
            self.events.push((id, Notice::Supervisor(Terminal::Cancelled)));
            return Ok(());
        }
        let notification = match (kind, callback, terminal) {
            (Kind::Write, Callback::SuccessOnly, Terminal::Admitted) =>
                Some(Notice::CallbackSuccess),
            (_, Callback::Outcome, _) => Some(Notice::CallbackOutcome(terminal)),
            (_, _, Terminal::Error | Terminal::Cancelled | Terminal::Eof) =>
                Some(Notice::Supervisor(terminal)),
            _ => None,
        };
        if let Some(n) = notification { self.events.push((id, n)); }
        Ok(())
    }
    fn stop(&mut self, owner: u64) {
        self.stopped.insert(owner);
        let waiting: Vec<u64> = self.tickets.iter()
            .filter_map(|(id,t)| (t.owner == owner && t.terminal.is_none()).then_some(*id))
            .collect();
        for id in waiting {
            self.finish(id, Terminal::Cancelled).unwrap();
        }
    }
}

#[test]
fn detached_write_enqueues_and_does_not_publish_until_admission() {
    let mut s = Scheduler::new(1);
    let id = s.submit(1,Kind::Write,Callback::None,Some("hi".into())).unwrap();
    assert!(s.delivered.is_empty());
    assert_eq!(s.pending,1);
    s.finish(id,Terminal::Admitted).unwrap();
    assert_eq!(s.delivered,vec!["hi"]);
    assert_eq!(s.pending,0);
}
#[test]
fn capacity_exhaustion_never_consumes_payload_or_blocks_for_credit() {
    let mut s = Scheduler::new(0);
    assert_eq!(s.submit(1,Kind::Write,Callback::None,Some("owned".into())),
        Err((AdmissionError::CreditsExhausted,Some("owned".into()))));
    assert!(s.tickets.is_empty());
}
#[test]
fn zero_argument_callback_runs_once_on_success_only() {
    let mut s = Scheduler::new(2);
    let id = s.submit(1,Kind::Write,Callback::SuccessOnly,Some("x".into())).unwrap();
    s.finish(id,Terminal::Admitted).unwrap();
    assert_eq!(s.finish(id,Terminal::Admitted),Err(FinishError::AlreadyFinished));
    assert_eq!(s.events,vec![(id,Notice::CallbackSuccess)]);
    assert_eq!(s.delivered.len(),1);
}
#[test]
fn zero_argument_write_callback_errors_route_to_supervisor() {
    let mut s = Scheduler::new(2);
    let id = s.submit(1,Kind::Write,Callback::SuccessOnly,Some("x".into())).unwrap();
    s.finish(id,Terminal::Error).unwrap();
    assert_eq!(s.events,vec![(id,Notice::Supervisor(Terminal::Error))]);
    assert!(s.delivered.is_empty());
    assert_eq!(s.tickets[&id].payload.as_deref(),Some("x"));
}
#[test]
fn detached_write_without_callback_escalates_failure() {
    let mut s = Scheduler::new(1);
    let id = s.submit(1,Kind::Write,Callback::None,Some("hi".into())).unwrap();
    s.finish(id,Terminal::Error).unwrap();
    assert_eq!(s.events,vec![(id,Notice::Supervisor(Terminal::Error))]);
}
#[test]
fn read_requires_typed_outcome_callback_or_rejects_admission() {
    let mut s = Scheduler::new(1);
    assert_eq!(s.submit(1,Kind::Read,Callback::None,None),
        Err((AdmissionError::ReadNeedsConsumer,None)));
    assert_eq!(s.submit(1,Kind::Read,Callback::SuccessOnly,None),
        Err((AdmissionError::ReadNeedsConsumer,None)));
    let id = s.submit(1,Kind::Read,Callback::Outcome,None).unwrap();
    s.finish(id,Terminal::ReadValue).unwrap();
    assert_eq!(s.events,vec![(id,Notice::CallbackOutcome(Terminal::ReadValue))]);
}
#[test]
fn typed_read_outcome_reports_eof_and_failure_not_fake_data() {
    let mut s = Scheduler::new(2);
    let a = s.submit(1,Kind::Read,Callback::Outcome,None).unwrap();
    let b = s.submit(1,Kind::Read,Callback::Outcome,None).unwrap();
    s.finish(a,Terminal::Eof).unwrap();
    s.finish(b,Terminal::Error).unwrap();
    assert_eq!(s.events,vec![
        (a,Notice::CallbackOutcome(Terminal::Eof)),
        (b,Notice::CallbackOutcome(Terminal::Error)),
    ]);
}
#[test]
fn owner_shutdown_cancels_pending_and_prevents_callback_after_teardown() {
    let mut s = Scheduler::new(2);
    let a = s.submit(77,Kind::Write,Callback::Outcome,Some("owned".into())).unwrap();
    let b = s.submit(77,Kind::Read,Callback::Outcome,None).unwrap();
    s.stop(77);
    assert_eq!(s.pending,0);
    assert!(s.delivered.is_empty());
    assert_eq!(s.events,vec![
        (a,Notice::Supervisor(Terminal::Cancelled)),
        (b,Notice::Supervisor(Terminal::Cancelled))
    ]);
    assert_eq!(s.tickets[&a].payload.as_deref(),Some("owned"));
}
#[test]
fn owner_shutdown_blocks_new_submissions_and_returns_payload() {
    let mut s = Scheduler::new(1);
    s.stop(8);
    assert_eq!(s.submit(8,Kind::Write,Callback::None,Some("retain".into())),
        Err((AdmissionError::OwnerStopped,Some("retain".into()))));
}
#[test]
fn cancellation_before_commit_prevents_ghost_write() {
    let mut s = Scheduler::new(1);
    let id = s.submit(1,Kind::Write,Callback::Outcome,Some("never".into())).unwrap();
    s.finish(id,Terminal::Cancelled).unwrap();
    assert_eq!(s.finish(id,Terminal::Admitted),Err(FinishError::AlreadyFinished));
    assert!(s.delivered.is_empty());
    assert_eq!(s.tickets[&id].payload.as_deref(),Some("never"));
}
#[test]
fn commit_before_cancel_cannot_replay_or_erase_delivery() {
    let mut s = Scheduler::new(1);
    let id = s.submit(1,Kind::Write,Callback::Outcome,Some("once".into())).unwrap();
    s.finish(id,Terminal::Admitted).unwrap();
    s.stop(1);
    assert_eq!(s.delivered,vec!["once"]);
    assert_eq!(s.finish(id,Terminal::Cancelled),Err(FinishError::AlreadyFinished));
}
#[test]
fn no_unbounded_pending_operations_and_credit_released_on_completion() {
    let mut s = Scheduler::new(1);
    let a=s.submit(1,Kind::Write,Callback::None,Some("one".into())).unwrap();
    assert_eq!(s.submit(1,Kind::Write,Callback::None,Some("two".into())),
        Err((AdmissionError::CreditsExhausted,Some("two".into()))));
    s.finish(a,Terminal::Admitted).unwrap();
    assert!(s.submit(1,Kind::Write,Callback::None,Some("two".into())).is_ok());
}
