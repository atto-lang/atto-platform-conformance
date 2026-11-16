//! Source-free, dependency-free Rust oracle for the portable bounds v1 contract.
//! These tests do NOT compile/execute any .atto guest code.
#[cfg(test)]
fn index(index: i64, length: i64) -> bool {
    index >= 0 && length > 0 && index < length
}
#[cfg(test)]
fn slice(offset: i64, count: i64, length: i64) -> bool {
    offset >= 0 && count >= 0 && length >= 0 && offset <= length && count <= length - offset
}
#[cfg(test)]
fn strided(offset: i64, stride: i64, count: i64, length: i64) -> bool {
    if stride <= 0 || count < 0 || !slice(offset, 0, length) {
        return false;
    }
    if count == 0 {
        return true;
    }
    if offset >= length {
        return false;
    }
    count - 1 <= (length - 1 - offset) / stride
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn pinned_vectors_are_unique_complete_and_match_reference() {
        let vectors = include_str!("../../../contracts/portable-bounds-v1/vectors.tsv");
        let mut names = HashSet::new();
        let mut count = 0usize;
        for (line_number, line) in vectors.lines().enumerate() {
            if line_number == 0 {
                assert_eq!(line, "id\tkind\toffset\tstride\tcount\tlength\texpected");
                continue;
            }
            let fields: Vec<_> = line.split('\t').collect();
            assert_eq!(fields.len(), 7, "invalid column count on line {}", line_number + 1);
            assert!(names.insert(fields[0]), "duplicate vector ID: {}", fields[0]);
            let parse = |idx: usize| -> i64 {
                fields[idx].parse::<i64>().expect("invalid i64 fixture")
            };
            let offset = parse(2);
            let stride = parse(3);
            let amount = parse(4);
            let length = parse(5);
            let actual = match fields[1] {
                "index" => index(offset, length),
                "slice" => slice(offset, amount, length),
                "strided" => strided(offset, stride, amount, length),
                other => panic!("unknown bounds kind: {other}"),
            };
            let expected = match fields[6] {
                "accept" => true,
                "reject" => false,
                other => panic!("unknown expected value: {other}"),
            };
            assert_eq!(actual, expected, "contract mismatch at {}", fields[0]);
            count += 1;
        }
        assert!(count >= 40, "the acceptance fixture is unexpectedly truncated");
    }

    #[test]
    fn exhaustive_small_signed_ranges_match_wide_integer_math() {
        for length in -3i64..=10 {
            for offset in -3i64..=10 {
                assert_eq!(index(offset, length), length > 0 && offset >= 0 && offset < length);
                for amount in -3i64..=10 {
                    let expected_slice = length >= 0
                        && offset >= 0 && amount >= 0
                        && (offset as i128) + (amount as i128) <= length as i128;
                    assert_eq!(slice(offset, amount, length), expected_slice);
                    for stride in -3i64..=10 {
                        let expected_strided = length >= 0 && offset >= 0
                            && offset <= length && stride > 0 && amount >= 0
                            && (amount == 0
                                || (offset as i128)
                                    + ((amount as i128 - 1) * stride as i128)
                                        < length as i128);
                        assert_eq!(strided(offset, stride, amount, length), expected_strided,
                            "offset={offset} stride={stride} amount={amount} length={length}");
                    }
                }
            }
        }
    }

    #[test]
    fn no_overflow_near_signed_i64_extrema() {
        let max = i64::MAX;
        let min = i64::MIN;
        assert!(slice(max - 1, 1, max));
        assert!(!slice(max - 1, 2, max));
        assert!(strided(max - 1, max, 1, max));
        assert!(!strided(max - 1, max, 2, max));
        assert!(!strided(min, 1, 0, max));
        assert!(!slice(0, max, min));
        assert!(!index(min, max));
    }
}
