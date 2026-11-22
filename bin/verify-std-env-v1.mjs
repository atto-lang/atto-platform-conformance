#!/usr/bin/env node
// SOURCE-ONLY integrity and evidence-ceiling audit. Never claims .atto guest execution.
import {createHash} from 'node:crypto';
import {readFileSync, lstatSync, realpathSync} from 'node:fs';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../contracts/std-env-v1');
export const BACKENDS = Object.freeze([
  'java','llvm','net','rs','forge','cranelift','js','wasm','atto','realtime','hdl'
]);
export const API = Object.freeze([
  'get','has','get_or','get_required','get_nonempty',
  'get_required_nonempty','parse_bool','get_bool','get_bool_or'
]);
export const REQUIRED_CASES = Object.freeze([
  'basic-values','strict-bool','invalid-bool','required-missing-empty',
  'denied-fallback','denied-probe','coarse-denied','invalid-name',
  'oversized-value','host-ambient-hidden','independent-contexts',
  'package-no-shadow','present-empty-bool-fails'
]);
const HEX40 = /^[a-f0-9]{40}$/;
const CASE_ID = /^[a-z][a-z0-9-]{0,70}$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PATTERN = /^(?:\*|[A-Za-z_][A-Za-z0-9_]{0,127}\*?)$/;
const FIXTURE = /^(?:[a-z][a-z0-9_]*\/)*[a-z][a-z0-9_]*\.atto$/;
const err = (errors, text) => {errors.push(text);};

