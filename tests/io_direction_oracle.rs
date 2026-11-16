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
            Arm::Write(i, Some(_)) if !ports[*i].closed && ports[*i].queue.len() < ports[*i].capacity => {
                if let Arm::Write(_, value) = arm {
                    ports[*i].write(value.take().unwrap()).expect("ready write admitted");
                }
                return Ok(Some(Winner { index, value: None }));
            }
            _ => {}
        }
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
