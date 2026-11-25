//! Typed actor application-message policy oracle. SOURCE_ONLY; NOT guest execution.
#![forbid(unsafe_code)]
use std::{collections::HashSet, fs, path::Path};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Message { Work, Reply, Audit, Control }
struct Protocol<'a> { receives: &'a [Message], sends: &'a [Message] }
fn application_send(from: &Protocol<'_>, to: &Protocol<'_>, value: Message)
    -> Result<(), &'static str> {
    if value == Message::Control { return Err("CONTROL requires supervisor authority"); }
    if !from.sends.contains(&value) { return Err("sends effect mismatch"); }
    if !to.receives.contains(&value) { return Err("receives protocol mismatch"); }
    Ok(())
}
const EXPECTED: [&str; 15] = [
    "ACCEPT","REJECT","ACCEPT","ACCEPT","REJECT",
    "ACCEPT","ACCEPT","REJECT","ACCEPT","REJECT",
    "ACCEPT","REJECT","REJECT","REJECT","REJECT",
];
fn verify(root: &Path) -> Result<usize, String> {
    let text = fs::read_to_string(root.join("contracts/typed-actor-v1.tsv"))
        .map_err(|e| e.to_string())?;
    let mut seen = HashSet::new();
    for row in text.lines().filter(|s| !s.is_empty() && !s.starts_with('#')) {
        let parts: Vec<_> = row.split('\t').collect();
        if parts.len() != 5 { return Err("invalid row".into()); }
        let n: usize = parts[0].strip_prefix("ACTOR-TYPED-")
            .ok_or("invalid case ID")?.parse().map_err(|_| "invalid case number")?;
        if !(1..=15).contains(&n) || !seen.insert(n) { return Err("duplicate or out-of-range case".into()); }
        if parts[1] != EXPECTED[n-1] || parts[2] != "NOT_EXECUTED"
            || parts[4] != "SOURCE_ONLY" {
            return Err(format!("invalid evidence label or expectation: {n}"));
        }
        let path = format!("fixtures/typed-actor-v1/actor-typed-{n:02}.atto");
        if parts[3] != path { return Err(format!("unrecognized path: {n}")); }
        let source = fs::read_to_string(root.join(path)).map_err(|e| e.to_string())?;
        if source.len() > 65536 || !source.contains("define actor ") {
            return Err(format!("invalid source fixture: {n}"));
        }
    }
    if seen.len() != 15 { return Err("incomplete matrix".into()); }
    Ok(seen.len())
}
fn main() {
    match verify(Path::new(".")) {
        Ok(n) => println!("{n} SOURCE_ONLY cases validated (NO guest execution)"),
        Err(e) => { eprintln!("{e}"); std::process::exit(1); },
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn one_supervisor_many_downstream_receivers() {
        let from = Protocol { receives: &[], sends: &[Message::Work,Message::Reply] };
        let a = Protocol { receives: &[Message::Work], sends: &[] };
        let b = Protocol { receives: &[Message::Work], sends: &[] };
        assert_eq!(application_send(&from,&a,Message::Work),Ok(()));
        assert_eq!(application_send(&from,&b,Message::Work),Ok(()));
    }
    #[test] fn outgoing_type_does_not_override_destination_type() {
        let from = Protocol { receives: &[], sends: &[Message::Work,Message::Audit] };
        let audit = Protocol { receives: &[Message::Audit], sends: &[] };
        assert_eq!(application_send(&from,&audit,Message::Work),Err("receives protocol mismatch"));
    }
    #[test] fn outbound_effect_must_authorize_message() {
        let from = Protocol { receives: &[], sends: &[Message::Work] };
        let audit = Protocol { receives: &[Message::Audit], sends: &[] };
        assert_eq!(application_send(&from,&audit,Message::Audit),Err("sends effect mismatch"));
    }
    #[test] fn control_is_never_ordinary_application_data() {
        let from = Protocol { receives: &[], sends: &[Message::Control] };
        let parent = Protocol { receives: &[Message::Control], sends: &[] };
        assert_eq!(application_send(&from,&parent,Message::Control),
                   Err("CONTROL requires supervisor authority"));
    }
    #[test] fn no_sends_is_not_any() {
        let from = Protocol { receives: &[], sends: &[] };
        let dst = Protocol { receives: &[Message::Work], sends: &[] };
        assert!(application_send(&from,&dst,Message::Work).is_err());
    }
    #[test] fn all_cases_are_unexecuted() { assert_eq!(verify(Path::new(".")),Ok(15)); }
}
