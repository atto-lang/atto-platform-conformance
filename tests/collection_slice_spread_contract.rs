//! Rust-only reference-semantic checks. No AttoLang guest is compiled or executed.
//! The contract's JSON shape is validated separately with jq in CI; these tests
//! check the candidate algorithms, not backend conformance.
const CONTRACT: &str = include_str!("../contracts/collection-slice-spread-v1.json");

fn index(len: usize, raw: i64) -> Result<usize, &'static str> {
    let n = i64::try_from(len).map_err(|_| "E_INDEX_BOUNDS")?;
    if raw < -n || raw >= n {
        return Err("E_INDEX_BOUNDS");
    }
    let i = if raw < 0 { n.checked_add(raw).ok_or("E_INDEX_BOUNDS")? } else { raw };
    usize::try_from(i).map_err(|_| "E_INDEX_BOUNDS")
}

fn explicit_bound(len: i64, raw: i64) -> Result<i64, &'static str> {
    if raw < -len || raw > len {
        return Err("E_SLICE_BOUNDS");
    }
    if raw < 0 { len.checked_add(raw).ok_or("E_SLICE_BOUNDS") } else { Ok(raw) }
}

fn slice<T: Copy>(src: &[T], start: Option<i64>, end: Option<i64>, step: i64) -> Result<Vec<T>, &'static str> {
    if step == 0 { return Err("E_SLICE_STEP_ZERO"); }
    let n = i64::try_from(src.len()).map_err(|_| "E_SLICE_BOUNDS")?;
    let forward = step > 0;
    let from = match start {
        Some(value) => explicit_bound(n, value)?,
        None if forward => 0,
        None => n - 1,
    };
    // End -1 is a special sentinel ONLY for an omitted reverse end.
    let to = match end {
        Some(value) => explicit_bound(n, value)?,
        None if forward => n,
        None => -1,
    };
    if !forward && n > 0 && from >= n { return Err("E_SLICE_BOUNDS"); }
    let mut out = Vec::new();
    let mut at = from;
    while if forward { at < to } else { at > to } {
        let idx = usize::try_from(at).map_err(|_| "E_SLICE_BOUNDS")?;
        let element = src.get(idx).ok_or("E_SLICE_BOUNDS")?;
        out.push(*element);
        at = at.checked_add(step).ok_or("E_SLICE_BOUNDS")?;
    }
    Ok(out)
}

#[test]
fn contract_is_candidate_only_and_has_distinct_positive_and_negative_vectors() {
    assert!(CONTRACT.contains("\"schema\": \"atto.collection-slice-spread.v1\""));
    assert!(CONTRACT.contains("\"status\": \"TARGET_ONLY_NOT_EXECUTED\""));
    assert_eq!(CONTRACT.matches("\"guest_status\": \"NOT_EXECUTED\"").count(), 33);
    assert!(CONTRACT.contains("\"id\": \"slice-negative-explicit-end\""));
    assert!(CONTRACT.contains("\"id\": \"actor-borrow-escape\""));
    assert!(CONTRACT.contains("\"id\": \"spread-outside-context\""));
}
#[test]
fn negative_indices_are_bounds_checked() {
    assert_eq!(index(5, 0), Ok(0));
    assert_eq!(index(5, -1), Ok(4));
    assert_eq!(index(5, -5), Ok(0));
    assert_eq!(index(5, 5), Err("E_INDEX_BOUNDS"));
    assert_eq!(index(5, -6), Err("E_INDEX_BOUNDS"));
    assert_eq!(index(0, 0), Err("E_INDEX_BOUNDS"));
}
#[test]
fn half_open_slice_and_defaults() {
    let a = [10, 20, 30, 40, 50];
    assert_eq!(slice(&a, Some(1), Some(4), 1), Ok(vec![20, 30, 40]));
    assert_eq!(slice(&a, None, Some(3), 1), Ok(vec![10, 20, 30]));
    assert_eq!(slice(&a, Some(2), None, 1), Ok(vec![30, 40, 50]));
    assert_eq!(slice(&a, None, None, 1), Ok(a.to_vec()));
    assert_eq!(slice(&a, Some(4), Some(1), 1), Ok(vec![]));
}
#[test]
fn stride_reverse_and_negative_end_sentinel() {
    let a = [10, 20, 30, 40, 50];
    assert_eq!(slice(&a, None, None, 2), Ok(vec![10, 30, 50]));
    assert_eq!(slice(&a, None, None, -1), Ok(vec![50, 40, 30, 20, 10]));
    assert_eq!(slice(&a, Some(4), Some(0), -2), Ok(vec![50, 30]));
    assert_eq!(slice(&a, Some(4), Some(-1), -1), Ok(vec![]));
    assert_eq!(slice(&a, Some(-1), None, -1), Ok(vec![50, 40, 30, 20, 10]));
}
#[test]
fn zero_step_and_explicit_bounds_are_not_clamped() {
    let a = [1, 2];
    assert_eq!(slice(&a, None, None, 0), Err("E_SLICE_STEP_ZERO"));
    assert_eq!(slice(&a, Some(0), Some(3), 1), Err("E_SLICE_BOUNDS"));
    assert_eq!(slice(&a, Some(-3), None, 1), Err("E_SLICE_BOUNDS"));
    assert_eq!(slice(&a, Some(2), None, -1), Err("E_SLICE_BOUNDS"));
    assert_eq!(slice(&a, Some(0), Some(2), 1), Ok(vec![1, 2]));
}
#[test]
fn empty_collections_are_valid_slices_not_indexes() {
    let a: [i32; 0] = [];
    assert_eq!(slice(&a, None, None, 1), Ok(vec![]));
    assert_eq!(slice(&a, None, None, -1), Ok(vec![]));
    assert_eq!(index(0, -1), Err("E_INDEX_BOUNDS"));
}
#[test]
fn unicode_scalar_indexing_is_not_utf8_byte_indexing() {
    let s = "héllo";
    assert_ne!(s.chars().count(), s.len());
    let c: Vec<char> = s.chars().collect();
    assert_eq!(c[index(c.len(), 1).unwrap()], 'é');
    let first_two = slice(&c, None, Some(2), 1).unwrap();
    assert_eq!(first_two.into_iter().collect::<String>(), "hé");
    let reversed = slice(&c, None, None, -1).unwrap();
    assert_eq!(reversed.into_iter().collect::<String>(), "olléh");
}
#[test]
fn spread_preserves_order_and_excludes_implicit_object_clone() {
    let a = [1, 2];
    let b = [3, 4];
    let result: Vec<i32> = std::iter::once(0).chain(a.iter().copied())
        .chain(b.iter().copied()).chain(std::iter::once(5)).collect();
    assert_eq!(result, [0, 1, 2, 3, 4, 5]);
}
