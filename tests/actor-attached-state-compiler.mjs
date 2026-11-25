// Portable compiler admission gate for the actor-attached-state target corpus.
// This invokes a real compiler but is intentionally NOT a guest/lifecycle parity proof.
// Usage:
//   ATTO_ACTOR_STATE_BACKEND=atto-source.rs ATTO_COMPILER_BIN=/abs/path/attoc
//   ATTO_SOURCE_SHA=<40hex> ATTO_COMPILER_ARGS_JSON='["{source}","-o","{artifact}"]'
//   ATTO_EXPECT_DIAGNOSTICS_JSON='{"inline_and_attached":"E_DUPLICATE",...}'
//   node tests/actor-attached-state-compiler.mjs
//
// No shell, Python, cross-org tokens, mock compiler or silent skips.
// Status remains COMPILER_ONLY even if all source shapes compile as specified.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const registry = JSON.parse(readFileSync(join(root,'contracts/actor-attached-state-v1.json'),'utf8'));
const backend = process.env.ATTO_ACTOR_STATE_BACKEND;
const compiler = process.env.ATTO_COMPILER_BIN;
const sourceSha = process.env.ATTO_SOURCE_SHA;
assert.ok(Object.hasOwn(registry.backend_status, backend ?? ''),'Unknown target backend');
assert.ok(compiler && isAbsolute(compiler) && existsSync(compiler),'ATTO_COMPILER_BIN must be an existing absolute executable');
assert.match(sourceSha ?? '',/^[0-9a-f]{40}$/,'Exact backend source SHA required');
const argvTemplate = JSON.parse(process.env.ATTO_COMPILER_ARGS_JSON ?? '["{source}","-o","{artifact}"]');
const expectedDiagnostics = JSON.parse(process.env.ATTO_EXPECT_DIAGNOSTICS_JSON ?? '{}');
assert.ok(Array.isArray(argvTemplate) && argvTemplate.length > 0 && argvTemplate.every(x => typeof x === 'string'));
assert.ok(argvTemplate.some(x => x.includes('{source}')) && argvTemplate.some(x => x.includes('{artifact}')),
  'compiler argv must declare source and artifact substitutions');
const expectedNegativeIds = registry.required_cases.filter(x => x.kind==='fail').map(x=>x.id);
for (const id of Object.keys(expectedDiagnostics)) {
  assert.ok(expectedNegativeIds.includes(id), 'unrecognized diagnostic mapping '+id);
  assert.match(expectedDiagnostics[id],/^E_[A-Z][A-Z0-9_]*$/);
}

const dir = mkdtempSync(join(tmpdir(),'atto-actor-state-'));
const results = [];
try {
  for (const c of registry.required_cases) {
    const source = resolve(root,c.path);
    assert.ok(source.startsWith(root+'/') && existsSync(source),'Missing fixture '+c.path);
    const artifact = join(dir,c.id+'.guest');
    const args = argvTemplate.map(x => x.replaceAll('{source}',source).replaceAll('{artifact}',artifact));
    const run = spawnSync(compiler,args,{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
    const diagnostics = (run.stderr ?? '')+'\n'+(run.stdout ?? '');
    const actualCode = diagnostics.match(/\bE_[A-Z0-9_]+\b/)?.[0] ?? null;
    const exists = existsSync(artifact) && statSync(artifact).size>0;
    let status;
    if (run.error || run.signal || (run.status !== 0 && run.status !== 1)) {
      status = 'INFRA_FAILURE';
    } else if (c.kind === 'pass') {
      status = run.status===0 && exists ? 'COMPILED_GUEST_NOT_EXECUTED'
        : actualCode==='E_UNSUPPORTED' || actualCode==='E_UNSUPPORTED_TYPE'
          ? 'UNSUPPORTED' : 'FAILED';
    } else if (run.status===0 || exists) {
      status = 'FAILED';
    } else if (actualCode==='E_UNSUPPORTED' || actualCode==='E_UNSUPPORTED_TYPE') {
      status = 'UNSUPPORTED';
    } else if (actualCode && expectedDiagnostics[c.id]===actualCode) {
      status = 'DIAGNOSTIC_AND_ZERO_ARTIFACT_VERIFIED';
    } else {
      status = 'REJECTED_DIAGNOSTIC_NOT_VERIFIED';
    }
    results.push({
      id:c.id, kind:c.kind, status, diagnostic:actualCode, artifact_emitted:exists,
      process_status:run.status, process_signal:run.signal ?? null,
      error:run.error?.message ?? null
    });
  }
} finally {
  rmSync(dir,{recursive:true,force:true});
}
const counts=results.reduce((o,r)=>(o[r.status]=(o[r.status]||0)+1,o),{});
const receipt={
  schema:'atto.actor.attached-state.compiler-admission-receipt.v1',
  backend, backend_source_sha:sourceSha,
  scope:'COMPILER_ONLY_NO_GUEST_EXECUTION',
  result:results.some(r=>r.status==='FAILED'||r.status==='INFRA_FAILURE')?'FAILED'
    :results.some(r=>r.status==='UNSUPPORTED')?'UNSUPPORTED'
    :results.some(r=>r.status==='REJECTED_DIAGNOSTIC_NOT_VERIFIED')?'INCOMPLETE'
    : 'COMPILER_ONLY',
  counts, results,
  warning:'Never mark backend PASS from this receipt; execute real compiled actor guest, mailbox drain and TenantVM runtime tests separately'
};
console.log('ATTO_ACTOR_ATTACHED_STATE_RECEIPT='+JSON.stringify(receipt));
if (['FAILED','INCOMPLETE'].includes(receipt.result)) process.exitCode=1;
