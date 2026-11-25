import {readFileSync, lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const REQUIRED_BACKENDS = Object.freeze({
  java: '1448697198', llvm: '1448700962', wasm: '1448701355',
  net: '1448702222', forge: '1448701874', cranelift: '1448702554',
  rs: '1448702852', js: '1448703338', hdl: '1448703717',
  atto: '1461897456', realtime: '1448704177'
});
export const REQUIRED_WORKSTREAMS = Object.freeze([
  'operator_caret_xor', 'checked_i64', 'float_int_division', 'inline_sync_task',
  'trap_result', 'functional_pipelines', 'sealed_actor_state',
  'pointer_ownership', 'tenant_vm_isolation', 'permissions_io', 'module_imports'
]);
const sha = /^[0-9a-f]{40}$/;
const prUrl = /^https:\/\/github\.com\/atto-lang\/(atto-source\.(?:java|llvm|wasm|net|forge|cranelift|rs|js|hdl|atto|realtime))\/pull\/[1-9][0-9]*$/;
const refUrl = /^https:\/\/github\.com\/atto-lang\/[A-Za-z0-9._-]+\/(?:pull|issues)\/[1-9][0-9]*$/;
const reject = (why) => { throw new Error('ELEVEN_BACKEND_PARITY_DENIED: ' + why); };
const exactKeys = (obj, keys, why) => {
  if (!obj || Array.isArray(obj) || typeof obj !== 'object') reject(why + ': invalid object');
  const actual = Object.keys(obj).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) reject(why + ': unexpected or missing keys');
};
export function validateParityIndex(data) {
  exactKeys(data, ['schema','snapshot_date','source_of_truth','conformance_authority','evidence_gate','release_qualified','notes','workstreams','backends'], 'registry');
  if (data.schema !== 'atto.eleven-backend-cross-contract-parity.v1' ||
      data.source_of_truth !== 'atto-lang/atto-spec' ||
      data.conformance_authority !== 'atto-lang/atto-platform-conformance' ||
      data.evidence_gate !== 'source_inventory_only' || data.release_qualified !== false ||
      !/^\d{4}-\d\d-\d\d$/.test(data.snapshot_date) || !data.notes) reject('unsafe registry header');
  if (!Array.isArray(data.workstreams) || data.workstreams.length !== REQUIRED_WORKSTREAMS.length) reject('workstream count');
  const workIds = new Set();
  for (const w of data.workstreams) {
    exactKeys(w, ['id','title','reference','approval_state','support_claim'], 'workstream');
    if (!REQUIRED_WORKSTREAMS.includes(w.id) || workIds.has(w.id) || typeof w.title !== 'string' ||
        !refUrl.test(w.reference) || w.approval_state !== 'candidate_or_tracking' ||
        w.support_claim !== 'none') reject('invalid workstream or false approval');
    workIds.add(w.id);
  }
  if (!Array.isArray(data.backends) || data.backends.length !== Object.keys(REQUIRED_BACKENDS).length) reject('backend count');
  const seen = new Set();
  let cells = 0;
  for (const b of data.backends) {
    exactKeys(b, ['id','repository','repository_id','observed_main_sha','profile','observed_main_protected','release_qualified','features'], 'backend');
    if (!Object.hasOwn(REQUIRED_BACKENDS, b.id) || seen.has(b.id) ||
        b.repository !== 'atto-lang/atto-source.' + b.id ||
        b.repository_id !== REQUIRED_BACKENDS[b.id] ||
        !sha.test(b.observed_main_sha) || !b.profile ||
        b.observed_main_protected !== false || b.release_qualified !== false) reject('unverified backend or identity');
    seen.add(b.id);
    exactKeys(b.features, REQUIRED_WORKSTREAMS, 'feature coverage');
    for (const [id, cell] of Object.entries(b.features)) {
      exactKeys(cell, ['state','evidence','candidate_prs'], 'feature cell');
      // v1 is deliberately SOURCE INVENTORY ONLY. To admit a real pass, first
      // add a trusted, externally attested evidence-verifier contract in v2.
      if (cell.state !== 'not_executed' || cell.evidence !== null ||
          !Array.isArray(cell.candidate_prs) || cell.candidate_prs.length > 10) reject('forged guest status / receipt');
      const urls = new Set();
      for (const url of cell.candidate_prs) {
        const match = typeof url === 'string' ? url.match(prUrl) : null;
        if (!match || match[1] !== 'atto-source.' + b.id || urls.has(url)) reject('invalid or cross-repo candidate PR');
        urls.add(url);
      }
      cells++;
    }
  }
  if (cells !== 121 || seen.size !== 11) reject('incomplete coverage');
  return {backends: seen.size, workstreams: workIds.size, cells, guest_passes: 0};
}
export function loadParityIndex(path = fileURLToPath(new URL('../contracts/eleven-backend-parity-v1/index.json', import.meta.url))) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) reject('registry is not a regular file');
  const raw = readFileSync(path, 'utf8');
  // Reject duplicate keys by verifying stable canonical formatting; require
  // the reviewed JSON artifact, never a lossy map loaded from arbitrary text.
  const parsed = JSON.parse(raw);
  if (raw !== JSON.stringify(parsed, null, 2) + '\n') reject('noncanonical/duplicate-key-prone registry');
  return parsed;
}
