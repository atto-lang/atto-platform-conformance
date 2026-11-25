//! Rust-only reference model for logically unbounded, non-suspending
//! AttoLang stdio.out admission. This is NOT a compiled guest, real OS sink,
//! or scheduler execution receipt.
use std::collections::VecDeque;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AdmissionError { Closed, Quota }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Flush { Complete, Pending }
#[derive(Debug, PartialEq, Eq)]
struct Message { seq: u64, data: Vec<u8> }

struct Stdio {
    /// Byte budget, not a channel slot count.
    quota: usize,
    pending_bytes: usize,
    closed: bool,
    failed: bool,
    next_seq: u64,
    delivered_seq: u64,
    pending: VecDeque<Message>,
    delivered: Vec<Vec<u8>>,
}
impl Stdio {
    fn with_quota(quota: usize) -> Self {
        Self {
            quota, pending_bytes: 0, closed: false, failed: false,
            next_seq: 0, delivered_seq: 0,
            pending: VecDeque::new(), delivered: Vec::new(),
        }
    }
    /// Immediate, atomic admission. It never examines OS writability.
    /// On failure, the caller keeps the complete unconsumed payload.
    fn writech(&mut self, payload: Vec<u8>) -> Result<u64, (AdmissionError, Vec<u8>)> {
        if self.closed || self.failed {
            return Err((AdmissionError::Closed, payload));
        }
        if payload.len() > self.quota.saturating_sub(self.pending_bytes) {
            return Err((AdmissionError::Quota, payload));
        }
        self.next_seq += 1;
        let seq = self.next_seq;
        self.pending_bytes += payload.len();
        self.pending.push_back(Message { seq, data: payload });
        Ok(seq)
    }
    /// The *background drainer* alone reacts to external readiness.
    fn drain_one(&mut self, os_writable: bool) -> bool {
        if !os_writable { return false; }
        let Some(msg) = self.pending.pop_front() else { return false; };
        self.pending_bytes -= msg.data.len();
        self.delivered_seq = msg.seq;
        self.delivered.push(msg.data);
        true
    }
    fn flush(&self, watermark: u64) -> Result<Flush, AdmissionError> {
        if self.delivered_seq >= watermark { return Ok(Flush::Complete); }
        if self.closed || self.failed { return Err(AdmissionError::Closed); }
        Ok(Flush::Pending)
    }
    fn can_admit(&self, payload_len: usize) -> bool {
        !self.closed && !self.failed
            && payload_len <= self.quota.saturating_sub(self.pending_bytes)
    }
}

#[test]
fn admission_ignores_slow_or_stalled_os_consumer() {
    let mut s = Stdio::with_quota(64);
    let seq = s.writech(b"Hello".to_vec()).unwrap();
    for _ in 0..10 { assert!(!s.drain_one(false)); }
    assert_eq!(s.flush(seq), Ok(Flush::Pending));
    assert_eq!(s.writech(b" world".to_vec()), Ok(seq + 1));
    assert_eq!(s.pending.len(), 2);
    assert_eq!(s.pending_bytes, 11);
}

#[test]
fn no_fixed_slot_count_if_byte_budget_allows_admission() {
    let mut s = Stdio::with_quota(128);
    for _ in 0..64 { assert!(s.writech(vec![b'x']).is_ok()); }
    assert_eq!(s.pending.len(), 64);
    assert_eq!(s.pending_bytes, 64);
    assert_eq!(s.flush(64), Ok(Flush::Pending));
}

#[test]
fn quota_rejection_is_immediate_and_retains_payload_for_retry() {
    let mut s = Stdio::with_quota(5);
    assert_eq!(s.writech(b"abcd".to_vec()), Ok(1));
    let failed = s.writech(b"xyz".to_vec());
    assert_eq!(failed, Err((AdmissionError::Quota, b"xyz".to_vec())));
    assert_eq!(s.pending_bytes, 4);
    assert_eq!(s.pending.len(), 1);
    assert!(s.drain_one(true));
    let payload = failed.unwrap_err().1;
    assert_eq!(s.writech(payload), Ok(2));
}

#[test]
fn closure_rejects_without_suspension_or_partial_transfer() {
    let mut s = Stdio::with_quota(5);
    let first = s.writech(b"a".to_vec()).unwrap();
    s.closed = true;
    assert_eq!(s.writech(b"rest".to_vec()), Err((AdmissionError::Closed, b"rest".to_vec())));
    assert_eq!(s.pending_bytes, 1);
    assert_eq!(s.flush(first), Err(AdmissionError::Closed));
}

#[test]
fn queued_messages_have_single_admission_and_fifo_drain_order() {
    let mut s = Stdio::with_quota(100);
    let payloads = [b"first".to_vec(), b"second".to_vec(), b"third".to_vec()];
    for (i, p) in payloads.iter().enumerate() {
        assert_eq!(s.writech(p.clone()), Ok((i + 1) as u64));
    }
    for _ in 0..3 { assert!(s.drain_one(true)); }
    assert!(!s.drain_one(true));
    assert_eq!(s.delivered, payloads);
    assert_eq!(s.pending_bytes, 0);
    assert_eq!(s.flush(3), Ok(Flush::Complete));
}

#[test]
fn flush_covers_only_admissions_before_its_watermark() {
    let mut s = Stdio::with_quota(10);
    let before = s.writech(vec![1]).unwrap();
    let after = s.writech(vec![2]).unwrap();
    assert!(s.drain_one(true));
    assert_eq!(s.flush(before), Ok(Flush::Complete));
    assert_eq!(s.flush(after), Ok(Flush::Pending));
}

#[test]
fn selected_write_only_commits_one_winning_payload() {
    let mut s = Stdio::with_quota(6);
    let mut arms = [Some(b"A".to_vec()), Some(b"B".to_vec())];
    let winner = 1usize;
    assert!(s.can_admit(arms[winner].as_ref().unwrap().len()));
    let payload = arms[winner].take().unwrap();
    assert_eq!(s.writech(payload), Ok(1));
    assert_eq!(arms[0], Some(b"A".to_vec()));
    assert_eq!(arms[1], None);
    assert_eq!(s.pending.len(), 1);
    assert_eq!(s.pending[0].data, b"B");
}

#[test]
fn non_admissible_select_write_retains_all_arm_payloads() {
    let mut s = Stdio::with_quota(1);
    s.writech(b"x".to_vec()).unwrap();
    let arms = [Some(b"A".to_vec()), Some(b"B".to_vec())];
    assert!(!s.can_admit(1));
    assert!(arms.iter().all(Option::is_some));
    assert_eq!(s.pending.len(), 1);
}

#[test]
fn zero_byte_message_still_has_one_observable_admission() {
    let mut s = Stdio::with_quota(1);
    let seq = s.writech(Vec::new()).unwrap();
    assert_eq!(seq, 1);
    assert_eq!(s.pending.len(), 1);
    assert_eq!(s.flush(seq), Ok(Flush::Pending));
    assert!(s.drain_one(true));
    assert_eq!(s.flush(seq), Ok(Flush::Complete));
}
