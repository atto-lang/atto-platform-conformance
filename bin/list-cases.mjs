#!/usr/bin/env node
/** Read-only AOT conformance case planner. This does not execute Atto guests. */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BACKENDS = ['java', 'llvm', 'wasm', 'forge', 'net'];
const CONTRACT = new URL('../contracts/aot-gc-tenant-evidence-v1.json', import.meta.url);

export function planConformance(manifest, backend = null) {
  const fail = message => { throw new Error('E_CONFORMANCE_PLAN: ' + message); };
  if (!manifest || manifest.schema !== 'atto.aot-gc-tenant-evidence.v1' ||
      manifest.status !== 'NOT_EXECUTED_ALL_BACKENDS') fail('unsupported or promoted manifest');
  if (backend !== null && !BACKENDS.includes(backend)) fail('unsupported backend');
  if (!Array.isArray(manifest.cases) || !Array.isArray(manifest.fixtures) ||
      !manifest.profiles || typeof manifest.profiles !== 'object' ||
      !manifest.default_statuses || typeof manifest.default_statuses !== 'object') {
    fail('missing contract cases, fixtures or profiles');
  }
  if (BACKENDS.some(name => manifest.default_statuses[name] !== 'NOT_EXECUTED') ||
      Object.keys(manifest.default_statuses).length !== BACKENDS.length) {
    fail('baseline claims unsupported execution');
  }
  const ids = new Set();
  const fixtureIds = new Set(manifest.fixtures.map(x => x.id));
  for (const c of manifest.cases) {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id) ||
        !fixtureIds.has(c.fixture) ||
        !['compiled-guest', 'tenant-security', 'memory-soak'].includes(c.kind) ||
        typeof c.require_tenant_security !== 'boolean' ||
        c.require_tenant_security !== (c.kind === 'tenant-security')) {
      fail('invalid or duplicate case');
    }
    ids.add(c.id);
  }
  const entries = [];
  for (const [profile, details] of Object.entries(manifest.profiles).sort(([a], [b]) => a.localeCompare(b))) {
    if (!details || !BACKENDS.includes(details.backend)) fail('unknown profile backend');
    if (backend !== null && details.backend !== backend) continue;
    for (const c of manifest.cases) {
      entries.push({
        profile, backend: details.backend, case_id: c.id, fixture: c.fixture,
        kind: c.kind, require_tenant_security: c.require_tenant_security,
        status: 'not_executed'
      });
    }
  }
  if (entries.length === 0) fail('no matching profiles or cases');
  return {
    schema: 'atto.conformance-plan.v1',
    source_contract: manifest.schema,
    certification: 'NOT_CERTIFIED',
    guest_executed: false,
    entries
  };
}

function main(args) {
  let backend = null;
  if (args.length === 2 && args[0] === '--backend') backend = args[1];
  else if (args.length !== 0) {
    console.error('usage: node bin/list-cases.mjs [--backend java|llvm|wasm|forge|net]');
    return 2;
  }
  try {
    const manifest = JSON.parse(readFileSync(CONTRACT, 'utf8'));
    const plan = planConformance(manifest, backend);
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href ===
    pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
