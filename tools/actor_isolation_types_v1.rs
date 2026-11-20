//! Host-only reference policy for AttoLang actor isolation *targets*.
//! This executable never compiles `.atto` nor mints an actual TenantVM capability.
#![forbid(unsafe_code)]
use std::collections::HashSet;
#[cfg(not(test))]
use std::{fs, path::Path};

#[derive(Clone, Debug)]
enum Shape {
    Scalar,
    Unique(Box<Shape>),
    Frozen(Box<Shape>),
    Product(Vec<Shape>),
    Borrowed,
    MutableAlias,
    Pointer,
    StateLease,
    Socket,
    ActorRef,
    CodecOnly,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Mode { Move, Share, Delegate, Wire }
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Route { SameTenant, CrossTenant }
#[derive(Clone, Copy, Debug)]
struct Request {
    mode: Mode,
    route: Route,
    grant: bool,
    generation_current: bool,
    wire_schema: bool,
}
const LOAN: &str = "E_ACTOR_BORROW_ESCAPE";
const CAP: &str = "E_ACTOR_CAPABILITY_ESCAPE";
const NOT_SEND: &str = "E_ACTOR_SEND_NOT_SENDABLE";
const NOT_SHARE: &str = "E_ACTOR_SHARE_NOT_SHAREABLE";
const DENY: &str = "E_TENANT_MESSAGE_DENIED";
const STALE: &str = "E_ACTOR_STALE_REF";
const SCHEMA: &str = "E_WIRE_SCHEMA_REQUIRED";

// The shape is a stand-in for a *compiler-authenticated* reachability graph.
// These names in the fixture are NOT runtime type tags and grant no authority.
fn shape(key: &str) -> Result<Shape, String> {
    use Shape::*;
    let s = match key {
        "scalar" => Scalar,
        "unique_owned" => Unique(Box::new(Product(vec![Scalar, Scalar]))),
        "frozen_arc" => Frozen(Box::new(Product(vec![Scalar, Scalar]))),
        "record_safe" => Product(vec![Scalar, Unique(Box::new(Scalar))]),
        "result_safe" => Product(vec![Scalar, Product(vec![Scalar, Scalar])]),
        "borrowed" => Borrowed,
        "mutable_alias" => MutableAlias,
        "pointer" => Pointer,
        "state_lease" => StateLease,
        "socket" => Socket,
        "codec_only" => CodecOnly,
        "record_nested_pointer" => Product(vec![Scalar, Product(vec![Scalar, Pointer])]),
        "frozen_arc_mutable" => Frozen(Box::new(Product(vec![Scalar, MutableAlias]))),
        "actor_ref" => ActorRef,
        "result_nested_borrow" => Product(vec![Scalar, Product(vec![Scalar, Borrowed])]),
        "option_nested_socket" => Product(vec![Scalar, Socket]),
        _ => return Err(format!("unknown type-graph descriptor: {key}")),
    };
    Ok(s)
}
#[cfg(test)]
fn first_forbidden(s: &Shape) -> Option<&'static str> {
    use Shape::*;
    match s {
        Scalar | CodecOnly => None,
        Unique(v) | Frozen(v) => first_forbidden(v),
        Product(vs) => vs.iter().find_map(first_forbidden),
        Borrowed | StateLease => Some(LOAN),
        Pointer | Socket | ActorRef => Some(CAP),
        MutableAlias => Some(NOT_SEND),
    }
}
fn move_proof(s: &Shape) -> Result<(), &'static str> {
    use Shape::*;
    match s {
        Scalar => Ok(()),
        Unique(v) => move_proof(v),
        Product(xs) => xs.iter().try_for_each(move_proof),
        Frozen(v) => { // A frozen owner can be transferred as data, never aliased implicitly.
            frozen_graph_proof(v)
        }
        Borrowed | StateLease => Err(LOAN),
        Pointer | Socket | ActorRef => Err(CAP),
        MutableAlias | CodecOnly => Err(NOT_SEND),
    }
}
fn frozen_graph_proof(s: &Shape) -> Result<(), &'static str> {
    use Shape::*;
    match s {
        Scalar => Ok(()),
        Product(xs) => xs.iter().try_for_each(frozen_graph_proof),
        Frozen(v) => frozen_graph_proof(v),
        Borrowed | StateLease => Err(LOAN),
        Pointer | Socket | ActorRef => Err(CAP),
        Unique(_) | MutableAlias | CodecOnly => Err(NOT_SHARE),
    }
}
fn share_proof(s: &Shape) -> Result<(), &'static str> {
    match s {
        Shape::Frozen(v) => frozen_graph_proof(v),
        Shape::Borrowed | Shape::StateLease => Err(LOAN),
        _ => Err(NOT_SHARE),
    }
}
fn wire_proof(s: &Shape) -> Result<(), &'static str> {
    use Shape::*;
    match s {
        Scalar | CodecOnly => Ok(()), // CodecOnly still requires a reviewed schema/decoder.
        Unique(v) => wire_proof(v), // Independent decode, never shared host address.
        Frozen(v) => { frozen_graph_proof(v)?; wire_proof(v) },
        Product(xs) => xs.iter().try_for_each(wire_proof),
        Borrowed | StateLease => Err(LOAN),
        Pointer | Socket | ActorRef => Err(CAP),
        MutableAlias => Err(NOT_SEND),
    }
}

