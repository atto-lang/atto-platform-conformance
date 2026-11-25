#![forbid(unsafe_code)]
// Independent, host-only Rust source-byte admission reference.
// This validates JSON fixtures; it does not execute any Oreslang compiler.
use std::collections::HashSet;

const FIXTURES: &str = include_str!("../../../contracts/source-terminal-controls-v1.json");

#[derive(Debug, PartialEq, Eq)]
struct Verdict {
    status: &'static str,
    offset: Option<usize>,
}

fn first_rejected_byte(input: &[u8]) -> Verdict {
    for (at, byte) in input.iter().copied().enumerate() {
        match byte {
            0 => return Verdict { status: "nul", offset: Some(at) },
            0x1b | 0x7f => return Verdict { status: "terminal", offset: Some(at) },
            _ => {}
        }
    }
    Verdict { status: "valid", offset: None }
}

fn hex_bytes(hex: &str) -> Vec<u8> {
    assert!(!hex.is_empty() && hex.len() % 2 == 0, "malformed fixture hex");
    hex.as_bytes()
        .chunks_exact(2)
        .map(|part| u8::from_str_radix(std::str::from_utf8(part).unwrap(), 16).unwrap())
        .collect()
}

#[test]
fn canonical_cases_validate_raw_source_and_first_offset() {
    let contract: serde_json::Value = serde_json::from_str(FIXTURES).unwrap();
    assert_eq!(contract["schema"], "attolang.source-terminal-controls.v1");
    assert_eq!(contract["verification"], "UNEXECUTED_REAL_BACKENDS");
    let cases = contract["cases"].as_array().expect("cases array");
    assert_eq!(cases.len(), 13);
    let mut names = HashSet::new();
    for case in cases {
        let name = case["name"].as_str().unwrap();
        assert!(names.insert(name), "duplicate case: {name}");
        let bytes = hex_bytes(case["hex"].as_str().unwrap());
        assert!(bytes.len() <= 1024);
        assert!(std::str::from_utf8(&bytes).is_ok(), "fixtures must be valid UTF-8");
        let got = first_rejected_byte(&bytes);
        assert_eq!(got.status, case["status"].as_str().unwrap(), "{name}");
        assert_eq!(got.offset, case["offset"].as_u64().map(|i| i as usize), "{name}");
    }
}

#[test]
fn terminal_controls_hidden_in_comments_and_quotes_are_rejected() {
    for (source, at) in [
        (b"/* \x1b */".as_slice(), 3usize),
        (b"// \x7f\n".as_slice(), 3),
        (b"\"some\x1btext\"".as_slice(), 5),
        (b"x\r\n\x7f".as_slice(), 3),
    ] {
        assert_eq!(first_rejected_byte(source), Verdict { status: "terminal", offset: Some(at) });
    }
}

#[test]
fn no_false_positive_for_printable_and_normal_line_endings() {
    for text in ["", "café 😀", "/* café 😀 */", "\r\n\t", "\"\\u001b\""] {
        assert_eq!(first_rejected_byte(text.as_bytes()).status, "valid");
    }
}

#[test]
fn exhaustive_pairs_preserve_first_invalid_byte_precedence() {
    for first in 0u8..=255 {
        for second in 0u8..=255 {
            let bytes = [first, second];
            let expected_at = bytes.iter().position(|c| matches!(c, 0 | 0x1b | 0x7f));
            let got = first_rejected_byte(&bytes);
            assert_eq!(got.offset, expected_at);
            if let Some(i) = expected_at {
                assert_eq!(got.status, if bytes[i] == 0 { "nul" } else { "terminal" });
            } else {
                assert_eq!(got.status, "valid");
            }
        }
    }
}
