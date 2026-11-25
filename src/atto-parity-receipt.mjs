export const BACKENDS = Object.freeze(['java', 'llvm', 'wasm', 'net', 'forge']);
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CASE_ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const I64_TEXT = /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const SCALAR_CORE_V1 = Object.freeze({
  'canonical-add': {kind:'positive',source:'08a415734e9992f47702dc9b1ccf2c5dceb74df05245eaa5fbb00512d18afc8a',expected:'42'},
  'precedence': {kind:'positive',source:'0dedccfdeff013995e1e5d784bf1767acf61b0c0485fa50aba6aa9dd473331f2',expected:'14'},
  'parentheses': {kind:'positive',source:'730d7fe277125aa17abadaea1222d867fcc9e97fbd7f5b0af1f95da862857ade',expected:'20'},
  'signed-minimum': {kind:'positive',source:'8b5b69ec25fda12bd6a695c7a2ab986634bcbf37f8b129507582597e662c0b49',expected:'-9223372036854775808'},
  'signed-max-minus-one': {kind:'positive',source:'d27086270301951421718bcf3c82d5fe988b5dd076d43153f3aed3a6bebb7c99',expected:'9223372036854775806'},
  'type-first-readonly': {kind:'positive',source:'723e8163a685eaf1bb5c1a958430719dadc72ce23624960e88c50c0538045ee7',expected:'42'},
  'typed-const-readonly': {kind:'positive',source:'d97b7e9d1b39f3dbe38b09fecf1336a1902bdb8dc1526d6718df5740248a0e99',expected:'42'},
  'inferred-const-readonly': {kind:'positive',source:'0fd0d878d29431433ab57c65f7234b8b7cf0125d2e0cd587bb9de1bf827c56cd',expected:'42'},
  'pure-call': {kind:'positive',source:'05fd54126d6c2a630a430d0d4a38c01ae589d04b745da00597f02a2a63ee9d1e',expected:'42'},
  'type-first-parameter': {kind:'positive',source:'2b06a5d5f53a6b551d7f7bf1ff03c8515dbadb2bc76aba9198e77c8a1bb0ae3e',expected:'42'},
  'checked-add-overflow': {kind:'negative',source:'f1707d7b751858fe61bac9c13e68deca63f6dfa12305a9e51ad44d214b78b74d',stages:['compile','runtime']},
  'checked-sub-overflow': {kind:'negative',source:'cc8c26829b910c376d8b242da5cc3831f594a5ac883805e0e5a13f1b6dcd78f1',stages:['compile','runtime']},
  'checked-mul-overflow': {kind:'negative',source:'65e6807353a4a6f8c1a37a5e56ed3ac5b5da5fc20c36b1ca38db51c8c36e0e58',stages:['compile','runtime']},
  'type-first-reassignment': {kind:'negative',source:'dc5950e366fbf7189fc95693f6cb05abd4f1998ca5646f57edfd786110e4b293',stages:['compile']},
  'typed-const-reassignment': {kind:'negative',source:'3fc7f33d994509c2cda3ec8a98a91516ef9b8ac9d8eb660008ae79b96ef04c50',stages:['compile']},
  'eager-unused-overflow': {kind:'negative',source:'0fd9c69e25455c9cd716c692b676a97fedc5e25093bbd1bc8386eb7de792f70a',stages:['compile','runtime']},
  'removed-modulo': {kind:'negative',source:'aeecb295613d331f6decbb83707b62813f11b1d91f226a1ee81177e5a26ba838',stages:['compile']},
  'removed-caret': {kind:'negative',source:'0d2b65e35fe88d01c0f5881bc0b8bb3f20a145ae7d5a09719fb79f959089ce2b',stages:['compile']},
  'removed-double-caret': {kind:'negative',source:'0032984d2f6463a82d85e4fd3025741dfbdb52ce2fdb96c727e82ccb262cfa09',stages:['compile']}
});
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function check(ok, reason) { if (!ok) throw new Error('parity receipt rejected: ' + reason); }
function checkI64Text(value, reason) {
  // Signed i64 needs at most 20 ASCII characters. Reject oversized decimal
  // text before regex scanning or BigInt allocation on untrusted receipts.
  check(typeof value === 'string' && value.length <= 20 && I64_TEXT.test(value), reason);
  const parsed = BigInt(value);
  check(parsed >= I64_MIN && parsed <= I64_MAX, reason);
}
function checkCommon(report) {
  check(BACKENDS.includes(report.backend), 'backend');
  check(SHA.test(report.head_sha ?? ''), 'head SHA');
  check(SHA.test(report.tree_sha ?? ''), 'tree SHA');
  // Compiler names are untrusted receipt labels, not log lines. Reject ASCII/C1
  // controls, Unicode separators and bidi overrides that can forge or reorder
  // a human-readable trail without changing authenticated job metadata.
  check(typeof report.compiler === 'string' && report.compiler.length > 0 &&
    report.compiler.length <= 256 && !/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/.test(report.compiler), 'compiler');
  check(DIGEST.test(report.compiler_sha256 ?? ''), 'compiler digest');
  check(Number.isSafeInteger(report.run_id) && report.run_id > 0, 'run ID');
  check(Number.isSafeInteger(report.run_attempt) && report.run_attempt > 0, 'run attempt');
  check(Number.isSafeInteger(report.executed_steps) && report.executed_steps > 0, 'executed steps');
  check(report.job_conclusion === 'success', 'job conclusion');
  check(Array.isArray(report.cases) && report.cases.length > 0 && report.cases.length <= 100, 'cases');
}
function checkCaseIdentity(c, ids) {
  check(isObject(c), 'case object');
  check(typeof c.id === 'string' && CASE_ID.test(c.id) && !ids.has(c.id), 'case ID');
  ids.add(c.id);
  check(DIGEST.test(c.source_sha256 ?? ''), 'source digest');
  check(c.kind === 'positive' || c.kind === 'negative', 'case kind');
  check(Number.isSafeInteger(c.compile_exit) && c.compile_exit >= 0, 'compile exit');
}
function validateV1(report) {
  checkCommon(report);
  const ids = new Set();
  for (const c of report.cases) {
    checkCaseIdentity(c, ids);
    if (c.kind === 'positive') {
      check(c.compile_exit === 0, 'positive compilation');
      check(c.executed === true && c.run_exit === 0, 'positive guest execution');
      check(typeof c.stdout === 'string' && c.stdout.length <= 16384, 'bounded stdout');
      check(typeof c.expected_stdout === 'string' && c.stdout === c.expected_stdout, 'stdout mismatch');
    } else {
      check(c.compile_exit !== 0 && c.executed === false, 'negative compile rejection');
      check(typeof c.diagnostic === 'string' && c.diagnostic.length > 0 && c.diagnostic.length <= 4096 &&
        !/[\u0000\u001b\u007f-\u009f\u2028-\u202e\u2066-\u2069]/.test(c.diagnostic), 'negative diagnostic');
    }
  }
  return {
    consistent: true,
    authenticity_attested: false,
    publicly_promotable: false,
    backend: report.backend,
    case_count: ids.size
  };
}
function validateV2(report) {
  checkCommon(report);
  const ids = new Set();
  for (const c of report.cases) {
    checkCaseIdentity(c, ids);
    if (c.kind === 'positive') {
      check(c.compile_exit === 0, 'positive compilation');
      check(DIGEST.test(c.artifact_sha256 ?? ''), 'positive guest artifact digest');
      check(c.executed === true, 'positive guest execution');
      check(c.failure_stage === undefined, 'positive failure stage');
      checkI64Text(c.result_i64, 'positive i64 result');
      checkI64Text(c.expected_i64, 'expected i64 result');
      check(c.result_i64 === c.expected_i64, 'typed i64 mismatch');
      check(typeof c.result_channel === 'string' &&
        ['process-exit', 'stdout', 'wasm-export', 'native-return', 'host-call'].includes(c.result_channel),
        'result channel');
      if (c.result_channel === 'process-exit') {
        const value = BigInt(c.result_i64);
        check(value >= 0n && value <= 255n,
          'process-exit cannot carry the full typed i64 result');
        check(Number.isSafeInteger(c.run_exit) && c.run_exit === Number(value),
          'process-exit result must match observed exit status');
      } else if (c.run_exit !== undefined) {
        // Native/stdout/export results are not process-exit values. A supplied
        // nonzero process exit means the enclosing guest failed even when
        // the receipt claims a matching typed i64 result.
        check(Number.isSafeInteger(c.run_exit) && c.run_exit === 0,
          'positive guest process exit');
      }
    } else {
      check(c.failure_stage === 'compile' || c.failure_stage === 'runtime', 'negative failure stage');
      check(typeof c.diagnostic === 'string' && c.diagnostic.length > 0 && c.diagnostic.length <= 4096 &&
        !/[\u0000\u001b\u007f-\u009f\u2028-\u202e\u2066-\u2069]/.test(c.diagnostic), 'negative diagnostic');
      if (c.failure_stage === 'compile') {
        check(c.compile_exit !== 0 && c.executed === false, 'negative compile rejection');
        check(c.artifact_sha256 === undefined, 'compile rejection artifact');
        check(c.runtime_outcome === undefined, 'compile rejection runtime outcome');
      } else {
        check(c.compile_exit === 0 && c.executed === true, 'negative runtime execution');
        check(DIGEST.test(c.artifact_sha256 ?? ''), 'negative runtime artifact digest');
        check(c.runtime_outcome === 'trap' || c.runtime_outcome === 'error', 'negative runtime outcome');
      }
    }
  }
  return {
    consistent: true,
    authenticity_attested: false,
    publicly_promotable: false,
    schema: report.schema,
    backend: report.backend,
    case_count: ids.size
  };
}
export function validateParityReceipt(report) {
  check(isObject(report), 'object required');
  if (report.schema === 'attolang.parity-receipt/1') return validateV1(report);
  if (report.schema === 'attolang.parity-receipt/2') return validateV2(report);
  throw new Error('parity receipt rejected: schema');
}
export function validateScalarParityReceipt(report) {
  check(isObject(report), 'object required');
  check(report.schema === 'attolang.parity-receipt/2', 'scalar core requires receipt v2');
  const result = validateV2(report);
  check(report.cases.length === Object.keys(SCALAR_CORE_V1).length,
    'scalar core requires the complete canonical case set');
  const observed = new Map(report.cases.map(c => [c.id, c]));
  for (const [id, expected] of Object.entries(SCALAR_CORE_V1)) {
    const c = observed.get(id);
    check(c !== undefined, 'missing canonical scalar case ' + id);
    check(c.source_sha256 === expected.source, 'canonical source mismatch for ' + id);
    check(c.kind === expected.kind, 'canonical case kind mismatch for ' + id);
    if (expected.kind === 'positive') {
      check(c.expected_i64 === expected.expected, 'canonical expected i64 mismatch for ' + id);
      check(c.result_i64 === expected.expected, 'canonical observed i64 mismatch for ' + id);
    } else {
      check(expected.stages.includes(c.failure_stage), 'invalid failure stage for ' + id);
    }
  }
  return {...result, scalar_core_eligible: true};
}