fn authorize(s: &Shape, r: Request) -> Result<(), &'static str> {
    // A scheduler/broker authenticates these fields; a guest may not provide them.
    if !r.generation_current { return Err(STALE); }
    if !r.grant { return Err(DENY); }
    if (r.route == Route::CrossTenant) != (r.mode == Mode::Wire) { return Err(DENY); }
    match r.mode {
        Mode::Move => move_proof(s),
        Mode::Share => share_proof(s),
        // A nominal ActorRef shape is never itself a delegation credential.
        // A host-minted, incarnation-scoped authority is required; the separate
        // broker reference model checks that evidence. Bare shape must fail closed.
        Mode::Delegate => Err(CAP),
        Mode::Wire => {
            if !r.wire_schema { return Err(SCHEMA); }
            // A forbidden leaf cannot be laundered through a user codec or generic wrapper.
            wire_proof(s)
        }
    }
}
fn parse_bool(value: &str) -> Result<bool, String> {
    match value { "yes" => Ok(true), "no" => Ok(false), _ => Err(format!("invalid boolean {value}")) }
}
fn parse_mode(s: &str) -> Result<Mode, String> {
    match s { "move" => Ok(Mode::Move), "share" => Ok(Mode::Share), "delegate" => Ok(Mode::Delegate), "wire" => Ok(Mode::Wire), _ => Err(format!("invalid mode {s}")) }
}
fn parse_route(s: &str) -> Result<Route, String> {
    match s { "same" => Ok(Route::SameTenant), "cross" => Ok(Route::CrossTenant), _ => Err(format!("invalid route {s}")) }
}
fn verify_registry(content: &str) -> Result<usize, String> {
    let mut seen = HashSet::new();
    for line in content.lines().filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let p: Vec<_> = line.split('\t').collect();
        if p.len() != 9 { return Err("registry row must have nine columns".into()); }
        let id: usize = p[0].strip_prefix("AI-").ok_or("bad id")?
            .parse().map_err(|_| "bad id number")?;
        if !(1..=36).contains(&id) || !seen.insert(id) { return Err("duplicate/out-of-range id".into()); }
        if p[8] != "NOT_EXECUTED" { return Err("falsified backend evidence".into()); }
        let sh = shape(p[1])?;
        let req = Request { mode: parse_mode(p[2])?, route: parse_route(p[3])?,
            grant: parse_bool(p[4])?, generation_current: parse_bool(p[5])?,
            wire_schema: parse_bool(p[6])? };
        let got = authorize(&sh, req).err().unwrap_or("ALLOW");
        if got != p[7] { return Err(format!("{}: expected {}, got {}", p[0], p[7], got)); }
    }
    if seen.len() != 36 || !(1..=36).all(|id| seen.contains(&id)) {
        return Err("missing isolation cases".into());
    }
    Ok(seen.len())
}
#[cfg(not(test))]
fn main() {
    let source = fs::read_to_string(Path::new("contracts/actor-isolation-types-v1.tsv"))
        .expect("read source-only isolation contract");
    match verify_registry(&source) {
        Ok(n) => println!("{n} actor-isolation SOURCE_ONLY targets validated; NO compiled Atto guest proof"),
        Err(e) => { eprintln!("{e}"); std::process::exit(1); }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    const MATRIX: &str = include_str!("../contracts/actor-isolation-types-v1.tsv");
    #[test] fn entire_registry_matches_reference_policy() { assert_eq!(verify_registry(MATRIX), Ok(36)); }
    #[test] fn incomplete_registry_is_rejected() {
        let changed = MATRIX.lines().filter(|l| !l.starts_with("AI-036"))
            .collect::<Vec<_>>().join("\n");
        assert!(verify_registry(&changed).is_err());
    }
    #[test] fn false_pass_is_rejected() {
        assert!(verify_registry(&MATRIX.replace("NOT_EXECUTED", "PASS")).is_err());
    }
    #[test] fn nested_pointer_cannot_be_laundered_by_wire_codec() {
        let nested = shape("record_nested_pointer").unwrap();
        let req = Request { mode: Mode::Wire, route: Route::CrossTenant,
            grant: true, generation_current: true, wire_schema: true };
        assert_eq!(authorize(&nested, req), Err(CAP));
    }
    #[test] fn same_tenant_owned_move_cannot_be_used_as_frozen_share() {
        let owned = shape("unique_owned").unwrap();
        let move_req = Request { mode: Mode::Move, route: Route::SameTenant,
            grant: true, generation_current: true, wire_schema: false };
        assert_eq!(authorize(&owned, move_req), Ok(()));
        assert_eq!(authorize(&owned, Request { mode: Mode::Share, ..move_req }), Err(NOT_SHARE));
    }
    #[test] fn cross_tenant_requires_broker_and_fresh_decode_not_arc_alias() {
        let frozen = shape("frozen_arc").unwrap();
        let req = Request { mode: Mode::Wire, route: Route::CrossTenant,
            grant: true, generation_current: true, wire_schema: true };
        assert_eq!(authorize(&frozen, req), Ok(()));
        assert_eq!(authorize(&frozen, Request { mode: Mode::Share, ..req }), Err(DENY));
        assert_eq!(authorize(&frozen, Request { grant: false, ..req }), Err(DENY));
    }
    #[test] fn live_actor_ref_requires_auth_and_generation() {
        let reference = Shape::ActorRef;
        let req = Request { mode: Mode::Delegate, route: Route::SameTenant,
            grant: true, generation_current: true, wire_schema: false };
        assert_eq!(authorize(&reference, req), Ok(()));
        assert_eq!(authorize(&reference, Request { generation_current: false, ..req }), Err(STALE));
        assert_eq!(authorize(&reference, Request { grant: false, ..req }), Err(DENY));
        assert_eq!(authorize(&reference, Request { route: Route::CrossTenant, ..req }), Err(DENY));
    }
    #[test] fn no_serializer_can_convert_lease_or_socket_to_data() {
        let req = Request { mode: Mode::Wire, route: Route::CrossTenant,
            grant: true, generation_current: true, wire_schema: true };
        assert_eq!(authorize(&Shape::StateLease, req), Err(LOAN));
        assert_eq!(authorize(&Shape::Socket, req), Err(CAP));
    }
    #[test] fn both_sum_variants_are_checked_even_if_runtime_branch_is_safe() {
        let result = shape("result_nested_borrow").unwrap();
        let req = Request { mode: Mode::Move, route: Route::SameTenant,
            grant: true, generation_current: true, wire_schema: false };
        assert_eq!(authorize(&result, req), Err(LOAN));
    }
    #[test] fn unknown_shapes_fail_closed() { assert!(shape("UserClaimsSendable<Pointer<int>>").is_err()); }
    #[test] fn diagnostic_spoofing_in_registry_is_detected() {
        let altered = MATRIX.replacen("E_ACTOR_CAPABILITY_ESCAPE", "ALLOW", 1);
        assert!(verify_registry(&altered).is_err());
    }
    #[test] fn first_forbidden_walks_nested_fields() {
        let s = shape("option_nested_socket").unwrap();
        assert_eq!(first_forbidden(&s), Some(CAP));
    }
}
