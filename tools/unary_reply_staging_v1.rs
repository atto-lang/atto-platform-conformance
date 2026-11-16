//! SOURCE_ONLY one-shot reply model for return R and ActorMail.respond_with(R).
//! This is NOT compiled AttoLang or production runtime evidence.
#![forbid(unsafe_code)]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode { OneWay, Unary, Stream }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fault { Full, Stale, Duplicate, WrongMode, NotSettled }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Terminal { Success(i64), MissingReply, HandlerFailed, Cancelled }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Ticket { index: usize, generation: u64, incarnation: u64 }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase { Free, Open, Staged(i64), Settled(Terminal) }
struct Slot { generation: u64, phase: Phase }
struct Ledger { slots: Vec<Slot>, incarnation: u64 }

impl Ledger {
    fn new(capacity: usize, incarnation: u64) -> Self {
        assert!(capacity > 0);
        Self {
            slots: (0..capacity).map(|_| Slot { generation: 1, phase: Phase::Free }).collect(),
            incarnation,
        }
    }
    fn admit(&mut self, mode: Mode) -> Result<Ticket, Fault> {
        if mode != Mode::Unary { return Err(Fault::WrongMode); }
        let (index, slot) = self.slots.iter_mut().enumerate()
            .find(|(_, slot)| slot.phase == Phase::Free).ok_or(Fault::Full)?;
        slot.phase = Phase::Open;
        Ok(Ticket { index, generation: slot.generation, incarnation: self.incarnation })
    }
    fn slot(&mut self, key: Ticket) -> Result<&mut Slot, Fault> {
        if key.incarnation != self.incarnation { return Err(Fault::Stale); }
        let s = self.slots.get_mut(key.index).ok_or(Fault::Stale)?;
        if s.generation != key.generation || s.phase == Phase::Free { return Err(Fault::Stale); }
        Ok(s)
    }
    // return R, m.respond_with(R), and a migration-only send_back alias ALL
    // stage through the same one-shot permission. Stage does not publish.
    fn stage(&mut self, key: Ticket, value: i64) -> Result<(), Fault> {
        let s = self.slot(key)?;
        match s.phase {
            Phase::Open => { s.phase = Phase::Staged(value); Ok(()) },
            Phase::Staged(_) | Phase::Settled(_) => Err(Fault::Duplicate),
            Phase::Free => Err(Fault::Stale),
        }
    }
    fn returned(&mut self, key: Ticket, value: i64) -> Result<(), Fault> { self.stage(key, value) }
    fn respond_with(&mut self, key: Ticket, value: i64) -> Result<(), Fault> { self.stage(key, value) }
    fn send_back_alias(&mut self, key: Ticket, value: i64) -> Result<(), Fault> { self.stage(key, value) }
    fn finish(&mut self, key: Ticket, success: bool) -> Result<(), Fault> {
        let s = self.slot(key)?;
        match s.phase {
            Phase::Open => s.phase = Phase::Settled(if success {
                Terminal::MissingReply
            } else { Terminal::HandlerFailed }),
            Phase::Staged(v) => s.phase = Phase::Settled(if success {
                Terminal::Success(v)
            } else { Terminal::HandlerFailed }),
            Phase::Settled(_) => return Err(Fault::Duplicate),
            Phase::Free => return Err(Fault::Stale),
        }
        Ok(())
    }
    fn cancel(&mut self, key: Ticket) -> Result<(), Fault> {
        let s = self.slot(key)?;
        match s.phase {
            Phase::Open | Phase::Staged(_) => {
                s.phase = Phase::Settled(Terminal::Cancelled);
                Ok(())
            }
            Phase::Settled(_) => Err(Fault::Duplicate),
            Phase::Free => Err(Fault::Stale),
        }
    }
    fn take(&mut self, key: Ticket) -> Result<Terminal, Fault> {
        let s = self.slot(key)?;
        let Phase::Settled(outcome) = s.phase else { return Err(Fault::NotSettled) };
        // Production must retire generation-exhausted slots permanently.
        s.generation = s.generation.checked_add(1).expect("generation exhausted");
        s.phase = Phase::Free;
        Ok(outcome)
    }
}
fn unary_actor_admits(modes: &[Mode]) -> bool {
    !modes.is_empty() && modes.iter().all(|m| *m == Mode::Unary)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn direct_return_commits_only_at_successful_turn_end() {
        let mut l = Ledger::new(1, 7);
        let t = l.admit(Mode::Unary).unwrap();
        l.returned(t, 42).unwrap();
        assert_eq!(l.take(t), Err(Fault::NotSettled));
        l.finish(t, true).unwrap();
        assert_eq!(l.take(t), Ok(Terminal::Success(42)));
    }
    #[test] fn explicit_reply_and_return_share_single_permission() {
        let mut l = Ledger::new(1, 7);
        let t = l.admit(Mode::Unary).unwrap();
        l.respond_with(t, 4).unwrap();
        assert_eq!(l.returned(t, 5), Err(Fault::Duplicate));
        assert_eq!(l.respond_with(t, 6), Err(Fault::Duplicate));
        assert_eq!(l.send_back_alias(t, 7), Err(Fault::Duplicate));
        l.finish(t, true).unwrap();
        assert_eq!(l.take(t), Ok(Terminal::Success(4)));
    }
    #[test] fn panic_after_staging_discards_proposed_success() {
        let mut l = Ledger::new(1, 7);
        let t = l.admit(Mode::Unary).unwrap();
        l.respond_with(t, 42).unwrap();
        l.finish(t, false).unwrap();
        assert_eq!(l.take(t), Ok(Terminal::HandlerFailed));
    }
    #[test] fn missing_unary_reply_is_terminal_error() {
        let mut l = Ledger::new(1, 7);
        let t = l.admit(Mode::Unary).unwrap();
        l.finish(t, true).unwrap();
        assert_eq!(l.take(t), Ok(Terminal::MissingReply));
    }
    #[test] fn cancellation_overrides_staged_reply_and_blocks_late_commit() {
        let mut l = Ledger::new(1, 7);
        let t = l.admit(Mode::Unary).unwrap();
        l.returned(t, 42).unwrap();
        l.cancel(t).unwrap();
        assert_eq!(l.finish(t, true), Err(Fault::Duplicate));
        assert_eq!(l.take(t), Ok(Terminal::Cancelled));
        assert_eq!(l.respond_with(t, 43), Err(Fault::Stale));
    }
    #[test] fn reject_wrong_incarnation_and_reused_generation() {
        let mut l = Ledger::new(1, 17);
        let t = l.admit(Mode::Unary).unwrap();
        let forged = Ticket { incarnation: 18, ..t };
        assert_eq!(l.returned(forged, 1), Err(Fault::Stale));
        l.returned(t, 2).unwrap();
        l.finish(t, true).unwrap();
        assert_eq!(l.take(t), Ok(Terminal::Success(2)));
        let replacement = l.admit(Mode::Unary).unwrap();
        assert_ne!(replacement.generation, t.generation);
        assert_eq!(l.respond_with(t, 3), Err(Fault::Stale));
        l.respond_with(replacement, 4).unwrap();
        l.finish(replacement, true).unwrap();
        assert_eq!(l.take(replacement), Ok(Terminal::Success(4)));
    }
    #[test] fn independent_concurrent_unary_correlations() {
        let mut l = Ledger::new(2, 7);
        let a = l.admit(Mode::Unary).unwrap();
        let b = l.admit(Mode::Unary).unwrap();
        assert_eq!(l.admit(Mode::Unary), Err(Fault::Full));
        l.respond_with(b, 20).unwrap();
        l.finish(b, true).unwrap();
        l.returned(a, 10).unwrap();
        l.finish(a, true).unwrap();
        assert_eq!(l.take(a), Ok(Terminal::Success(10)));
        assert_eq!(l.take(b), Ok(Terminal::Success(20)));
    }
    #[test] fn unary_modifier_rejects_mixed_response_modes() {
        assert!(unary_actor_admits(&[Mode::Unary]));
        assert!(!unary_actor_admits(&[]));
        assert!(!unary_actor_admits(&[Mode::Unary, Mode::OneWay]));
        assert!(!unary_actor_admits(&[Mode::Stream]));
        let mut l = Ledger::new(1, 7);
        assert_eq!(l.admit(Mode::OneWay), Err(Fault::WrongMode));
        assert_eq!(l.admit(Mode::Stream), Err(Fault::WrongMode));
    }
}
fn main() { println!("SOURCE_ONLY staged unary reply model, no Atto guest execution"); }
