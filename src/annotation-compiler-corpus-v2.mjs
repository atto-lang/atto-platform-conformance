/** Candidate expected compiler behavior only, NOT guest or CI evidence. */
const BACKENDS = ["java", "llvm", "net", "wasm", "forge"];
const CASES = new Map([
  ["doc_class", ["class", "metadata"]],
  ["doc_actor", ["actor", "metadata"]],
  ["doc_isoactor", ["isoactor", "metadata"]],
  ["doc_module", ["module", "metadata"]],
  ["doc_function", ["fnc", "metadata"]],
  ["doc_field", ["field", "metadata"]],
  ["doc_wrong_scalar", ["class", "invalid_argument"]],
  ["doc_missing_arg", ["class", "invalid_argument"]],
  ["doc_named_arg", ["actor", "invalid_argument"]],
  ["doc_duplicate", ["class", "duplicate"]],
  ["doc_unregistered", ["class", "unknown"]],
  ["doc_interface_not_retained", ["interface", "unsupported_target"]],
  ["actor_unauthorized", ["actor", "authority"]],
  ["actor_policy_unlowered", ["actor", "unsupported_effect"]],
  ["layout_unlowered", ["class", "unsupported_effect"]],
]);

function requireValid(condition, reason) {
  if (!condition) throw new Error("ANNOTATION_V2_CORPUS_INVALID: " + reason);
}

/** Rejects mistaken or forged pass claims; does not run any compiler. */
export function validateAnnotationCompilerCorpusV2(corpus) {
  requireValid(corpus && corpus.schema_version === "attolang.annotation-compiler-corpus/v2",
    "wrong version");
  requireValid(corpus.status === "CANDIDATE_EXPECTATIONS_NOT_EXECUTED",
    "cannot promote expected results into proof");
  requireValid(JSON.stringify(corpus.backend_order) === JSON.stringify(BACKENDS),
    "backend inventory changed");
  requireValid(JSON.stringify(corpus.source_extensions) === JSON.stringify([".atto", ".ores"]),
    "source extension contract changed");
  requireValid(corpus.phase === "parser_and_aot_admission", "phase changed");
  requireValid(Array.isArray(corpus.cases) && corpus.cases.length === CASES.size,
    "missing or additional cases");
  const names = new Set();
  let acceptedJava = 0;
  for (const c of corpus.cases) {
    requireValid(c && typeof c.id === "string" && CASES.has(c.id), "unknown case");
    requireValid(!names.has(c.id), "duplicate case");
    names.add(c.id);
    const [target, intent] = CASES.get(c.id);
    requireValid(c.target === target && c.intent === intent, "case metadata changed");
    requireValid(typeof c.source === "string" && c.source.length > 15
      && c.source.length <= 2048 && c.source.endsWith("\n")
      && !c.source.includes("\r"), "noncanonical source bytes");
    requireValid(/^[\x0A\x20-\x7E]+$/.test(c.source) && c.source.includes("@"),
      "fixture must be ASCII source with an active candidate annotation");
    requireValid(c.expected && JSON.stringify(Object.keys(c.expected)) === JSON.stringify(BACKENDS),
      "expectation must cover exact ordered backends");
    const javaExpectation = intent === "metadata" ? "pass" : "reject";
    requireValid(c.expected.java === javaExpectation, "Java candidate expectation changed");
    for (const backend of BACKENDS.slice(1)) {
      requireValid(c.expected[backend] === "reject",
        "backend lacks proof for activating annotation");
    }
    if (c.expected.java === "pass") acceptedJava++;
  }
  requireValid(corpus.evidence && JSON.stringify(Object.keys(corpus.evidence)) ===
    JSON.stringify(BACKENDS), "evidence inventory changed");
  for (const backend of BACKENDS) {
    requireValid(corpus.evidence[backend] === "NOT_EXECUTED",
      "host-only, zero-step and fabricated guest passes are prohibited");
  }
  return { cases: names.size, javaCandidatePass: acceptedJava,
    javaCandidateReject: names.size - acceptedJava, executedBackends: 0 };
}
