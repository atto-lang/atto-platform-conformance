/**
 * Read-only, source-free metadata triage. Names, descriptions, workflow labels
 * and completed CI runs NEVER establish that a carrier contains no source.
 * No positive decision from this module authorizes a source transfer.
 */
const SHA = /^[a-f0-9]{40}$/;
const PATH = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const CODE = /\.(?:ores|java|rs|c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|cs|go|kt|kts|swift|zig|ll|bc|wat|wast|wasm|class|jar|js|jsx|mjs|cjs|ts|tsx|mts|cts|py|pyw|rb|sh|bash|zsh|ps1|lua|pl|php|scala|sc|groovy|gradle|dart|ex|exs|erl|hrl|fs|fsx|vb|vbs|r|jl|clj|cljs|cljc|hs|lhs|ml|mli|nim|v|vh|sv|svh|s|asm|proto|thrift|capnp)$/i;
const CODE_AREA = /^(?:src|source|sources|compiler|runtime|mirror|validation-reference|private-source|scripts|tools)(?:\/|$)/i;
const EXECUTABLE_CONFIG = /^(?:\.github\/workflows\/[^/]+\.(?:ya?ml)|(?:[^/]+\/)*(?:Dockerfile|Makefile|CMakeLists\.txt|pom\.xml|package\.json|Cargo\.toml|go\.mod|build\.gradle|settings\.gradle|BUILD|WORKSPACE)|(?:[^/]+\/)*[^/]+\.(?:bzl|bazel))$/i;
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function parseTree(snapshot) {
  if (!snapshot || !Number.isSafeInteger(snapshot.repository_id) || snapshot.repository_id <= 0 ||
      !SHA.test(snapshot.commit_sha ?? '') || !SHA.test(snapshot.tree_sha ?? '') ||
      snapshot.truncated !== false || !Array.isArray(snapshot.tree) ||
      snapshot.tree.length > 10000) return null;
  const seen = new Set();
  const entries = [];
  for (const e of snapshot.tree) {
    if (!e || typeof e.path !== 'string' || e.path.length > 1024 ||
        !PATH.test(e.path) || e.path.split('/').some(x => x === '.' || x === '..' || x.toLowerCase() === '.git' ||
          x.endsWith('.') || WINDOWS_RESERVED.test(x)) ||
        !SHA.test(e.sha ?? '') || !['blob', 'tree'].includes(e.type) ||
        (e.type === 'blob' && !['100644', '100755'].includes(e.mode)) ||
        (e.type === 'tree' && e.mode !== '040000')) return null;
    const folded = e.path.toLowerCase();
    if (seen.has(folded)) return null;
    seen.add(folded);
    entries.push({path:e.path,sha:e.sha,type:e.type,mode:e.mode});
  }
  if (entries.length === 0 || !entries.some(x => x.type === 'blob')) return null;
  return entries;
}

export function triageCarrierTree(snapshot, reviewedPin = null, knownPrivateBlobShas = []) {
  const entries = parseTree(snapshot);
  const base = {authorizes_source_transfer:false,certifies_source_free:false};
  if (!entries) return {...base,classification:'UNVERIFIABLE_TREE',reason:'incomplete or malformed immutable tree evidence'};
  if (!Array.isArray(knownPrivateBlobShas) || knownPrivateBlobShas.length > 10000 ||
      !knownPrivateBlobShas.every(sha => typeof sha === 'string' && SHA.test(sha)))
    return {...base,classification:'UNVERIFIABLE_FINGERPRINTS',reason:'invalid private-blob inventory'};
  const fingerprints = new Set(knownPrivateBlobShas);
  const matches = entries.filter(e => e.type === 'blob' && fingerprints.has(e.sha));
  if (matches.length) return {...base,classification:'MATCHES_REPORTED_PRIVATE_BLOB',matched_count:matches.length,
    reason:'private-source fingerprint match requires independent provenance and containment review'};
  // Any executable blob is suspicious even without an extension: tree metadata
  // cannot distinguish an extensionless script/binary from harmless data. This
  // intentionally over-classifies because triage never grants authorization.
  const suspicious = entries.filter(e => e.type === 'blob' &&
    (e.mode === '100755' || CODE.test(e.path) || CODE_AREA.test(e.path) || EXECUTABLE_CONFIG.test(e.path)));
  if (suspicious.length) return {...base,classification:'POTENTIAL_SOURCE_BEARING',suspicious_count:suspicious.length,
    reason:'source-like content or location; preserve refs for independent forensics'};
  // A path/extension heuristic cannot detect source renamed to a text/config file.
  // This pin comparison is for evidence consistency only, not approval.
  if (!reviewedPin) return {...base,classification:'SOURCE_FREE_UNPROVEN',reason:'no independent complete tree pin supplied'};
  const expected = parseTree(reviewedPin);
  if (!expected || reviewedPin.repository_id !== snapshot.repository_id ||
      reviewedPin.commit_sha !== snapshot.commit_sha || reviewedPin.tree_sha !== snapshot.tree_sha ||
      expected.length !== entries.length) return {...base,classification:'PIN_MISMATCH',reason:'carrier differs from supplied immutable pin'};
  const map = new Map(expected.map(e => [e.path,e]));
  if (!entries.every(e => {
    const p=map.get(e.path);
    return p && p.sha===e.sha && p.mode===e.mode && p.type===e.type;
  })) return {...base,classification:'PIN_MISMATCH',reason:'a source-tree entry differs from the supplied pin'};
  return {...base,classification:'MATCHES_SUPPLIED_PIN',reason:'metadata consistency only; reviewer provenance and bytes remain unverified'};
}
