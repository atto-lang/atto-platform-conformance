// Rust-only, source-free candidate oracle for bounded NativeAOT layout hints.
// This does NOT execute a compiler, actor scheduler, guest, or native allocator.
use std::collections::HashSet;

const MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SAMPLES: u64 = 4096;

fn choose(
    rows: u64, fields: u64, lanes: u64,
    observed_row: u64, observed_column: u64, observed_random: u64,
) -> Result<&'static str, &'static str> {
    if rows == 0 || rows > i32::MAX as u64 || fields == 0 || fields > 4096 {
        return Err("invalid dimensions");
    }
    if lanes == 0 || lanes > 1024 || !lanes.is_power_of_two() {
        return Err("invalid tile");
    }
    let logical = rows.checked_mul(fields)
        .and_then(|v| v.checked_mul(8))
        .ok_or("layout overflow")?;
    if logical > MAX_BYTES {
        return Err("native shard quota");
    }
    // Match the candidate's single-writer bounded observation order.
    let row = observed_row.min(MAX_SAMPLES);
    let col = observed_column.min(MAX_SAMPLES - row);
    let random = observed_random.min(MAX_SAMPLES - row - col);
    let total = row + col + random;

    if total >= 64 && col >= 64 && col >= 2 * row && col >= 2 * random {
        return Ok("soa");
    }
    let padded_rows = rows.checked_add(lanes - 1)
        .ok_or("layout overflow")? / lanes * lanes;
    let padded = padded_rows.checked_mul(fields)
        .and_then(|v| v.checked_mul(8))
        .ok_or("layout overflow")?;
    if total >= 64 && row >= 64 && fields >= 2 &&
        lanes >= 2 && rows >= 2 * lanes && row >= 2 * col &&
        row >= 2 * random && padded <= MAX_BYTES {
        return Ok("aosoa");
    }
    Ok("aos")
}

#[test]
fn candidate_profile_vectors_are_unique_and_well_formed() {
    let source = include_str!("../contracts/v1/aot-profiled-shard-layout-v1.tsv");
    let mut seen = HashSet::new();
    let mut tested = 0;
    for (line_number, line) in source.lines().enumerate() {
        if line.is_empty() || line.starts_with('#') || line.starts_with("id|") {
            continue;
        }
        let cells: Vec<_> = line.split('|').collect();
        assert_eq!(cells.len(), 8, "invalid width at line {}", line_number + 1);
        let id = cells[0];
        assert!(!id.is_empty() && id.bytes().all(|b|
            b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'),
            "invalid candidate id");
        assert!(seen.insert(id), "duplicate candidate id {id}");
        let numbers: Vec<u64> = cells[1..7].iter()
            .map(|v| v.parse::<u64>().expect("canonical numeric field"))
            .collect();
        let result = choose(numbers[0], numbers[1], numbers[2],
            numbers[3], numbers[4], numbers[5]);
        let observed = result.unwrap_or("reject");
        assert_eq!(observed, cells[7], "candidate disagreement for {id}");
        tested += 1;
    }
    assert_eq!(tested, 14, "candidate inventory drift");
}

#[test]
fn sampled_counts_saturate_without_wrap_or_implicit_authority() {
    assert_eq!(choose(40, 3, 8, u64::MAX, u64::MAX, u64::MAX),
        Ok("aosoa"), "first bounded sample consumes quota");
    assert_eq!(choose(40, 3, 8, 0, u64::MAX, u64::MAX),
        Ok("soa"), "bounded column samples cannot wrap");
    assert_eq!(choose(40, 3, 8, 0, 0, u64::MAX),
        Ok("aos"), "random-heavy actor stays at conservative layout");
    assert!(choose(0, 3, 8, 100, 0, 0).is_err());
    assert!(choose(40, 3, 0, 100, 0, 0).is_err());
    assert!(choose(u64::MAX, 3, 8, 100, 0, 0).is_err());
    assert!(choose(40, 4097, 8, 100, 0, 0).is_err());
    assert!(choose(40, 3, 2048, 100, 0, 0).is_err());
}
