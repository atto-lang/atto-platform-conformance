//! Rust-only reference model; NOT compiler-backed AttoLang guest conformance.
use std::collections::VecDeque;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind { Channel, SelectableStream, OrdinaryStream }
#[derive(Clone, Debug, PartialEq, Eq)]
enum Error { Closed, WouldBlock, NotSelectable }
#[derive(Clone, Debug, PartialEq, Eq)]
enum Read { Data(String), Eof }
struct Port { kind: Kind, capacity: usize, closed: bool, queue: VecDeque<String> }
impl Port {
    fn new(kind: Kind, capacity: usize) -> Self { Self { kind, capacity, closed: false, queue: VecDeque::new() } }
    fn read(&mut self) -> Result<Read, Error> {
        if let Some(x) = self.queue.pop_front() { Ok(Read::Data(x)) }
        else if self.closed { Ok(Read::Eof) } else { Err(Error::WouldBlock) }
    }
    fn write(&mut self, x: String) -> Result<(), (Error, String)> {
        if self.closed { return Err((Error::Closed, x)); }
        if self.queue.len() == self.capacity { return Err((Error::WouldBlock, x)); }
        self.queue.push_back(x); Ok(())
    }
}
#[derive(Debug)]
enum Arm { Read(usize), Write(usize, Option<String>) }
#[derive(Debug, PartialEq, Eq)]
struct Winner { index: usize, value: Option<Read> }
fn select(ports: &mut [Port], arms: &mut [Arm]) -> Result<Option<Winner>, Error> {
    // Validate ALL contenders before committing ANY. A normal readable stream
    // without atomic selectable admission must not be eligible.
    for a in arms.iter() {
        let i = match a { Arm::Read(i) | Arm::Write(i, _) => *i };
        if !matches!(ports.get(i).map(|p| p.kind), Some(Kind::Channel | Kind::SelectableStream)) {
            return Err(Error::NotSelectable);
        }
    }
    for (index, arm) in arms.iter_mut().enumerate() {
        match arm {
            Arm::Read(i) if !ports[*i].queue.is_empty() || ports[*i].closed => {
                return Ok(Some(Winner { index, value: Some(ports[*i].read()?) }));
            }
            Arm::Write(i, value) if value.is_some() && !ports[*i].closed && ports[*i].queue.len() < ports[*i].capacity => {
                // Match disjoint fields directly: re-matching the whole arm
                // while i is borrowed causes Rust E0503.
                let port = *i;
                let payload = value.take().expect("ready arm owns payload");
                ports[port].write(payload).expect("ready write admitted");
                return Ok(Some(Winner { index, value: None }));
            }
            _ => {}
        }
    }
    // A select with no possibly active operation must terminate instead of
    // waiting forever. Closed writable ports retain any uncommitted payload.
    if arms.is_empty() || arms.iter().all(|arm| match arm {
        Arm::Read(_) => false, // a closed read exposes the explicit EOF outcome above
        Arm::Write(i, _) => ports[*i].closed,
    }) {
        return Err(Error::Closed);
    }
    Ok(None)
}
#[test]
fn stream_plain_io_preserves_backpressure_and_eof() {
    let mut p = Port::new(Kind::OrdinaryStream, 1);
    p.write("one".into()).unwrap();
    assert_eq!(p.write("two".into()), Err((Error::WouldBlock, "two".into())));
    assert_eq!(p.read(), Ok(Read::Data("one".into())));
    assert_eq!(p.read(), Err(Error::WouldBlock));
    p.closed = true;
    assert_eq!(p.read(), Ok(Read::Eof));
    assert_eq!(p.write("x".into()), Err((Error::Closed, "x".into())));
}
#[test]
fn losing_read_consumes_nothing() {
    let mut ports = [Port::new(Kind::Channel, 1), Port::new(Kind::SelectableStream, 1)];
    ports[0].write("a".into()).unwrap(); ports[1].write("b".into()).unwrap();
    let mut arms = [Arm::Read(0), Arm::Read(1)];
    assert_eq!(select(&mut ports, &mut arms), Ok(Some(Winner { index: 0, value: Some(Read::Data("a".into())) })));
    assert_eq!(ports[1].queue.front().map(String::as_str), Some("b"));
}
#[test]
fn losing_write_retains_ownership_and_does_not_publish() {
    let mut ports = [Port::new(Kind::Channel, 1), Port::new(Kind::SelectableStream, 1)];
    let mut arms = [Arm::Write(0, Some("a".into())), Arm::Write(1, Some("b".into()))];
    assert_eq!(select(&mut ports, &mut arms), Ok(Some(Winner { index: 0, value: None })));
    assert_eq!(ports[0].queue.len(), 1);
    assert!(ports[1].queue.is_empty());
    assert!(matches!(&arms[0], Arm::Write(_, None)));
    assert!(matches!(&arms[1], Arm::Write(_, Some(s)) if s == "b"));
}
#[test]
fn blocked_write_remains_owned() {
    let mut ports = [Port::new(Kind::Channel, 1)];
    ports[0].write("full".into()).unwrap();
    let mut arms = [Arm::Write(0, Some("pending".into()))];
    assert_eq!(select(&mut ports, &mut arms), Ok(None));
    assert!(matches!(&arms[0], Arm::Write(_, Some(s)) if s == "pending"));
    assert_eq!(ports[0].queue.front().map(String::as_str), Some("full"));
}
#[test]
fn nonselectable_stream_fails_before_other_writes() {
    let mut ports = [Port::new(Kind::Channel, 1), Port::new(Kind::OrdinaryStream, 1)];
    let mut arms = [Arm::Write(0, Some("a".into())), Arm::Read(1)];
    assert_eq!(select(&mut ports, &mut arms), Err(Error::NotSelectable));
    assert!(ports[0].queue.is_empty());
    assert!(matches!(&arms[0], Arm::Write(_, Some(s)) if s == "a"));
}
#[test]
fn close_not_mistaken_for_data_or_written_value() {
    let mut ports = [Port::new(Kind::SelectableStream, 1), Port::new(Kind::Channel, 1)];
    ports[0].closed = true; ports[1].closed = true;
    let mut arms = [Arm::Read(0), Arm::Write(1, Some("retain".into()))];
    assert_eq!(select(&mut ports, &mut arms), Ok(Some(Winner { index: 0, value: Some(Read::Eof) })));
    assert!(matches!(&arms[1], Arm::Write(_, Some(s)) if s == "retain"));
}


