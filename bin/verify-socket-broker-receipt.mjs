// Structural-only receipt validation. Never authenticates CI or guest execution.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const contract = JSON.parse(fs.readFileSync(
  path.join(root, 'contracts/tenant-socket-isolation-v1.json'), 'utf8'));
const sha40 = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
export function verify_receipt(r) {
  if (!r || typeof r !== 'object' || !contract.receipt.allowed_statuses.includes(r.status)) {
    throw Error('STATUS');
  }
  if (!Object.hasOwn(contract.backends, r.backend)) throw Error('BACKEND');
  if (!contract.case_ids.includes(r.case_id)) throw Error('CASE');
  if (r.status !== 'passed') {
    if (typeof r.reason !== 'string' || r.reason.trim().length < 8) throw Error('REASON');
    return true;
  }
  for (const key of ['exact_head_sha', 'source_tree_sha']) {
    if (!sha40.test(r[key] ?? '')) throw Error('SOURCE_SHA:' + key);
  }
  for (const key of ['compiled_atto_guest_sha256', 'sandbox_artifact_sha256']) {
    if (!sha256.test(r[key] ?? '')) throw Error('ARTIFACT_SHA:' + key);
  }
  if (r.guest_executed !== true || !Number.isSafeInteger(r.executed_steps) || r.executed_steps < 1) {
    throw Error('NO_GUEST_EXECUTION');
  }
  if (typeof r.toolchain !== 'string' || r.toolchain.length < 4 ||
      typeof r.workflow_url !== 'string' || !r.workflow_url.startsWith('https://github.com/') ||
      typeof r.observed_outcome !== 'string' || r.observed_outcome.trim().length < 10) {
    throw Error('PROVENANCE_MISSING');
  }
  if (!r.sandbox_boundary || r.sandbox_boundary.verified !== true ||
      r.sandbox_boundary.guest_direct_syscalls_denied !== true ||
      r.sandbox_boundary.guest_raw_fd_access_denied !== true) {
    throw Error('SANDBOX_NOT_PROVEN');
  }
  if (!Array.isArray(r.tenant_pids) || r.tenant_pids.length !== 2 ||
      !r.tenant_pids.every(p => Number.isSafeInteger(p) && p > 0) ||
      r.tenant_pids[0] !== r.tenant_pids[1] ||
      !Array.isArray(r.distinct_tenant_ids) || r.distinct_tenant_ids.length !== 2 ||
      r.distinct_tenant_ids[0] === r.distinct_tenant_ids[1]) {
    throw Error('NOT_TWO_TENANTS_SAME_PID');
  }
  // These fields alone are never trustworthy: independently verify artifacts,
  // job steps, compiler, actual OS PIDs and the host boundary before certification.
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('usage: node bin/verify-socket-broker-receipt.mjs receipt.json');
    process.exitCode = 2;
  } else {
    try {
      verify_receipt(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
      console.log('STRUCTURE_ONLY_NOT_INDEPENDENT_GUEST_PROOF');
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
