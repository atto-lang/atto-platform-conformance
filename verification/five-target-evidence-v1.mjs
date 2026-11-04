// Review-only exact-SHA parity snapshot verifier. Not a substitute for
// authenticated CI attestation, release review, or actual guest execution.
const TARGETS = Object.freeze(new Map([
  ['graalvm','ores-truffle-oreslang/oreslang-source.java'],
  ['llvm','ores-truffle-oreslang/oreslang-source.llvm'],
  ['wasm','ores-truffle-oreslang/oreslang-source.wasm'],
  ['dotnet','ores-truffle-oreslang/oreslang-source.net'],
  ['javascript','ores-truffle-oreslang/oreslang-source.js']
]));
const EVIDENCE_FLAGS = [
  'sourceOreslangCompiled','generatedGuestExecuted','stepfulCiObserved'
];

function verifyFiveTargetEvidence(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 ||
      snapshot.status !== 'INCOMPLETE_NOT_CERTIFIED' ||
      snapshot.noPrivateExportWithoutApproval !== true ||
      !Array.isArray(snapshot.backends) ||
      snapshot.backends.length !== TARGETS.size) {
    throw new Error('invalid or non-provisional parity snapshot');
  }
  const seen = new Set();
  for (const entry of snapshot.backends) {
    if (!entry || !TARGETS.has(entry.id) || seen.has(entry.id) ||
        entry.repository !== TARGETS.get(entry.id) ||
        !/^[0-9a-f]{40}$/.test(entry.commit) ||
        typeof entry.actorMemory !== 'string' || !entry.actorMemory ||
        typeof entry.layouts !== 'string' || !entry.layouts ||
        typeof entry.source !== 'string' ||
        !entry.source.startsWith('https://github.com/' + entry.repository + '/') ||
        !entry.evidence || typeof entry.evidence !== 'object') {
      throw new Error('invalid backend identity or missing snapshot provenance');
    }
    seen.add(entry.id);
    for (const flag of EVIDENCE_FLAGS) {
      if (typeof entry.evidence[flag] !== 'boolean') {
        throw new Error('missing explicit backend evidence flag');
      }
    }
    // Source compilation may be recorded before guest execution. Neither may
    // claim a tested guest artifact without independently verifiable provenance.
    if (entry.evidence.generatedGuestExecuted &&
        (!entry.evidence.sourceOreslangCompiled ||
         !entry.evidence.stepfulCiObserved ||
         typeof entry.evidence.verifiedArtifactSha !== 'string' ||
         !/^[0-9a-f]{40,64}$/.test(entry.evidence.verifiedArtifactSha) ||
         typeof entry.evidence.runUrl !== 'string' ||
         !/^https:\/\/github\.com\//.test(entry.evidence.runUrl))) {
      throw new Error('guest execution claims require executed CI and artifact evidence');
    }
  }
  if (!snapshot.certification ||
      typeof snapshot.certification !== 'object' ||
      Object.keys(snapshot.certification).length !== 4 ||
      Object.values(snapshot.certification).some(value => value !== false)) {
    // This verifier only admits an unfinished snapshot. Release certification
    // must use a separately reviewed, evidence-authenticating verifier.
    throw new Error('provisional evidence cannot assert certified backend parity');
  }
  return Object.freeze({targets:seen.size,guestCertified:false});
}

export {verifyFiveTargetEvidence};
