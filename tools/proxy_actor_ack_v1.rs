//! Host-only SOURCE_ONLY proxy actor acknowledgment oracle.
//! Not compiled Atto guest execution, cryptographic authentication, or production wire code.
#![forbid(unsafe_code)]
#![allow(dead_code)]

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Key {
    tenant: u64,
    caller: u64,
    recipient: u64,
    incarnation: u64,
    message_id: u64,
    attempt: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Handle { slot: usize, generation: u64, key: Key }
/// VM-private permit; never serialized into an application ActorMail.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Permit { handle: Handle, issuer: u64, secret: u64, version: u32 }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage { Admitted, Started, Processed(i64) }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DurableScope { Inbox, Result }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Error { Full, Duplicate, Conflict, Forged, Stale, OutOfOrder, Unsupported, Exhausted }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AckEffect { Applied, Duplicate }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Snapshot {
    admitted: bool,
    started: bool,
    processed: bool,
    inbox_durable: bool,
    result_durable: bool,
    uncertain: bool,
    failed: bool,
}
struct Flight {
    key: Key,
    issuer: u64,
    secret: u64,
    version: u32,
    durable_capable: bool,
    admitted: bool,
    started: bool,
    processed: Option<i64>,
    inbox_durable: bool,
    result_durable: bool,
    uncertain: bool,
    failed: bool,
}
struct Slot { generation: u64, retired: bool, flight: Option<Flight> }
struct ProxyLedger { slots: Vec<Slot>, next_secret: u64, version: u32 }
impl ProxyLedger {
    fn new(capacity: usize, version: u32) -> Self {
        Self {
            slots: (0..capacity).map(|_| Slot { generation: 1, retired: false, flight: None }).collect(),
            next_secret: 0,
            version,
        }
    }
    /// Creates only a pending forwarding operation. This is NOT a destination ACK.
    fn forward(&mut self, key: Key, issuer: u64, durable: bool) -> Result<(Handle, Permit), Error> {
        if self.slots.iter().any(|s| s.flight.as_ref().is_some_and(|f| f.key == key)) {
            return Err(Error::Duplicate);
        }
        let secret = self.next_secret.checked_add(1).ok_or(Error::Exhausted)?;
        let (index, slot) = self.slots.iter_mut().enumerate()
            .find(|(_, s)| !s.retired && s.flight.is_none()).ok_or(Error::Full)?;
        self.next_secret = secret;
        let handle = Handle { slot: index, generation: slot.generation, key };
        slot.flight = Some(Flight {
            key, issuer, secret, version: self.version, durable_capable: durable,
            admitted: false, started: false, processed: None, inbox_durable: false,
            result_durable: false, uncertain: false, failed: false,
        });
        Ok((handle, Permit { handle, issuer, secret, version: self.version }))
    }
    fn entry_by_handle(&self, h: Handle) -> Result<&Flight, Error> {
        let s = self.slots.get(h.slot).ok_or(Error::Stale)?;
        if s.retired || s.generation != h.generation { return Err(Error::Stale); }
        let f = s.flight.as_ref().ok_or(Error::Stale)?;
        if f.key != h.key { return Err(Error::Forged); }
        Ok(f)
    }
    fn entry_mut(&mut self, p: Permit) -> Result<&mut Flight, Error> {
        let s = self.slots.get_mut(p.handle.slot).ok_or(Error::Stale)?;
        if s.retired || s.generation != p.handle.generation { return Err(Error::Stale); }
        let f = s.flight.as_mut().ok_or(Error::Stale)?;
        if f.key != p.handle.key || f.issuer != p.issuer ||
            f.secret != p.secret || f.version != p.version {
            return Err(Error::Forged);
        }
        Ok(f)
    }
    /// Called only for a destination-scheduler-authenticated acknowledgment.
    fn destination_ack(&mut self, p: Permit, stage: Stage) -> Result<AckEffect, Error> {
        let f = self.entry_mut(p)?;
        if f.failed { return Err(Error::Conflict); }
        match stage {
            Stage::Admitted => {
                if f.admitted { return Ok(AckEffect::Duplicate); }
                f.admitted = true;
            }
            Stage::Started => {
                if !f.admitted { return Err(Error::OutOfOrder); }
                if f.started { return Ok(AckEffect::Duplicate); }
                f.started = true;
            }
            Stage::Processed(v) => {
                if !f.started { return Err(Error::OutOfOrder); }
                if let Some(prev) = f.processed {
                    return if prev == v { Ok(AckEffect::Duplicate) } else { Err(Error::Conflict) };
                }
                f.processed = Some(v);
            }
        }
        Ok(AckEffect::Applied)
    }
    /// Invoked only by a trusted provider after a real durable transaction commit.
    /// A network actor ACK alone cannot invoke a durable transition in production.
    fn provider_commit(&mut self, p: Permit, scope: DurableScope) -> Result<AckEffect, Error> {
        let f = self.entry_mut(p)?;
        if !f.durable_capable { return Err(Error::Unsupported); }
        if !f.admitted || f.failed { return Err(Error::OutOfOrder); }
        let flag = match scope {
            DurableScope::Inbox => &mut f.inbox_durable,
            DurableScope::Result => {
                if f.processed.is_none() { return Err(Error::OutOfOrder); }
                &mut f.result_durable
            }
        };
        if *flag { return Ok(AckEffect::Duplicate); }
        *flag = true;
        Ok(AckEffect::Applied)
    }
    fn fail_processing(&mut self, p: Permit) -> Result<(), Error> {
        let f = self.entry_mut(p)?;
        if !f.started || f.processed.is_some() || f.failed { return Err(Error::OutOfOrder); }
        f.failed = true;
        Ok(())
    }
    /// Network loss makes delivery indeterminate; it is NOT a rejection.
    fn transport_lost(&mut self, h: Handle) -> Result<(), Error> {
        self.entry_by_handle(h)?;
        let f = self.slots[h.slot].flight.as_mut().ok_or(Error::Stale)?;
        f.uncertain = true;
        Ok(())
    }
    fn snapshot(&self, h: Handle) -> Result<Snapshot, Error> {
        let f = self.entry_by_handle(h)?;
        Ok(Snapshot {
            admitted: f.admitted, started: f.started, processed: f.processed.is_some(),
            inbox_durable: f.inbox_durable, result_durable: f.result_durable,
            uncertain: f.uncertain, failed: f.failed,
        })
    }
    fn retire(&mut self, h: Handle) -> Result<(), Error> {
        self.entry_by_handle(h)?;
        let slot = &mut self.slots[h.slot];
        slot.flight = None;
        match slot.generation.checked_add(1) {
            Some(g) => slot.generation = g,
            None => slot.retired = true, // never recycle an exhausted generation
        }
        Ok(())
    }
    fn restart_recipient(&mut self, recipient: u64, old_incarnation: u64) {
        let handles: Vec<_> = self.slots.iter().enumerate().filter_map(|(i, s)| {
            let f = s.flight.as_ref()?;
            if f.key.recipient == recipient && f.key.incarnation == old_incarnation {
                Some(Handle { slot: i, generation: s.generation, key: f.key })
            } else { None }
        }).collect();
        for h in handles { self.retire(h).expect("matched live flight"); }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn key() -> Key {
        Key { tenant: 7, caller: 3, recipient: 11, incarnation: 4, message_id: 99, attempt: 1 }
    }
    fn admitted(l: &mut ProxyLedger, durable: bool) -> (Handle, Permit) {
        let (h, p) = l.forward(key(), 17, durable).unwrap();
        assert_eq!(l.destination_ack(p, Stage::Admitted), Ok(AckEffect::Applied));
        (h, p)
    }
    #[test] fn proxy_forwarding_is_not_destination_admission() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, _) = l.forward(key(), 17, false).unwrap();
        let s = l.snapshot(h).unwrap();
        assert!(!s.admitted && !s.started && !s.processed);
    }
    #[test] fn target_admission_is_exact_and_idempotent() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = admitted(&mut l, false);
        assert!(l.snapshot(h).unwrap().admitted);
        assert_eq!(l.destination_ack(p, Stage::Admitted), Ok(AckEffect::Duplicate));
        assert!(!l.snapshot(h).unwrap().started);
    }
    #[test] fn started_does_not_mean_processed() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = admitted(&mut l, false);
        l.destination_ack(p, Stage::Started).unwrap();
        assert!(l.snapshot(h).unwrap().started);
        assert!(!l.snapshot(h).unwrap().processed);
    }
    #[test] fn stage_order_and_conflicting_result_rejected() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = l.forward(key(), 17, false).unwrap();
        assert_eq!(l.destination_ack(p, Stage::Processed(5)), Err(Error::OutOfOrder));
        assert_eq!(l.destination_ack(p, Stage::Started), Err(Error::OutOfOrder));
        l.destination_ack(p, Stage::Admitted).unwrap();
        l.destination_ack(p, Stage::Started).unwrap();
        assert_eq!(l.destination_ack(p, Stage::Processed(5)), Ok(AckEffect::Applied));
        assert_eq!(l.destination_ack(p, Stage::Processed(5)), Ok(AckEffect::Duplicate));
        assert_eq!(l.destination_ack(p, Stage::Processed(6)), Err(Error::Conflict));
        assert!(l.snapshot(h).unwrap().processed);
    }
    #[test] fn inbox_commit_does_not_imply_handler_execution() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = admitted(&mut l, true);
        l.provider_commit(p, DurableScope::Inbox).unwrap();
        let s = l.snapshot(h).unwrap();
        assert!(s.inbox_durable && !s.started && !s.processed && !s.result_durable);
        assert_eq!(l.provider_commit(p, DurableScope::Result), Err(Error::OutOfOrder));
    }
    #[test] fn durable_result_requires_handler_and_provider_commit() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = admitted(&mut l, true);
        l.destination_ack(p, Stage::Started).unwrap();
        l.destination_ack(p, Stage::Processed(123)).unwrap();
        assert!(!l.snapshot(h).unwrap().result_durable);
        assert_eq!(l.provider_commit(p, DurableScope::Result), Ok(AckEffect::Applied));
        assert_eq!(l.provider_commit(p, DurableScope::Result), Ok(AckEffect::Duplicate));
        assert!(l.snapshot(h).unwrap().result_durable);
    }
    #[test] fn memory_only_actor_cannot_claim_durability() {
        let mut l = ProxyLedger::new(1, 1);
        let (_, p) = admitted(&mut l, false);
        assert_eq!(l.provider_commit(p, DurableScope::Inbox), Err(Error::Unsupported));
    }
    #[test] fn forged_caller_target_tenant_attempt_and_token_rejected() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = l.forward(key(), 17, true).unwrap();
        let mut forged = p;
        forged.handle.key.tenant = 8;
        assert_eq!(l.destination_ack(forged, Stage::Admitted), Err(Error::Forged));
        forged = p; forged.handle.key.recipient = 12;
        assert_eq!(l.destination_ack(forged, Stage::Admitted), Err(Error::Forged));
        forged = p; forged.handle.key.attempt = 2;
        assert_eq!(l.destination_ack(forged, Stage::Admitted), Err(Error::Forged));
        forged = p; forged.secret ^= 1;
        assert_eq!(l.destination_ack(forged, Stage::Admitted), Err(Error::Forged));
        forged = p; forged.version += 1;
        assert_eq!(l.destination_ack(forged, Stage::Admitted), Err(Error::Forged));
        assert!(!l.snapshot(h).unwrap().admitted);
    }
    #[test] fn bounded_slots_and_identical_attempt_not_double_admitted() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, _) = l.forward(key(), 17, false).unwrap();
        assert_eq!(l.forward(key(), 17, false).unwrap_err(), Error::Duplicate);
        let mut other = key(); other.message_id += 1;
        assert_eq!(l.forward(other, 17, false).unwrap_err(), Error::Full);
        l.retire(h).unwrap();
        assert!(l.forward(other, 17, false).is_ok());
    }
    #[test] fn stale_ack_after_restart_and_slot_reuse() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = admitted(&mut l, false);
        l.restart_recipient(11, 4);
        assert_eq!(l.destination_ack(p, Stage::Started), Err(Error::Stale));
        assert_eq!(l.snapshot(h), Err(Error::Stale));
        let mut new_key = key(); new_key.incarnation = 5;
        let (next, new_permit) = l.forward(new_key, 17, false).unwrap();
        assert_ne!(h.generation, next.generation);
        assert_eq!(l.destination_ack(p, Stage::Admitted), Err(Error::Stale));
        assert_eq!(l.destination_ack(new_permit, Stage::Admitted), Ok(AckEffect::Applied));
    }
    #[test] fn network_loss_is_indeterminate_not_no_delivery() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = l.forward(key(), 17, false).unwrap();
        l.transport_lost(h).unwrap();
        let s = l.snapshot(h).unwrap();
        assert!(s.uncertain && !s.admitted);
        l.destination_ack(p, Stage::Admitted).unwrap();
        assert!(l.snapshot(h).unwrap().admitted);
    }
    #[test] fn retry_has_new_attempt_but_no_exactly_once_claim() {
        let mut l = ProxyLedger::new(2, 1);
        let (first, _) = l.forward(key(), 17, false).unwrap();
        let mut retry = key(); retry.attempt = 2;
        let (second, _) = l.forward(retry, 17, false).unwrap();
        assert_ne!(first.key, second.key);
        assert!(!l.snapshot(first).unwrap().admitted);
        assert!(!l.snapshot(second).unwrap().admitted);
    }
    #[test] fn panic_after_receive_never_produces_processed_ack() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = admitted(&mut l, true);
        l.destination_ack(p, Stage::Started).unwrap();
        l.fail_processing(p).unwrap();
        assert_eq!(l.destination_ack(p, Stage::Processed(0)), Err(Error::Conflict));
        assert_eq!(l.provider_commit(p, DurableScope::Result), Err(Error::OutOfOrder));
        assert!(l.snapshot(h).unwrap().failed && !l.snapshot(h).unwrap().processed);
    }
    #[test] fn late_receipt_after_cancel_is_fenced() {
        let mut l = ProxyLedger::new(1, 1);
        let (h, p) = admitted(&mut l, false);
        l.retire(h).unwrap();
        assert_eq!(l.destination_ack(p, Stage::Started), Err(Error::Stale));
    }
}
fn main() {
    println!("SOURCE_ONLY proxy actor ACK oracle; NO compiled Atto guest proof");
}