#[test]
fn simultaneous_read_and_write_commit_only_one_arm() {
    let mut ports = [Port::new(Kind::Channel, 1), Port::new(Kind::SelectableStream, 1)];
    ports[0].write("inbox".into()).unwrap();
    let mut arms = [Arm::Read(0), Arm::Write(1, Some("pending".into()))];
    assert_eq!(select(&mut ports, &mut arms),
        Ok(Some(Winner { index: 0, value: Some(Read::Data("inbox".into())) })));
    assert!(ports[0].queue.is_empty());
    assert!(ports[1].queue.is_empty(), "losing write must not publish");
    assert!(matches!(&arms[1], Arm::Write(_, Some(x)) if x == "pending"),
        "losing write must retain ownership");
}

#[test]
fn competing_writes_to_same_bounded_port_never_double_commit() {
    let mut ports = [Port::new(Kind::Channel, 1)];
    let mut arms = [Arm::Write(0, Some("first".into())), Arm::Write(0, Some("second".into()))];
    assert_eq!(select(&mut ports, &mut arms), Ok(Some(Winner { index: 0, value: None })));
    assert_eq!(ports[0].queue.len(), 1);
    assert_eq!(ports[0].queue.front().map(String::as_str), Some("first"));
    assert!(matches!(&arms[0], Arm::Write(_, None)));
    assert!(matches!(&arms[1], Arm::Write(_, Some(x)) if x == "second"));
    // Re-registration against a full port must not accidentally publish.
    assert_eq!(select(&mut ports, &mut arms), Ok(None));
    assert_eq!(ports[0].queue.len(), 1);
    assert!(matches!(&arms[1], Arm::Write(_, Some(x)) if x == "second"));
}

#[test]
fn abandoning_a_blocked_selection_has_no_ghost_write() {
    let mut ports = [Port::new(Kind::Channel, 1)];
    ports[0].write("existing".into()).unwrap();
    {
        let mut arms = [Arm::Write(0, Some("cancelled".into()))];
        assert_eq!(select(&mut ports, &mut arms), Ok(None));
        assert!(matches!(&arms[0], Arm::Write(_, Some(x)) if x == "cancelled"));
    }
    assert_eq!(ports[0].read(), Ok(Read::Data("existing".into())));
    assert_eq!(ports[0].read(), Err(Error::WouldBlock));
    let mut arms = [Arm::Write(0, Some("next".into()))];
    assert_eq!(select(&mut ports, &mut arms), Ok(Some(Winner { index: 0, value: None })));
    assert_eq!(ports[0].read(), Ok(Read::Data("next".into())));
}

#[test]
fn close_during_pending_write_cannot_steal_or_publish_value() {
    let mut ports = [Port::new(Kind::Channel, 1)];
    ports[0].write("full".into()).unwrap();
    let mut arms = [Arm::Write(0, Some("not-published".into()))];
    assert_eq!(select(&mut ports, &mut arms), Ok(None));
    ports[0].closed = true;
    assert_eq!(select(&mut ports, &mut arms), Err(Error::Closed));
    assert_eq!(ports[0].queue.len(), 1);
    assert!(matches!(&arms[0], Arm::Write(_, Some(x)) if x == "not-published"));
}

