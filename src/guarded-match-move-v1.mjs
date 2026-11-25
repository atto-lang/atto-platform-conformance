/**
 * Validate a source-free, candidate-only guarded-match ownership registry.
 * This intentionally cannot authenticate a compiler run or authorize PASS:
 * that requires a separate exact-head, independently reviewed receipt verifier.
 */
export function validateGuardedMatchMoveRegistry(doc) {
  const fail = (reason) => { throw new Error(`GUARDED_MATCH_MOVE_V1_INVALID: ${reason}`); };
  const record = (v) => v !== null && typeof v === 'object'
    && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const exactKeys = (v, keys, where) => {
    if (!record(v)) fail(`${where}: expected ordinary object`);
    const actual = Object.keys(v).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) {
      fail(`${where}: unrecognized or missing key`);
    }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const targets = ['java', 'llvm', 'wasm', 'forge', 'net'];
  const head = '56a5ca3a67b13388e4b7e441f10743005e8340b2';
  const expected = [
    ['reject-statement-guard-move', '13b6a8cca706241c3bd56b456f0828ab0253d61b', 'compile-reject'],
    ['reject-value-guard-move', '693e0bcf6d9fd4d54d9f9c92175e1bf09716d648', 'compile-reject'],
    ['accept-borrowed-match-guard', '55524f255e1adbf8f3435986f3446ae896ab7013', 'compile-and-run'],
  ];

  exactKeys(doc, ['schemaVersion', 'contract', 'status', 'sourceRepository',
    'sourceCommit', 'sourcePr', 'sourceForm', 'backendTargets', 'semanticBoundary',
    'cases', 'mergeGate', 'existingEvidence', 'limitations'], 'root');
  if (doc.schemaVersion !== 1 || doc.contract !== 'guarded-match-move-v1'
    || doc.status !== 'CANDIDATE_NOT_ATTESTED') fail('schema/attestation status');
  if (doc.sourceRepository !== 'ores-truffle-oreslang/oreslang-source.java'
    || doc.sourceCommit !== head
    || doc.sourcePr !== 'https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2691'
    || doc.sourceForm !== '.atto') fail('source repository/head/PR identity');
  if (!same(doc.backendTargets, targets)) fail('backend targets');

  const semanticFields = ['guardFalsePath', 'patternSkippedPath', 'branchBodyIsolation',
    'ownershipCheck', 'noThreadIdentity'];
  exactKeys(doc.semanticBoundary, semanticFields, 'semantic boundary');
  for (const field of semanticFields) {
    if (typeof doc.semanticBoundary[field] !== 'string'
      || doc.semanticBoundary[field].length < 35) fail(`missing semantic boundary: ${field}`);
  }

  if (!Array.isArray(doc.cases) || doc.cases.length !== expected.length) {
    fail('fixture list size');
  }
  for (let i = 0; i < expected.length; i++) {
    const c = doc.cases[i];
    const [id, blob, outcome] = expected[i];
    const negative = outcome === 'compile-reject';
    exactKeys(c, negative
      ? ['id', 'gitBlob', 'expectation', 'expectedDiagnostic', 'parserMustAccept',
        'rejectBeforeCodegen', 'path', 'backendEvidence']
      : ['id', 'gitBlob', 'expectation', 'expectedStdout', 'path', 'backendEvidence'],
    `fixture ${i}`);
    if (c.id !== id || c.gitBlob !== blob || c.expectation !== outcome
      || c.path !== `tests/fixtures/ownership-match-guard-v1/${id}.atto`) {
      fail(`source identity: ${id}`);
    }
    if (negative) {
      if (c.expectedDiagnostic !== 'moved' || c.parserMustAccept !== true
        || c.rejectBeforeCodegen !== true) fail(`semantic rejection gate: ${id}`);
    } else if (c.expectedStdout !== '7') fail('guest stdout');
    exactKeys(c.backendEvidence, targets, `backendEvidence: ${id}`);
    for (const backend of targets) {
      if (c.backendEvidence[backend] !== 'NOT_EXECUTED') {
        fail(`unearned backend attestation: ${id}/${backend}`);
      }
    }
  }

  const positiveGates = ['exactSourceHeadAndGitBlob', 'actualSemanticCompilerExecution',
    'parserOnlyDoesNotPass', 'negativeNoEmittedExecutable', 'positiveGuestExecution',
    'startedJobStepsNonzero', 'independentReview'];
  const negativeGates = ['zeroStepCountsAsEvidence', 'hostModelCountsAsBackend'];
  exactKeys(doc.mergeGate, [...positiveGates, ...negativeGates], 'mergeGate');
  for (const gate of positiveGates) {
    if (doc.mergeGate[gate] !== true) fail(`required gate disabled: ${gate}`);
  }
  for (const gate of negativeGates) {
    if (doc.mergeGate[gate] !== false) fail(`unearned evidence gate enabled: ${gate}`);
  }

  exactKeys(doc.existingEvidence, targets, 'existingEvidence');
  exactKeys(doc.existingEvidence.java,
    ['workflowRunId', 'jobId', 'runnerId', 'executedSteps', 'status'], 'existingEvidence.java');
  const java = doc.existingEvidence.java;
  if (java.workflowRunId !== 42513889322 || java.jobId !== 128832575212
    || java.runnerId !== 0 || java.executedSteps !== 0
    || java.status !== 'NOT_EXECUTED') fail('unearned Java run admission');
  for (const backend of targets.filter(x => x !== 'java')) {
    if (doc.existingEvidence[backend] !== 'NOT_EXECUTED') {
      fail(`unearned backend run admission: ${backend}`);
    }
  }
  if (!Array.isArray(doc.limitations) || doc.limitations.length < 3
    || !doc.limitations.every(s => typeof s === 'string' && s.length >= 25)) {
    fail('insufficient limitations');
  }
  return { contract: doc.contract, sourceCommit: head,
    caseCount: expected.length, executedBackends: 0 };
}
