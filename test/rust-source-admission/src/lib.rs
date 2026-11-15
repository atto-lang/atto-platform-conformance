#![forbid(unsafe_code)]

// Host/source-byte reference tests. This does not execute any compiler backend.
// The 19 JSON fixtures remain the canonical source of the byte cases.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
struct Admission {
    kind: &'static str,
    offset: Option<usize>,
}

fn classify(bytes: &[u8]) -> Admission {
    let mut i = 0;
    while i < bytes.len() {
        let lead = bytes[i];
        if lead == 0 {
            return Admission { kind: "nul", offset: Some(i) };
        }
        if lead < 0x80 {
            i += 1;
            continue;
        }
        let (remaining, min_second, max_second): (usize, u8, u8) = match lead {
            0xc2..=0xdf => (1, 0x80, 0xbf),
            0xe0 => (2, 0xa0, 0xbf),
            0xed => (2, 0x80, 0x9f),
            0xe1..=0xec | 0xee..=0xef => (2, 0x80, 0xbf),
            0xf0 => (3, 0x90, 0xbf),
            0xf4 => (3, 0x80, 0x8f),
            0xf1..=0xf3 => (3, 0x80, 0xbf),
            _ => return Admission { kind: "invalid_utf8", offset: Some(i) },
        };
        if bytes.len() - i <= remaining {
            return Admission { kind: "invalid_utf8", offset: Some(i) };
        }
        for j in 1..=remaining {
            let lo = if j == 1 { min_second } else { 0x80 };
            let hi = if j == 1 { max_second } else { 0xbf };
            if !(lo..=hi).contains(&bytes[i + j]) {
                return Admission { kind: "invalid_utf8", offset: Some(i + j) };
            }
        }
        i += remaining + 1;
    }
    Admission { kind: "valid", offset: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    const MANIFEST: &str = include_str!("../../../contracts/source-input-admission-v1.json");

    fn bytes_from_hex(hex: &str) -> Vec<u8> {
        assert!(!hex.is_empty() && hex.len() % 2 == 0, "invalid hex fixture length");
        hex.as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let pair = std::str::from_utf8(pair).expect("ASCII hex pair");
                u8::from_str_radix(pair, 16).expect("invalid hex fixture")
            })
            .collect()
    }

    #[test]
    fn all_canonical_byte_vectors_match_rust_reference() {
        let contract: serde_json::Value =
            serde_json::from_str(MANIFEST).expect("valid canonical JSON");
        assert_eq!(contract["schema_version"], "source-input-admission-v1");
        assert_eq!(
            contract["verification"],
            "REFERENCE_ONLY_NOT_EXECUTED_BY_BACKENDS"
        );
        let cases = contract["cases"].as_array().expect("cases array");
        assert_eq!(cases.len(), 19, "contract vector count changed; review fixture expectations");
        let mut names = HashSet::new();
        for case in cases {
            let name = case["name"].as_str().expect("case name");
            assert!(names.insert(name), "duplicate vector: {name}");
            let hex = case["hex"].as_str().expect("hex bytes");
            let bytes = bytes_from_hex(hex);
            assert!(!bytes.is_empty() && bytes.len() < 1024, "invalid length for {name}");
            let expected_kind = case["status"].as_str().expect("status");
            let expected_offset = case["offset"].as_u64().map(|n| n as usize);
            let observed = classify(&bytes);
            assert_eq!(observed.kind, expected_kind, "status mismatch: {name}");
            assert_eq!(observed.offset, expected_offset, "offset mismatch: {name}");
            match expected_kind {
                "valid" => {
                    assert!(!bytes.contains(&0), "NUL in valid source: {name}");
                    assert!(std::str::from_utf8(&bytes).is_ok(), "invalid UTF-8: {name}");
                }
                "nul" => {
                    assert_eq!(bytes.iter().position(|b| *b == 0), expected_offset,
                        "incorrect NUL byte: {name}");
                    assert!(std::str::from_utf8(&bytes).is_ok(), "invalid UTF-8: {name}");
                }
                "invalid_utf8" => {
                    assert!(std::str::from_utf8(&bytes).is_err(), "unexpected UTF-8: {name}");
                }
                other => panic!("unknown admission kind: {other}"),
            }
        }
    }

    #[test]
    fn independently_checks_first_error_precedence() {
        assert_eq!(classify(&[0, 0xff]), Admission { kind: "nul", offset: Some(0) });
        assert_eq!(classify(&[0xff, 0]), Admission { kind: "invalid_utf8", offset: Some(0) });
        assert_eq!(classify(&[0xe2, b'(', 0]), Admission {
            kind: "invalid_utf8", offset: Some(1)
        });
        assert_eq!(classify(&[0x61, 0x0d, 0x0a, 0]), Admission {
            kind: "nul", offset: Some(3)
        });
    }

    #[test]
    fn rejects_every_invalid_single_byte_without_panicking() {
        for lead in 0x80_u8..=0xff {
            let observed = classify(&[lead]);
            assert_eq!(observed.kind, "invalid_utf8", "bad lead {lead:x}");
            assert_eq!(observed.offset, Some(0), "bad lead {lead:x}");
        }
    }
}
