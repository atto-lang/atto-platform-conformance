//! Static exact-SHA inventory for the 11 AttoLang source backends.
//! SOURCE-ONLY. A pinned SHA is NOT an executed compiler or a parity receipt.
//! A future promotion needs independent per-backend compiler execution proof.
#![forbid(unsafe_code)]
use std::fs;

const EXPECTED: [(&str, &str, &str); 11] = [
    ("atto-source.atto", "4ad9665ea4b2a425fd2d859590e26f2c577e7811", "BOOTSTRAP_ONLY"),
    ("atto-source.java", "63f1872944640dda895e172d76e2adc428d64910", "JVM_COMPILER"),
    ("atto-source.llvm", "7150b2a72253732a328f76db12b1f0ebb333b103", "NATIVE_LLVM"),
    ("atto-source.wasm", "d9349d9bb4e872b9a54b0dad44506e664d1848a5", "WASM_ADAPTER"),
    ("atto-source.net", "928a439580c94721ed596a54ed00a6b0e931b114", "SKELETON"),
    ("atto-source.forge", "f3c02418330589e4cbccf31a77b53f7914daf6e6", "NATIVE_PRIMITIVES"),
    ("atto-source.rs", "eb7539742c660a1c3379de2de09f76bd72c9ee1e", "RUST_WASM_COMPILER"),
    ("atto-source.cranelift", "c7ba1b709139b1856076e5f9d325b7f489194c10", "SCALAR_ONLY"),
    ("atto-source.js", "8c85a5c1aed101e5975177cb426da5e5ae37f1d7", "TRUSTED_JS_SUBSET"),
    ("atto-source.hdl", "fccd647238abf006a2fe8998e9f77d5db414dfee", "SKELETON"),
    ("atto-source.realtime", "e62499131cf5de3478b5ac0245ddffc2e09630ac", "SKELETON"),
];

fn verify(contents: &str) -> Result<usize, String> {
    let rows: Vec<_> = contents.lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    if rows.len() != EXPECTED.len() {
        return Err(format!("expected 11 distinct source backends, observed {}", rows.len()));
    }
    for (row, (repo, head, capability)) in rows.iter().zip(EXPECTED) {
        let fields: Vec<&str> = row.split('\t').collect();
        if fields.len() != 4 {
            return Err(format!("wrong number of inventory fields: {row}"));
        }
        if fields[0] != repo || fields[1] != head || fields[2] != capability {
            return Err(format!("backend identity, commit or capability drift: {repo}"));
        }
        if fields[3] != "NOT_EXECUTED" {
            return Err(format!("unauthorized backend parity promotion: {repo} ({})", fields[3]));
        }
        if head.len() != 40 || !head.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
            return Err(format!("invalid default-branch commit SHA: {repo}"));
        }
    }
    Ok(EXPECTED.len())
}

fn main() {
    let path = "contracts/atto-source-backend-typed-actor-v1.tsv";
    let data = fs::read_to_string(path).expect("backend inventory missing");
    match verify(&data) {
        Ok(n) => println!("{n} Atto backend exact source heads inventoried, typed actor guest parity NOT_EXECUTED"),
        Err(reason) => { eprintln!("BACKEND_PARITY_RECEIPT_DENIED: {reason}"); std::process::exit(1); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_11_backends_are_pinned_but_not_promoted() {
        let input = fs::read_to_string("contracts/atto-source-backend-typed-actor-v1.tsv").unwrap();
        assert_eq!(verify(&input), Ok(11));
    }
    #[test]
    fn fake_success_is_rejected_even_if_other_fields_match() {
        let input = fs::read_to_string("contracts/atto-source-backend-typed-actor-v1.tsv").unwrap();
        let altered = input.replacen("NOT_EXECUTED", "PASSED", 1);
        assert!(verify(&altered).unwrap_err().contains("unauthorized backend parity promotion"));
    }
    #[test]
    fn changed_sha_and_missing_backends_fail_closed() {
        let input = fs::read_to_string("contracts/atto-source-backend-typed-actor-v1.tsv").unwrap();
        let altered = input.replacen(EXPECTED[0].1, "0000000000000000000000000000000000000000", 1);
        assert!(verify(&altered).is_err());
        let pruned = input.lines().filter(|line| !line.starts_with("atto-source.hdl\t")).collect::<Vec<_>>().join("\n");
        assert!(verify(&pruned).is_err());
    }
}
