import {readFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_TASKS = Object.freeze([1, 2, 3, 4, 5]);
// Wave 1 is a versioned five-backend contract, independent of the discovery
// harness inventory. Adding JS discovery must not reinterpret frozen evidence.
const SOURCE_BACKENDS = Object.freeze(['java', 'llvm', 'net', 'wasm', 'forge'].sort());
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exactKeys = (value, keys, label) => {
  if (!isObject(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
    throw Error('invalid ' + label + ' fields');
  }
};
const slug = x => typeof x === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(x);

// This registry is a target inventory only: schema v1 prohibits declaring a
// feature verified on the strength of a hand-edited manifest or fake checker.
export function validateWave1Spec(spec) {
  exactKeys(spec, ['schemaVersion','purpose','backends','tasks','fixtures'], 'root');
  if (spec.schemaVersion !== 1 || spec.purpose !== 'unverified-parity-targets' ||
      !Array.isArray(spec.backends) ||
      JSON.stringify([...spec.backends].sort()) !== JSON.stringify(SOURCE_BACKENDS) ||
      new Set(spec.backends).size !== SOURCE_BACKENDS.length) {
    throw Error('invalid Wave 1 version, purpose, or backend inventory');
  }
  if (!Array.isArray(spec.tasks) || spec.tasks.length !== 5 ||
      !Array.isArray(spec.fixtures) || spec.fixtures.length < 6 || spec.fixtures.length > 64) {
    throw Error('invalid Wave 1 task/fixture inventory');
  }
  const ids = new Set(), paths = new Set(), byTask = new Map();
  for (const f of spec.fixtures) {
    const expectedFields = ['id','task','path','expect','sha256',
      f?.expect === 'reject' ? 'diagnosticClass' : 'expectedInt'];
    exactKeys(f, expectedFields, 'fixture');
    if (!slug(f.id) || ids.has(f.id) || !EXPECTED_TASKS.includes(f.task) || f.task < 3 ||
        typeof f.path !== 'string' ||
        !/^fixtures\/wave1\/[a-z0-9-]+\.ores$/.test(f.path) || paths.has(f.path) ||
        !['accept','reject'].includes(f.expect) ||
        (f.expect === 'reject' && !['syntax','unresolved-name','import-root-escape','duplicate-method-slot'].includes(f.diagnosticClass)) ||
        (f.expect === 'accept' && (!Number.isSafeInteger(f.expectedInt) || f.expectedInt < -2147483648 || f.expectedInt > 2147483647)) ||
        typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) {
      throw Error('invalid/duplicate Wave 1 fixture');
    }
    ids.add(f.id); paths.add(f.path);
    byTask.set(f.task, [...(byTask.get(f.task) || []), f]);
  }
  const seenTasks = new Set();
  for (const t of spec.tasks) {
    exactKeys(t, ['task','id','title','lead','kind','cases','backends','relatedPRs'], 'task');
    if (!EXPECTED_TASKS.includes(t.task) || seenTasks.has(t.task) || !slug(t.id) ||
        typeof t.title !== 'string' || !t.title.trim() || typeof t.lead !== 'string' || !t.lead.trim() ||
        t.kind !== (t.task <= 2 ? 'infrastructure' : 'language') ||
        !Array.isArray(t.cases) || new Set(t.cases).size !== t.cases.length ||
        !Array.isArray(t.relatedPRs) || t.relatedPRs.some(url =>
          typeof url !== 'string' || !/^https:\/\/github\.com\/ores-truffle-oreslang\/[-.\w]+\/pull\/[1-9][0-9]*$/.test(url)) ||
        !isObject(t.backends) || JSON.stringify(Object.keys(t.backends).sort()) !== JSON.stringify(SOURCE_BACKENDS) ||
        Object.values(t.backends).some(status => status !== 'pending')) {
      throw Error('invalid Wave 1 task or unverified feature promoted without execution');
    }
    const expected = (byTask.get(t.task) || []).map(x => x.id).sort();
    if (JSON.stringify([...t.cases].sort()) !== JSON.stringify(expected) ||
        (t.task >= 3 && !(byTask.get(t.task)?.some(x => x.expect === 'accept') || t.task === 4)) ||
        (t.task >= 3 && !byTask.get(t.task)?.some(x => x.expect === 'reject'))) {
      throw Error('missing/incorrect Wave 1 feature case coverage');
    }
    seenTasks.add(t.task);
  }
  if (JSON.stringify([...seenTasks].sort()) !== JSON.stringify(EXPECTED_TASKS)) {
    throw Error('Wave 1 tasks are incomplete');
  }
  return spec;
}

export async function verifyWave1Fixtures(spec, readSource) {
  validateWave1Spec(spec);
  for (const f of spec.fixtures) {
    const bytes = await readSource(f.path);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 65536 ||
        bytes.includes(0) || createHash('sha256').update(bytes).digest('hex') !== f.sha256) {
      throw Error('invalid or changed Wave 1 fixture: ' + f.id);
    }
  }
  return {
    schemaVersion: 1, fixturesPinned: spec.fixtures.length,
    tasksTracked: spec.tasks.length, backendTargets: spec.backends.length,
    compilerExecutions: 0, parityEstablished: false, status: 'CONTRACT_ONLY'
  };
}

export async function loadWave1() {
  const manifestPath = resolve(ROOT, 'contracts/wave1-parity.json');
  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw Error('Wave 1 manifest is not a regular file');
  }
  const spec = validateWave1Spec(JSON.parse(await readFile(manifestPath, 'utf8')));
  const result = await verifyWave1Fixtures(spec, async relative => {
    const absolute = resolve(ROOT, relative); // strict fixture-path regex disallows traversal
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Wave 1 fixture is not a regular file');
    return readFile(absolute);
  });
  return {spec, result};
}

