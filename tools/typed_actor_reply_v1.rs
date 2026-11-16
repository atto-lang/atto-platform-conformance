//! SOURCE_ONLY reference model. Not Atto compiler/guest execution.
#![forbid(unsafe_code)]
use std::collections::VecDeque;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode { OneWay, Unary, Stream }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fault { Full, Stale, Unsupported, Duplicate, NotReady, Terminated, ModeMismatch }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Ticket { index: usize, generation: u64, incarnation: u64 }
struct Slot {
    generation: u64,
    active: bool,
    mode: Mode,
    queued: VecDeque<i64>,
    terminal: bool,
    failed: bool,
}
impl Slot {
    fn new() -> Self {
        Self { generation: 1, active: false, mode: Mode::OneWay,
            queued: VecDeque::new(), terminal: false, failed: false }
    }
}
struct Ledger { slots: Vec<Slot>, incarnation: u64, stream_capacity: usize }
impl Ledger {
    fn new(slots: usize, stream_capacity: usize, incarnation: u64) -> Self {
        assert!(slots > 0 && stream_capacity > 0);
        Self { slots: (0..slots).map(|_| Slot::new()).collect(), incarnation, stream_capacity }
    }
    fn admit(&mut self, mode: Mode) -> Result<Ticket, Fault> {
        if mode == Mode::OneWay { return Err(Fault::Unsupported); }
        let (index, s) = self.slots.iter_mut().enumerate()
            .find(|(_, s)| !s.active).ok_or(Fault::Full)?;
        s.active = true;
        s.mode = mode;
        s.queued.clear();
        s.terminal = false;
        s.failed = false;
        Ok(Ticket { index, generation: s.generation, incarnation: self.incarnation })
    }
    fn slot(&mut self, t: Ticket) -> Result<&mut Slot, Fault> {
        if t.incarnation != self.incarnation { return Err(Fault::Stale); }
        let s = self.slots.get_mut(t.index).ok_or(Fault::Stale)?;
        if !s.active || t.generation != s.generation { return Err(Fault::Stale); }
        Ok(s)
    }
    fn emit(&mut self, t: Ticket, v: i64) -> Result<(), Fault> {
        let max = self.stream_capacity;
        let s = self.slot(t)?;
        if s.terminal { return Err(Fault::Duplicate); }
        match s.mode {
            Mode::OneWay => Err(Fault::Unsupported),
            Mode::Unary if !s.queued.is_empty() => Err(Fault::Duplicate),
            Mode::Unary => { s.queued.push_back(v); s.terminal = true; Ok(()) },
            Mode::Stream if s.queued.len() >= max => Err(Fault::Full),
            Mode::Stream => { s.queued.push_back(v); Ok(()) }
        }
    }
    fn close_stream(&mut self, t: Ticket) -> Result<(), Fault> {
        let s = self.slot(t)?;
        if s.mode != Mode::Stream { return Err(Fault::ModeMismatch); }
        if s.terminal { return Err(Fault::Duplicate); }
        s.terminal = true;
        Ok(())
    }
    fn abort(&mut self, t: Ticket) -> Result<(), Fault> {
        let s = self.slot(t)?;
        if s.terminal { return Err(Fault::Duplicate); }
        s.queued.clear(); s.failed = true; s.terminal = true; Ok(())
    }
    fn retire(s: &mut Slot) {
        s.active = false; s.queued.clear();
        // Production must permanently retire generation-exhausted slots.
        s.generation = s.generation.checked_add(1).expect("generation exhausted");
    }
    fn receive(&mut self, t: Ticket) -> Result<Option<i64>, Fault> {
        let s = self.slot(t)?;
        if s.failed { Self::retire(s); return Err(Fault::Terminated); }
        if let Some(v) = s.queued.pop_front() {
            if s.mode == Mode::Unary { Self::retire(s); }
            return Ok(Some(v));
        }
        if s.terminal { Self::retire(s); return Ok(None); }
        Err(Fault::NotReady)
    }
    fn cancel(&mut self, t: Ticket) -> Result<(), Fault> {
        let s = self.slot(t)?;
        Self::retire(s); Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn out_of_order_unary_correlations() {
        let mut l = Ledger::new(2, 2, 42);
        let a = l.admit(Mode::Unary).unwrap();
        let b = l.admit(Mode::Unary).unwrap();
        l.emit(b, 22).unwrap(); l.emit(a, 11).unwrap();
        assert_eq!(l.receive(a), Ok(Some(11)));
        assert_eq!(l.receive(b), Ok(Some(22)));
    }
    #[test] fn unary_exactly_once() {
        let mut l = Ledger::new(1, 1, 3);
        let a = l.admit(Mode::Unary).unwrap();
        l.emit(a, 7).unwrap();
        assert_eq!(l.emit(a, 8), Err(Fault::Duplicate));
        assert_eq!(l.receive(a), Ok(Some(7)));
        assert_eq!(l.receive(a), Err(Fault::Stale));
    }
    #[test] fn ordered_stream_backpressure_close() {
        let mut l = Ledger::new(1, 2, 4);
        let a = l.admit(Mode::Stream).unwrap();
        l.emit(a, 9).unwrap(); l.emit(a, 10).unwrap();
        assert_eq!(l.emit(a, 11), Err(Fault::Full));
        assert_eq!(l.receive(a), Ok(Some(9)));
        l.emit(a, 11).unwrap(); l.close_stream(a).unwrap();
        assert_eq!(l.emit(a, 12), Err(Fault::Duplicate));
        assert_eq!(l.receive(a), Ok(Some(10)));
        assert_eq!(l.receive(a), Ok(Some(11)));
        assert_eq!(l.receive(a), Ok(None));
        assert_eq!(l.receive(a), Err(Fault::Stale));
    }
    #[test] fn aba_reuse_rejects_stale_reply() {
        let mut l = Ledger::new(1, 1, 4);
        let a = l.admit(Mode::Unary).unwrap(); l.cancel(a).unwrap();
        let b = l.admit(Mode::Unary).unwrap();
        assert_ne!(a.generation, b.generation);
        assert_eq!(l.emit(a, 999), Err(Fault::Stale));
        l.emit(b, 123).unwrap();
        assert_eq!(l.receive(b), Ok(Some(123)));
    }
    #[test] fn spoofed_endpoint_rejected() {
        let mut l = Ledger::new(1, 1, 7);
        let a = l.admit(Mode::Unary).unwrap();
        let forged = Ticket { incarnation: 8, ..a };
        assert_eq!(l.emit(forged, 5), Err(Fault::Stale));
        l.emit(a, 6).unwrap();
        assert_eq!(l.receive(a), Ok(Some(6)));
    }
    #[test] fn missing_response_terminates_not_success() {
        let mut l = Ledger::new(1, 1, 5);
        let a = l.admit(Mode::Unary).unwrap(); l.abort(a).unwrap();
        assert_eq!(l.receive(a), Err(Fault::Terminated));
        assert_eq!(l.emit(a, 5), Err(Fault::Stale));
    }
    #[test] fn slots_bounded_and_cancellable() {
        let mut l = Ledger::new(1, 1, 9);
        let a = l.admit(Mode::Stream).unwrap();
        assert_eq!(l.admit(Mode::Unary), Err(Fault::Full));
        l.cancel(a).unwrap();
        assert!(l.admit(Mode::Unary).is_ok());
    }
    #[test] fn one_way_has_no_reply_slot() {
        let mut l = Ledger::new(1, 1, 1);
        assert_eq!(l.admit(Mode::OneWay), Err(Fault::Unsupported));
        let a = l.admit(Mode::Unary).unwrap();
        assert_eq!(l.close_stream(a), Err(Fault::ModeMismatch));
    }
    #[test] fn stream_error_is_not_eof() {
        let mut l = Ledger::new(1, 1, 5);
        let a = l.admit(Mode::Stream).unwrap(); l.abort(a).unwrap();
        assert_eq!(l.receive(a), Err(Fault::Terminated));
    }
    #[test] fn admission_does_not_mean_reply_ready() {
        let mut l = Ledger::new(1, 1, 5);
        let a = l.admit(Mode::Unary).unwrap();
        assert_eq!(l.receive(a), Err(Fault::NotReady));
    }
}
fn main() { println!("SOURCE_ONLY typed actor reply reference model (NO guest execution)"); }
