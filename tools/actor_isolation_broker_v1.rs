//! Source-only actor isolation adversarial reference model. Not an Atto guest or
//! a trusted broker implementation. All inputs in a production runtime must be
//! authenticated by the scheduler/broker, not taken from source-supplied IDs.
#![forbid(unsafe_code)]
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ActorIdentity { tenant: u64, actor: u64, incarnation: u64, placement: u64 }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ActorRefAuthority {
    holder_tenant: u64,
    target: ActorIdentity,
    allowed_data_mask: u64,
    can_delegate: bool,
    grant_generation: u64,
}
#[derive(Clone, Copy, Debug)]
struct AuthenticatedDelegation {
    caller_tenant: u64,
    recipient_tenant: u64,
    target: ActorIdentity,
    grant_generation: u64,
    requested_mask: u64,
    trusted_grant: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Denial { NoAuthority, StaleIdentity, Escalation, InFlight, NoCapacity, Closed, NotOwner }
fn attenuate_ref(reference: ActorRefAuthority, request: AuthenticatedDelegation)
    -> Result<ActorRefAuthority, Denial> {
    if !request.trusted_grant || !reference.can_delegate
        || request.caller_tenant != reference.holder_tenant
        || request.recipient_tenant != reference.holder_tenant
        || reference.target.tenant != reference.holder_tenant {
        return Err(Denial::NoAuthority);
    }
    if reference.target != request.target || reference.grant_generation != request.grant_generation {
        return Err(Denial::StaleIdentity);
    }
    if request.requested_mask == 0
        || (request.requested_mask & !reference.allowed_data_mask) != 0 {
        return Err(Denial::Escalation);
    }
    Ok(ActorRefAuthority {
        holder_tenant: request.recipient_tenant,
        target: reference.target,
        allowed_data_mask: request.requested_mask,
        can_delegate: false, // a delegated child is not a new delegation authority
        grant_generation: reference.grant_generation,
    })
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PayloadState {
    Sender { tenant: u64 },
    Escrow { tenant: u64, recipient: ActorIdentity, epoch: u64 },
    Inbox { recipient: ActorIdentity, epoch: u64 },
    Retired,
}
#[derive(Default)]
struct Mailman {
    payloads: HashMap<u64, PayloadState>,
    inbox_count: usize,
    capacity: usize,
    closed: bool,
    destination: Option<ActorIdentity>,
    epoch: u64,
}
impl Mailman {
    fn new(destination: ActorIdentity, capacity: usize, epoch: u64) -> Self {
        Self { capacity, destination: Some(destination), epoch, ..Self::default() }
    }
    fn register(&mut self, payload_id: u64, tenant: u64) -> Result<(), Denial> {
        if self.payloads.contains_key(&payload_id) { return Err(Denial::NotOwner); }
        self.payloads.insert(payload_id, PayloadState::Sender { tenant });
        Ok(())
    }
    // The trusted broker must check the real caller principal and destination
    // generation on every call. The caller cannot mint this metadata in guest code.
    fn stage(&mut self, payload_id: u64, sender_tenant: u64,
             recipient: ActorIdentity, epoch: u64, authorized: bool)
        -> Result<(), Denial> {
        if !authorized || sender_tenant != recipient.tenant {
            return Err(Denial::NoAuthority);
        }
        if self.destination != Some(recipient) || self.epoch != epoch {
            return Err(Denial::StaleIdentity);
        }
        if self.closed { return Err(Denial::Closed); }
        if self.inbox_count + self.reservation_count() >= self.capacity {
            return Err(Denial::NoCapacity);
        }
        match self.payloads.get_mut(&payload_id) {
            Some(PayloadState::Sender { tenant }) if *tenant == sender_tenant => {
                *self.payloads.get_mut(&payload_id).expect("present") =
                    PayloadState::Escrow { tenant: sender_tenant, recipient, epoch };
                Ok(())
            }
            _ => Err(Denial::NotOwner),
        }
    }
    fn reservation_count(&self) -> usize {
        self.payloads.values().filter(|v| matches!(v, PayloadState::Escrow { .. })).count()
    }
    fn commit(&mut self, payload_id: u64, recipient: ActorIdentity, epoch: u64)
        -> Result<(), Denial> {
        if self.closed { return Err(Denial::Closed); }
        if self.destination != Some(recipient) || self.epoch != epoch {
            return Err(Denial::StaleIdentity);
        }
        match self.payloads.get_mut(&payload_id) {
            Some(state @ PayloadState::Escrow { .. }) => {
                if *state != (PayloadState::Escrow { tenant: recipient.tenant, recipient, epoch }) {
                    return Err(Denial::StaleIdentity);
                }
                *state = PayloadState::Inbox { recipient, epoch };
                self.inbox_count += 1;
                Ok(())
            }
            _ => Err(Denial::NotOwner),
        }
    }
    fn abort(&mut self, payload_id: u64, sender_tenant: u64)
        -> Result<(), Denial> {
        match self.payloads.get_mut(&payload_id) {
            Some(state @ PayloadState::Escrow { .. }) => {
                if let PayloadState::Escrow { tenant, .. } = state {
                    if *tenant != sender_tenant { return Err(Denial::NoAuthority); }
                }
                *state = PayloadState::Sender { tenant: sender_tenant };
                Ok(())
            }
            _ => Err(Denial::NotOwner),
        }
    }
    fn deliver(&mut self, payload_id: u64, recipient: ActorIdentity, epoch: u64)
        -> Result<(), Denial> {
        match self.payloads.get_mut(&payload_id) {
            Some(state @ PayloadState::Inbox { .. }) => {
                if *state != (PayloadState::Inbox { recipient, epoch }) {
                    return Err(Denial::StaleIdentity);
                }
                *state = PayloadState::Retired;
                self.inbox_count -= 1;
                Ok(())
            }
            _ => Err(Denial::NotOwner),
        }
    }
    fn close(&mut self) {
        self.closed = true;
        for state in self.payloads.values_mut() {
            match *state {
                PayloadState::Escrow { tenant, .. } => *state = PayloadState::Sender { tenant },
                PayloadState::Inbox { .. } => *state = PayloadState::Retired,
                _ => (),
            }
        }
        self.inbox_count = 0;
    }
    fn restart(&mut self, recipient: ActorIdentity, epoch: u64) {
        self.close();
        self.destination = Some(recipient);
        self.epoch = epoch;
        self.closed = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn actor() -> ActorIdentity { ActorIdentity { tenant: 7, actor: 42, incarnation: 3, placement: 9 } }
    fn ref_cap() -> ActorRefAuthority {
        ActorRefAuthority { holder_tenant: 7, target: actor(),
            allowed_data_mask: 0b0111, can_delegate: true, grant_generation: 11 }
    }
    fn request() -> AuthenticatedDelegation {
        AuthenticatedDelegation { caller_tenant: 7, recipient_tenant: 7,
            target: actor(), grant_generation: 11, requested_mask: 0b0011, trusted_grant: true }
    }
    #[test] fn delegated_rights_are_strictly_attenuated() {
        let delegated = attenuate_ref(ref_cap(), request()).unwrap();
        assert_eq!(delegated.allowed_data_mask, 0b0011);
        assert!(!delegated.can_delegate);
    }
    #[test] fn nominal_actor_ref_is_not_a_capability_mint() {
        let mut req = request();
        req.trusted_grant = false;
        assert_eq!(attenuate_ref(ref_cap(), req), Err(Denial::NoAuthority));
    }
    #[test] fn delegate_cannot_escalate_or_redelegate() {
        let mut req = request();
        req.requested_mask = 0b1000;
        assert_eq!(attenuate_ref(ref_cap(), req), Err(Denial::Escalation));
        req.requested_mask = 0b0001;
        let child = attenuate_ref(ref_cap(), req).unwrap();
        assert_eq!(attenuate_ref(child, req), Err(Denial::NoAuthority));
    }
    #[test] fn stale_actor_incarnation_and_grant_generation_rejected() {
        let mut req = request();
        req.target.incarnation += 1;
        assert_eq!(attenuate_ref(ref_cap(), req), Err(Denial::StaleIdentity));
        req = request(); req.grant_generation += 1;
        assert_eq!(attenuate_ref(ref_cap(), req), Err(Denial::StaleIdentity));
        req = request(); req.target.placement += 1;
        assert_eq!(attenuate_ref(ref_cap(), req), Err(Denial::StaleIdentity));
    }
    #[test] fn local_actor_ref_never_crosses_tenant_boundary() {
        let mut req = request(); req.recipient_tenant = 8;
        assert_eq!(attenuate_ref(ref_cap(), req), Err(Denial::NoAuthority));
        req = request(); req.caller_tenant = 8;
        assert_eq!(attenuate_ref(ref_cap(), req), Err(Denial::NoAuthority));
    }
    #[test] fn raw_cross_tenant_alias_not_transformed_to_local_capability() {
        let mut ref_ = ref_cap(); ref_.target.tenant = 8;
        assert_eq!(attenuate_ref(ref_, request()), Err(Denial::NoAuthority));
    }
    #[test] fn stage_commit_deliver_moves_once() {
        let mut m = Mailman::new(actor(), 1, 22);
        m.register(13, 7).unwrap();
        m.stage(13, 7, actor(), 22, true).unwrap();
        assert_eq!(m.payloads[&13], PayloadState::Escrow { tenant: 7, recipient: actor(), epoch: 22 });
        m.commit(13, actor(), 22).unwrap();
        assert_eq!(m.commit(13, actor(), 22), Err(Denial::NotOwner));
        m.deliver(13, actor(), 22).unwrap();
        assert_eq!(m.deliver(13, actor(), 22), Err(Denial::NotOwner));
        assert_eq!(m.payloads[&13], PayloadState::Retired);
    }
    #[test] fn full_mailbox_denial_keeps_sender_owner() {
        let mut m = Mailman::new(actor(), 1, 22);
        m.register(1, 7).unwrap(); m.register(2, 7).unwrap();
        m.stage(1, 7, actor(), 22, true).unwrap();
        assert_eq!(m.stage(2, 7, actor(), 22, true), Err(Denial::NoCapacity));
        assert_eq!(m.payloads[&2], PayloadState::Sender { tenant: 7 });
    }
    #[test] fn revoked_route_and_wrong_tenant_leave_owner_untouched() {
        let mut m = Mailman::new(actor(), 1, 22); m.register(1, 7).unwrap();
        assert_eq!(m.stage(1, 7, actor(), 22, false), Err(Denial::NoAuthority));
        assert_eq!(m.stage(1, 8, actor(), 22, true), Err(Denial::NoAuthority));
        assert_eq!(m.payloads[&1], PayloadState::Sender { tenant: 7 });
    }
    #[test] fn cancellation_before_commit_restores_owner_once() {
        let mut m = Mailman::new(actor(), 1, 22); m.register(1, 7).unwrap();
        m.stage(1, 7, actor(), 22, true).unwrap();
        m.abort(1, 7).unwrap();
        assert_eq!(m.payloads[&1], PayloadState::Sender { tenant: 7 });
        assert_eq!(m.abort(1, 7), Err(Denial::NotOwner));
    }
    #[test] fn cancellation_after_commit_cannot_reclaim_accepted_message() {
        let mut m = Mailman::new(actor(), 1, 22); m.register(1, 7).unwrap();
        m.stage(1, 7, actor(), 22, true).unwrap();
        m.commit(1, actor(), 22).unwrap();
        assert_eq!(m.abort(1, 7), Err(Denial::NotOwner));
        assert_eq!(m.payloads[&1], PayloadState::Inbox { recipient: actor(), epoch: 22 });
    }
    #[test] fn close_returns_escrow_and_retires_committed_payload_once() {
        let mut m = Mailman::new(actor(), 2, 22);
        for id in 1..=2 { m.register(id, 7).unwrap(); m.stage(id, 7, actor(), 22, true).unwrap(); }
        m.commit(1, actor(), 22).unwrap();
        m.close(); m.close();
        assert_eq!(m.payloads[&1], PayloadState::Retired);
        assert_eq!(m.payloads[&2], PayloadState::Sender { tenant: 7 });
        assert_eq!(m.inbox_count, 0);
    }
    #[test] fn old_epoch_cannot_commit_into_new_incarnation() {
        let mut m = Mailman::new(actor(), 1, 22);
        m.register(1, 7).unwrap(); m.stage(1, 7, actor(), 22, true).unwrap();
        let mut next = actor(); next.incarnation += 1;
        m.restart(next, 23);
        assert_eq!(m.commit(1, actor(), 22), Err(Denial::StaleIdentity));
        assert_eq!(m.payloads[&1], PayloadState::Sender { tenant: 7 });
        assert_eq!(m.stage(1, 7, actor(), 22, true), Err(Denial::StaleIdentity));
    }
    #[test] fn duplicate_payload_id_fails_closed() {
        let mut m = Mailman::new(actor(), 1, 22);
        m.register(1, 7).unwrap();
        assert_eq!(m.register(1, 7), Err(Denial::NotOwner));
    }
    #[test] fn zero_capacity_does_not_overflow_or_consume() {
        let mut m = Mailman::new(actor(), 0, 22);
        m.register(1, 7).unwrap();
        assert_eq!(m.stage(1, 7, actor(), 22, true), Err(Denial::NoCapacity));
        assert_eq!(m.payloads[&1], PayloadState::Sender { tenant: 7 });
    }
}
#[cfg(not(test))]
fn main() {
    println!("actor broker isolation SOURCE_ONLY; no compiled Atto guest or TenantVM proof");
}
