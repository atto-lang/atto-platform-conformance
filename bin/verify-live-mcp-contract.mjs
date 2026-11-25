import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const path = resolve(dirname(fileURLToPath(import.meta.url)),
  '../contracts/live-devtools-mcp-v1.json');
const contract = JSON.parse(readFileSync(path, 'utf8'));
const requiredBackends = ['java', 'llvm', 'wasm', 'forge', 'net'];
const requiredCases = [
  'mcp.loopback_only', 'mcp.auth_required', 'mcp.origin_host_rebinding',
  'mcp.version_headers', 'mcp.bad_json_bounded',
  'mcp.discover_tools_read_only', 'runtime.real_actor_count',
  'runtime.actor_state_sealed', 'runtime.snapshot_consistency',
  'hotload.generation_quiescence', 'hotload.migration_rollback',
  'hotload.aot_capability_denial'
];
const valid = new Set(['NOT_EXECUTED', 'HOST_PROTOCOL_TESTED',
  'REAL_RUNTIME_EXECUTED', 'BACKEND_PARITY_VERIFIED']);

export function verify(data) {
  if (data?.schema !== 'attolang.live-devtools-mcp/1'
      || data.protocol !== '2026-07-28') throw Error('wrong contract version');
  if (JSON.stringify(data.backends) !== JSON.stringify(requiredBackends))
    throw Error('missing/reordered backend inventory');
  if (!Array.isArray(data.cases) ||
      JSON.stringify(data.cases.map(c => c.id)) !== JSON.stringify(requiredCases))
    throw Error('missing/reordered/duplicated conformance cases');
  for (const c of data.cases) {
    if (!valid.has(c.status) || !['host-protocol', 'runtime', 'backend'].includes(c.tier))
      throw Error('invalid status or tier: ' + c.id);
    if (typeof c.expected !== 'string' || c.expected.length < 10
        || !Array.isArray(c.evidence)) throw Error('invalid case: ' + c.id);
    if (c.status !== 'NOT_EXECUTED') {
      if (!c.evidence.length) throw Error('status promoted without evidence: ' + c.id);
      for (const proof of c.evidence) {
        if (!proof || typeof proof.commit_sha !== 'string'
            || !/^[0-9a-f]{40}$/.test(proof.commit_sha)
            || typeof proof.command !== 'string' || !proof.command.trim()
            || typeof proof.run_url !== 'string'
            || !/^https:\/\//.test(proof.run_url)
            || proof.steps_executed !== true || proof.result !== 'PASS') {
          throw Error('incomplete or zero-step execution evidence: ' + c.id);
        }
        if (c.status === 'REAL_RUNTIME_EXECUTED' &&
            proof.execution_target !== 'real-attolang-actor-runtime') {
          throw Error('host mock cannot promote runtime evidence: ' + c.id);
        }
        if (c.status === 'BACKEND_PARITY_VERIFIED' &&
            (!Array.isArray(proof.executed_backends)
             || JSON.stringify(proof.executed_backends) !== JSON.stringify(requiredBackends)
             || proof.guest_source_extension !== '.atto')) {
          throw Error('backend parity needs real .atto evidence: ' + c.id);
        }
      }
    }
  }
  if (!Array.isArray(data.promotion_rules) || data.promotion_rules.length < 5)
    throw Error('promotion policy is incomplete');
  return { total: data.cases.length,
    executed: data.cases.filter(c => c.status !== 'NOT_EXECUTED').length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = verify(contract);
  process.stdout.write(JSON.stringify(result) + '\n');
}