export function verifyStdEnvRegistry(data, root=ROOT) {
  const errors=[];
  if (!data || typeof data!=='object' || Array.isArray(data))
    return {ok:false,errors:['registry object missing']};
  if (data.schema!=='atto-std-env-guest-v1' || data.version!==1 ||
      data.feature!=='std/env' || data.claim_tier!=='SOURCE_ONLY_UNTIL_COMPILER_GUEST_RECEIPT')
    err(errors,'incorrect registry version, feature or claim tier');
  if (!Array.isArray(data.api) || JSON.stringify(data.api)!==JSON.stringify(API))
    err(errors,'wrong public API contract');
  if (!data.backends || Array.isArray(data.backends) ||
      JSON.stringify(Object.keys(data.backends).sort())!==JSON.stringify([...BACKENDS].sort()))
    err(errors,'missing or extra backend');
  else for (const backend of BACKENDS) {
    const state=data.backends[backend];
    // This ledger is a prospective target registry, never an execution receipt.
    if (state?.status!=='not_executed' || typeof state.reason!=='string' ||
        state.reason.length<10 || state.reason.length>512)
      err(errors,'backend '+backend+' cannot claim execution or implicit support');
  }
  if (!data.semantics || data.semantics.value_max_utf8_bytes!==16384 ||
      data.semantics.snapshot_max_keys!==512 ||
      data.semantics.snapshot_max_utf8_bytes!==1048576 ||
      data.semantics.coarse_env_capability_required!==true ||
      data.semantics.deny_before_value_lookup!==true ||
      data.semantics.ambient_process_environment_forbidden!==true ||
      data.semantics.absent_distinct_from_present_empty!==true ||
      data.semantics.must_not_echo_secret_values!==true ||
      JSON.stringify(data.semantics.bool_true)!==JSON.stringify(['true','1']) ||
      JSON.stringify(data.semantics.bool_false)!==JSON.stringify(['false','0']) ||
      data.semantics.portable_key_pattern!==KEY.source)
    err(errors,'security or API semantic drift');
  const hashes=data.fixture_git_blobs;
  if (!hashes || Array.isArray(hashes) || typeof hashes!=='object')
    err(errors,'fixture hash manifest missing');
  else {
    const actualFiles=new Set();
    for (const [name,expected] of Object.entries(hashes)) {
      if (!FIXTURE.test(name) || name.includes('..') || !HEX40.test(expected)) {
        err(errors,'invalid fixture path or SHA '+name);
        continue;
      }
      const abs=resolve(root,'fixtures',name);
      const base=resolve(root,'fixtures');
      if (!abs.startsWith(base+sep)) {err(errors,'fixture escape '+name);continue;}
      try {
        const physical=realpathSync(abs);
        if (!physical.startsWith(base+sep) || !lstatSync(abs).isFile() ||
            lstatSync(abs).isSymbolicLink()) {
          err(errors,'not a regular contained fixture '+name);continue;
        }
        const bytes=readFileSync(abs);
        if (bytes.length===0 || bytes.length>65536) {
          err(errors,'invalid fixture size '+name);continue;
        }
        const digest=createHash('sha1').update('blob '+bytes.length+'\0')
          .update(bytes).digest('hex');
        if (digest!==expected) err(errors,'fixture SHA mismatch '+name);
        actualFiles.add(name);
      } catch (failure) {
        err(errors,'missing or unreadable fixture '+name+': '+failure.code);
      }
    }
    if (Object.keys(hashes).length!==10) err(errors,'expected ten pinned fixture files');
    if (!actualFiles.has('shadow/std/env.atto'))
      err(errors,'required local shadow poison fixture missing');
  }
  if (!Array.isArray(data.cases) || data.cases.length!==REQUIRED_CASES.length)
    err(errors,'wrong case count');
  else {
    const seen=new Set();
    for(const c of data.cases) {
      if (!c || typeof c!=='object' || !CASE_ID.test(c.id??'')) {
        err(errors,'invalid case header');continue;
      }
      if (seen.has(c.id)) err(errors,'duplicate case '+c.id);
      seen.add(c.id);
      if (!FIXTURE.test(c.fixture??'') || !Object.hasOwn(hashes??{},c.fixture))
        err(errors,'case references unknown fixture '+c.id);
      if (c.coarse_env!==true && c.coarse_env!==false)
        err(errors,'missing coarse capability '+c.id);
      if (!c.environment || Array.isArray(c.environment) ||
          typeof c.environment!=='object')
        err(errors,'missing injected environment '+c.id);
      else for (const [key,value] of Object.entries(c.environment))
        if (!KEY.test(key) || typeof value!=='string' ||
            Buffer.byteLength(value,'utf8')>16384)
          err(errors,'invalid controlled value '+c.id);
      for (const field of ['allowed','denied']) {
        if (!Array.isArray(c[field]) || !c[field].every(p=>typeof p==='string'&&PATTERN.test(p)))
          err(errors,'invalid '+field+' rule '+c.id);
      }
      const expected=c.expected;
      if (!expected || !['stdout','stdout_sequence','runtime_error','admission_error'].includes(expected.kind))
        err(errors,'invalid expected outcome '+c.id);
      else if(expected.kind==='stdout' &&
              (!Array.isArray(expected.lines) || !expected.lines.length ||
                !expected.lines.every(x=>typeof x==='string')))
        err(errors,'invalid stdout lines '+c.id);
      else if(expected.kind==='stdout_sequence' &&
              (!Array.isArray(c.context_sequence) || c.context_sequence.length<2 ||
                !Array.isArray(expected.runs) ||
                expected.runs.length!==c.context_sequence.length))
        err(errors,'invalid isolation sequence '+c.id);
      else if(expected.kind.endsWith('_error') &&
              (typeof expected.category!=='string' ||
               !Array.isArray(expected.forbidden_output)))
        err(errors,'error case lacks category and secret-exclusion assertions '+c.id);
      if(c.id.startsWith('denied-') && !(c.denied?.includes('ATTO_ENV_SECRET_KEY')))
        err(errors,'deny-case must enforce explicit deny rule '+c.id);
      if(c.id==='coarse-denied' && c.coarse_env!==false)
        err(errors,'coarse denied unexpectedly elevated');
      if(c.id==='oversized-value' &&
         c.generated_environment?.ATTO_ENV_OVERSIZED?.byte_count!==16385)
        err(errors,'oversized value admission vector missing');
      if(c.id==='package-no-shadow' && c.fixture_dependency!=='shadow/std/env.atto')
        err(errors,'no canonical package shadow negative');
    }
    if (JSON.stringify([...seen].sort())!==JSON.stringify([...REQUIRED_CASES].sort()))
      err(errors,'required case IDs absent');
  }
  return {ok:errors.length===0,errors};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const data=JSON.parse(readFileSync(join(ROOT,'contract.json'),'utf8'));
  const result=verifyStdEnvRegistry(data);
  if (!result.ok) {
    for(const message of result.errors) console.error('FAIL std-env-v1: '+message);
    process.exitCode=1;
  } else {
    console.log('SOURCE_ONLY_REGISTRY_VALID cases=13 backends=11 pinned_fixtures=10');
    console.log('GUEST_PARITY=NOT_EXECUTED');
  }
}
