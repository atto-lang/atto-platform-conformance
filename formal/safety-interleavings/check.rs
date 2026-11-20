//! Exhaustive finite-state safety check; not an unbounded or implementation proof.
use std::collections::{HashSet, VecDeque};
use std::fmt::Debug;
use std::hash::Hash;

fn explore<S: Clone + Eq + Hash + Debug>(
    initial: S,
    next: impl Fn(&S) -> Vec<(&'static str, S)>,
    invariant: impl Fn(&S) -> bool,
) -> Result<(usize, usize), Vec<&'static str>> {
    assert!(invariant(&initial), "invalid initial state");
    let mut seen = HashSet::from([initial.clone()]);
    let mut queue = VecDeque::from([(initial, Vec::new())]);
    let mut edges = 0;
    while let Some((state, trace)) = queue.pop_front() {
        for (action, successor) in next(&state) {
            edges += 1;
            let mut path = trace.clone();
            path.push(action);
            if !invariant(&successor) {
                eprintln!("counterexample {path:?}: {successor:?}");
                return Err(path);
            }
            if seen.insert(successor.clone()) {
                assert!(
                    seen.len() <= 200_000,
                    "state budget exceeded: incomplete exploration"
                );
                queue.push_back((successor, path));
            }
        }
    }
    println!("bounded fixed point: {} states, {edges} edges", seen.len());
    Ok((seen.len(), edges))
}

#[derive(Clone, Debug, Hash, Eq, PartialEq)]
struct State {
    mode: [u8; 3],
    done: [bool; 3],
}
// Three callbacks, each may request read (1) or write (2) once.
fn transitions(s: &State, ignore_readers: bool) -> Vec<(&'static str, State)> {
    let mut out = vec![];
    for i in 0..3 {
        if s.mode[i] != 0 {
            let mut n = s.clone();
            n.mode[i] = 0;
            n.done[i] = true;
            out.push(("release", n));
        } else if !s.done[i] {
            if !s.mode.contains(&2) {
                let mut n = s.clone();
                n.mode[i] = 1;
                out.push(("critical-read", n));
            }
            if !s.mode.contains(&2) && (ignore_readers || !s.mode.contains(&1)) {
                let mut n = s.clone();
                n.mode[i] = 2;
                out.push(("critical-write", n));
            }
        }
    }
    out
}
fn valid(s: &State) -> bool {
    let writers = s.mode.iter().filter(|m| **m == 2).count();
    writers <= 1 && (writers == 0 || s.mode.iter().filter(|m| **m != 0).count() == 1)
}
#[test]
fn readers_share_and_writers_exclude_all_callbacks() {
    let initial = State {
        mode: [0; 3],
        done: [false; 3],
    };
    assert_eq!(
        explore(initial.clone(), |s| transitions(s, false), valid).unwrap(),
        (39, 78)
    );
    let mut s = initial;
    for i in 0..3 {
        s = transitions(&s, false)
            .into_iter()
            .find(|(a, n)| *a == "critical-read" && n.mode[i] == 1)
            .unwrap()
            .1;
    }
    assert_eq!(s.mode, [1; 3]);
}
#[test]
fn writer_that_ignores_readers_is_rejected() {
    let trace = explore(
        State {
            mode: [0; 3],
            done: [false; 3],
        },
        |s| transitions(s, true),
        valid,
    )
    .unwrap_err();
    assert_eq!(trace, vec!["critical-read", "critical-write"]);
}
