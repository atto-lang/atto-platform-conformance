// AttoLang LLVM M0: compiler admission only. Never promote to guest-thread parity.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const caseIds = Object.freeze([
  'unqualified-spawn', 'qualified-spawn', 'lexical-whitespace',
  'initializer-spawn', 'generic-spawn', 'generic-qualified-spawn',
  'qualified-spawn-whitespace', 'spawn-with-comment',
  'bare-thread-spawn-value', 'bare-qualified-spawn-value',
  'ordinary-thread-identifier',
]);
export const expectedDiagnostic = 'THREAD_SPAWN_BACKEND_UNSUPPORTED';
export const fixtureDir = fileURLToPath(new URL('../fixtures/llvm-thread-m0/', import.meta.url));
const hex40 = /^[a-f0-9]{40}$/;
const digest = data => createHash('sha256').update(data).digest('hex');

export function runLlvmThreadM0({compiler, sourceHead, sourceTree, root = fixtureDir,
  timeoutMs = 10000, extraEnv = {}} = {}) {
  if (!compiler) return {status:'NOT_EXECUTED', stage:'compiler-admission', guestExecuted:false,
    reason:'no LLVM compiler path configured', cases:[]};
  if (typeof compiler !== 'string' || !isAbsolute(compiler) ||
      !statSync(compiler, {throwIfNoEntry:false})?.isFile())
    throw Error('INVALID_COMPILER_PATH');
  if (!hex40.test(sourceHead ?? '') || !hex40.test(sourceTree ?? ''))
    throw Error('UNVERIFIED_SOURCE_REVISION');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    throw Error('INVALID_TIMEOUT');
  const compilerDigest = digest(readFileSync(compiler));
  const temporary = mkdtempSync(join(tmpdir(), 'atto-llvm-m0-'));
  const results = [];
  try {
    for (const id of caseIds) {
      const caseDir = join(temporary, id);
      mkdirSync(caseDir);
      const source = join(caseDir, id+'.atto');
      copyFileSync(resolve(root, id+'.atto'), source);
      const sourceBefore = digest(readFileSync(source));
      const result = spawnSync(compiler, [source], {
        cwd:caseDir, shell:false, encoding:'utf8', timeout:timeoutMs,
        maxBuffer:2*1024*1024, env:{...process.env, ...extraEnv},
      });
      const positive = id === 'ordinary-thread-identifier';
      const statusOk = positive ? result.status === 0 :
        Number.isInteger(result.status) && result.status !== 0;
      const outputOk = positive ? /\bdefine\b/.test(result.stdout || '') :
        result.stdout === '' && (result.stderr || '').includes(expectedDiagnostic);
      const artifacts = readdirSync(caseDir).filter(name => name !== basename(source));
      const sourceAfter = digest(readFileSync(source));
      const passed = !result.error && !result.signal && statusOk && outputOk &&
        artifacts.length === 0 && sourceAfter === sourceBefore;
      results.push({id,pass:passed,exitCode:result.status,
        sourceSha256:sourceBefore,artifacts,sourceUnchanged:sourceAfter===sourceBefore,
        diagnosticSeen:!positive && (result.stderr || '').includes(expectedDiagnostic),
        llvmIRSeen:positive && /\bdefine\b/.test(result.stdout || ''),
        error:result.error?.code || result.error?.message || null});
    }
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }
  return {status:results.every(r=>r.pass)?'PASS_COMPILER_ADMISSION_ONLY':'FAIL',
    stage:'compiler-admission',backend:'llvm',guestExecuted:false,
    sourceHeadSuppliedNotAttested:sourceHead,sourceTreeSuppliedNotAttested:sourceTree,
    compilerSha256:compilerDigest,cases:results};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const at=a.indexOf('='); return at>2&&a.startsWith('--')?[a.slice(2,at),a.slice(at+1)]:[a.slice(2),''];
  }));
  try {
    const result=runLlvmThreadM0({compiler:args.compiler,sourceHead:args.head,sourceTree:args.tree});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if (result.status !== 'PASS_COMPILER_ADMISSION_ONLY') process.exitCode=1;
  } catch(error) {
    process.stderr.write('ATTO_LLVM_M0_INVALID: '+error.message+'\n');
    process.exitCode=1;
  }
}