#[test]
fn invalid_port_disables_all_select_effects() {
    let mut ports = [Port::new(Kind::Channel, 1)];
    let mut arms = [Arm::Write(0, Some("keep".into())), Arm::Read(99)];
    assert_eq!(select(&mut ports, &mut arms), Err(Error::NotSelectable));
    assert!(ports[0].queue.is_empty());
    assert!(matches!(&arms[0], Arm::Write(_, Some(x)) if x == "keep"));
}

#[test]
fn closed_stream_is_terminal_not_phantom_data() {
    let mut ports = [Port::new(Kind::SelectableStream, 1)];
    ports[0].closed = true;
    let mut arms = [Arm::Read(0)];
    let winner = select(&mut ports, &mut arms).unwrap().unwrap();
    assert_eq!(winner.value, Some(Read::Eof));
    assert_ne!(winner.value, Some(Read::Data(String::new())));
}

#[test]
fn fully_closed_write_only_selection_terminates_without_consuming_payload() {
    let mut ports = [Port::new(Kind::Channel, 1), Port::new(Kind::SelectableStream, 1)];
    ports[0].closed = true;
    ports[1].closed = true;
    let mut arms = [
        Arm::Write(0, Some("left".into())),
        Arm::Write(1, Some("right".into())),
    ];
    assert_eq!(select(&mut ports, &mut arms), Err(Error::Closed));
    assert!(ports.iter().all(|p| p.queue.is_empty()));
    assert!(matches!(&arms[0], Arm::Write(_, Some(v)) if v == "left"));
    assert!(matches!(&arms[1], Arm::Write(_, Some(v)) if v == "right"));
}

#[test]
fn mixed_closed_and_live_select_stays_pending_when_live_arm_could_wake() {
    let mut ports = [Port::new(Kind::Channel, 1), Port::new(Kind::SelectableStream, 1)];
    ports[0].closed = true;
    let mut arms = [Arm::Write(0, Some("retained".into())), Arm::Read(1)];
    assert_eq!(select(&mut ports, &mut arms), Ok(None));
    assert!(matches!(&arms[0], Arm::Write(_, Some(v)) if v == "retained"));
}


#[test]
fn competing_reads_on_same_channel_consume_one_message_per_selection() {
    let mut ports = [Port::new(Kind::Channel, 1)];
    ports[0].write("single".into()).unwrap();
    let mut arms = [Arm::Read(0), Arm::Read(0)];
    assert_eq!(select(&mut ports, &mut arms),
        Ok(Some(Winner { index: 0, value: Some(Read::Data("single".into())) })));
    assert_eq!(ports[0].read(), Err(Error::WouldBlock),
        "a losing read must not dequeue the same message");
    assert_eq!(select(&mut ports, &mut arms), Ok(None),
        "both reads should be blocked until a new message arrives");
    ports[0].write("next".into()).unwrap();
    assert_eq!(select(&mut ports, &mut arms),
        Ok(Some(Winner { index: 0, value: Some(Read::Data("next".into())) })));
}

#[test]
fn full_channel_read_wins_then_retained_write_can_commit_once() {
    let mut ports = [Port::new(Kind::Channel, 1)];
    ports[0].write("old".into()).unwrap();
    let mut arms = [Arm::Write(0, Some("new".into())), Arm::Read(0)];
    // The bounded port is full: writing cannot win before a reader makes space.
    assert_eq!(select(&mut ports, &mut arms),
        Ok(Some(Winner { index: 1, value: Some(Read::Data("old".into())) })));
    assert!(ports[0].queue.is_empty());
    assert!(matches!(&arms[0], Arm::Write(_, Some(v)) if v == "new"),
        "the losing write must keep its payload");
    assert_eq!(select(&mut ports, &mut arms),
        Ok(Some(Winner { index: 0, value: None })));
    assert_eq!(ports[0].queue.len(), 1);
    assert_eq!(ports[0].read(), Ok(Read::Data("new".into())));
    // The committed write has no payload and cannot run again.
    assert_eq!(select(&mut ports, &mut arms), Ok(None));
}

#[test]
fn closed_port_validation_precedes_ready_channel_read() {
    let mut ports = [Port::new(Kind::Channel, 1)];
    ports[0].write("safe".into()).unwrap();
    let mut arms = [Arm::Read(0), Arm::Write(42, Some("invalid".into()))];
    assert_eq!(select(&mut ports, &mut arms), Err(Error::NotSelectable));
    assert_eq!(ports[0].queue.front().map(String::as_str), Some("safe"));
    assert!(matches!(&arms[1], Arm::Write(_, Some(v)) if v == "invalid"));
}
