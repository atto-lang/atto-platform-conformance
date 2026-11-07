import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root,
  'contracts/atto-gpu-typed-host-args-v1.json'), 'utf8'));

function source(c) {
  assert.match(c.path,
    /^fixtures\/gpu-typed-host-args-v1\/(?:positive|negative)-[a-z0-9-]+\.atto$/);
  const local = path.join(root, c.path);
  const stat = lstatSync(local);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  const bytes = readFileSync(local);
  assert.ok(bytes.length > 0 && bytes.length <= 65536);
  const header = Buffer.from('blob ' + bytes.length + '\0');
  assert.equal(createHash('sha1').update(header).update(bytes).digest('hex'),
    c.gitBlobSha);
  return bytes.toString('utf8');
}

test('G1e stage remains source declaration evidence only', () => {
  assert.equal(manifest.schema, 'attolang.gpu-typed-host-args-source/1');
  assert.equal(manifest.stage, 'G1e_SOURCE_DECLARATION_ABI_SHAPE_ONLY');
  assert.equal(manifest.evidence, 'DECLARED_HOST_ABI_SHAPE_ONLY_NOT_EXECUTABLE');
  assert.equal(manifest.javaIntegrationPr, 2610);
  assert.equal(manifest.directHostCallSiteIdentityChecked, true);
  assert.equal(manifest.rejectForgedSourceLinkArgumentNames, true);
  assert.equal(manifest.noLaunchSourceSignatureCannotGrantBinding, true);
  assert.equal(manifest.nestedOrUnprovenSourceCallSiteAdmitted, false);
  assert.equal(manifest.authoredJunitCases, 19);
  assert.equal(manifest.authoredJunitControlFlowCases, 24);
  assert.equal(manifest.authoredJunitEntryPointCases, 6);
  assert.equal(manifest.authoredJunitCapacityCases, 18);
  assert.equal(manifest.sourceDirectLaunchOnly, true);
  assert.equal(manifest.sourceUnprovenHostControlFlowAllowed, false);
  assert.equal(manifest.sourcePostAnnotationGpuAdmissionRechecked, true);
  assert.equal(manifest.sourceLogicalOverMustBeDeclaredKernelN, true);
  assert.equal(manifest.sourceOneDimensionalStaticGroupRequired, true);
  assert.equal(manifest.sourceLiteralKernelNAllowed, false);
  assert.match(manifest.javaSourceHead, /^[a-f0-9]{40}$/);
  assert.match(manifest.javaSourceTree, /^[a-f0-9]{40}$/);
  for (const key of [
    'compilerTypeCheckerSymbolsResolved', 'sourceMutableBorrowProof',
    'physicalProviderViewsAuthenticated', 'gpuDispatchEnabled', 'implicitCpuFallback',
    'unresolvedNamesEnabled', 'implicitNumericConversionsEnabled',
    'writableLexicalBufferAliasingEnabled'])
    assert.equal(manifest[key], false, key);
  assert.equal(manifest.ci.javaJunit, 'NOT_EXECUTED');
  assert.equal(manifest.ci.steps, null);
  for (const backend of Object.values(manifest.backends))
    assert.deepEqual(backend, {
      compiler:'NOT_EXECUTED', guest:'NOT_EXECUTED', physicalGpu:'NOT_EXECUTED'
    });
});

test('all G1e proposed fixtures are pinned exact source blobs', () => {
  assert.equal(manifest.cases.length, 18);
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, 18);
  assert.equal(new Set(manifest.cases.map(c => c.path)).size, 18);
  assert.equal(new Set(manifest.cases.map(c => c.gitBlobSha)).size, 18,
    'every mutation fixture must be a distinct Git blob');
  const canonical = manifest.cases.find(c => c.expectation === 'positive');
  assert.ok(canonical && canonical.id === 'typed-host-saxpy');
  for (const candidate of manifest.cases.filter(c => c.expectation === 'negative')) {
    assert.notEqual(candidate.gitBlobSha, canonical.gitBlobSha,
      'a negative fixture must not alias the unchanged canonical source');
  }
  assert.equal(manifest.cases.filter(c => c.expectation === 'positive').length, 1);
  assert.equal(manifest.cases.filter(c => c.expectation === 'negative').length, 17);
  for (const c of manifest.cases) {
    assert.equal(c.observedResult, 'NOT_EXECUTED');
    assert.equal(c.expectedDiagnostic, c.expectation === 'positive'
      ? null : 'GPU-LAUNCH-002');
    const data = source(c);
    assert.ok(data.includes(c.sourcePattern), c.id);
  }
});

// These tests only check proposed fixture and manifest bytes. They DO NOT
// execute AttoLang, Maven/JUnit, an ownership checker or a GPU provider.
