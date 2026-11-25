// Strict source-candidate loader. NOT a compiler or execution receipt.
const families = new Set(['map','entry','pair','tuple','array','list','vector','set','record']);
const backends = new Set(['java','llvm','wasm','forge','net','cranelift','js','rs','hdl']);
const allowed = new Set(['ACCEPT','REJECT']);
const removedAlias = /~(?:map|entry|pair|tuple|array|list|vector|set|record)\s*(?:<|\()/;

export function validateCollectionFactoryManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Error('invalid manifest');
  if (manifest.schema !== 'atto.collection-of-factories.v1' ||
      manifest.status !== 'SOURCE_EXPECTATIONS_ONLY') throw Error('invalid/false schema status');
  if (!manifest.backend_status || new Set(Object.keys(manifest.backend_status)).size !== 9 ||
      [...backends].some(backend => manifest.backend_status[backend] !== 'NOT_CERTIFIED'))
    throw Error('backend state must remain uncertified');
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 37) throw Error('expected 37 candidate cases');
  const seen = new Set();
  for (const c of manifest.cases) {
    if (!c || typeof c !== 'object' || Array.isArray(c) ||
        typeof c.id !== 'string' || !/^[a-z][a-z0-9-]{2,80}$/.test(c.id) ||
        seen.has(c.id) || !families.has(c.family) && c.family !== 'legacy' ||
        !allowed.has(c.expected) || !['guest','parser','type','ownership','runtime'].includes(c.phase) ||
        c.status !== 'TARGET_NOT_EXECUTED' || typeof c.source !== 'string' ||
        c.source.length < 8 || c.source.length > 4096)
      throw Error('invalid candidate or falsely asserted execution');
    if (c.expected === 'ACCEPT' && removedAlias.test(c.source))
      throw Error('removed tilde collection constructors cannot be accepted');
    if (removedAlias.test(c.source) && (c.expected !== 'REJECT' || c.phase !== 'parser'))
      throw Error('tilde collection constructors must be rejected by parser');
    if (c.family !== 'legacy' && c.expected === 'ACCEPT' &&
        !c.source.includes(c.family[0].toUpperCase() + c.family.slice(1) + '.of'))
      throw Error('positive cases must use canonical Type.of');
    seen.add(c.id);
  }
  for (const family of families) {
    const removed = manifest.cases.filter(c =>
      c.family === family && (c.id === family + '-tilde' || c.id === 'map-explicit-tilde'));
    if (removed.length !== 1 || removed[0].expected !== 'REJECT' ||
        removed[0].phase !== 'parser' || !removedAlias.test(removed[0].source))
      throw Error('missing removed tilde parser regression: ' + family);
    const coverage = new Set(manifest.cases.filter(c => c.family === family).map(c => c.expected));
    if (!coverage.has('ACCEPT') || !coverage.has('REJECT')) throw Error('missing family coverage: ' + family);
  }
  if (manifest.cases.filter(c => c.family === 'legacy').length < 6) throw Error('missing legacy grammar coverage');
  return Object.freeze({candidateCount: manifest.cases.length, backendCount: backends.size,
    executableParityCertified: false});
}

// A target-language wrapper for future backend compilers. This merely
// prepares source text. It never evaluates, certifies, or imports host data.
export function wrapCollectionFactoryCandidate(candidate) {
  if (!candidate || typeof candidate.source !== 'string' ||
      candidate.source.length > 4096 || candidate.status !== 'TARGET_NOT_EXECUTED')
    throw Error('not an admitted source target');
  return 'pub fnc main(): void {\n    ' + candidate.source + '\n    return;\n}\n';
}
