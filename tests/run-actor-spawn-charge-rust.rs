//! Compile alongside the backend's actor_spawn_charge_plan.rs; feed shared TSV on stdin.
mod actor_spawn_charge_plan;
use actor_spawn_charge_plan::*;
use std::io::{self, BufRead};
use std::collections::HashSet;
fn affinity(s: &str) -> Affinity {
    match s { "none" => Affinity::None, "sticky" => Affinity::Sticky, "pinned" => Affinity::Pinned, _ => panic!("bad vector affinity") }
}
fn optional<T>(s: &str, decode: impl FnOnce(&str) -> T) -> Option<T> {
    if s == "-" { None } else { Some(decode(s)) }
}
fn i32v(s: &str) -> i32 { s.parse().expect("invalid i32") }
fn i64v(s: &str) -> i64 { s.parse().expect("invalid i64") }
fn main() {
    let mut ids = HashSet::new();
    let (mut accept, mut deny) = (0, 0);
    for line in io::stdin().lock().lines() {
        let line = line.expect("read vector");
        if line.is_empty() || line.starts_with('#') { continue; }
        let v: Vec<_> = line.split('\t').collect();
        assert_eq!(v.len(), 19);
        assert!(ids.insert(v[0].to_owned()), "duplicate case {}", v[0]);
        let p = Policy { serial: match v[1] { "0" => false, "1" => true, _ => panic!("bad serial") },
            carrier_cap: i32v(v[2]), default_carriers: i32v(v[3]), live_stack_slots: i64v(v[4]),
            heap_limit: i64v(v[5]), stack_limit: i64v(v[6]), mailbox_messages_limit: i64v(v[7]),
            mailbox_byte_charge: i64v(v[8]) };
        let d = Defaults { affinity: affinity(v[9]), heap_bytes: i64v(v[10]), stack_bytes: i64v(v[11]), mailbox_messages: i64v(v[12]) };
        let r = Request { carriers: optional(v[13], i32v), affinity: optional(v[14], affinity),
            heap_bytes: optional(v[15], i64v), stack_bytes: optional(v[16], i64v), mailbox_messages: optional(v[17], i64v) };
        let actual = match resolve(p, d, r) {
            Ok(x) => { accept += 1; let a = match x.affinity { Affinity::None => "none", Affinity::Sticky => "sticky", Affinity::Pinned => "pinned" };
                format!("{},{},{},{},{},{},{}", x.carrier_cap, a, x.stack_bytes, x.heap, x.stacks, x.mailbox_bytes, x.messages) }
            Err(code) => { deny += 1; code.to_owned() }
        };
        assert_eq!(actual, v[18], "case {}", v[0]);
    }
    assert_eq!((ids.len(), accept, deny), (25, 6, 19));
    println!("SPAWN_CHARGE_RUST_HOST_PASS 6 accepts 19 denials; no guest execution");
}
