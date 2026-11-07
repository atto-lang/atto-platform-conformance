#!/usr/bin/env node
// After-the-fact SOURCE-org runner metadata check. Exit 0 confirms ONLY
// assigned-runner/required-step GitHub API facts, never guest correctness.
import { inspectExactHeadRunner, githubReadOnlyReader } from '../src/ownership-runner-provenance-v1.mjs';

function parse(argv) {
  const opts={},requiredSteps=[];
  const supported=new Set(['--repo','--head','--run','--attempt','--job','--required-step']);
  for(let i=0;i<argv.length;i+=2) {
    const key=argv[i],value=argv[i+1];
    if(!supported.has(key) || typeof value!=='string' ||
       value.length===0 || value.startsWith('--')) throw Error('INVALID_ARGUMENTS');
    if(key==='--required-step') requiredSteps.push(value);
    else {
      if(Object.hasOwn(opts,key)) throw Error('DUPLICATE_ARGUMENT');
      opts[key]=value;
    }
  }
  const repository=opts['--repo'];
  if(typeof repository!=='string' || !repository.startsWith('ores-truffle-oreslang/'))
    throw Error('SOURCE_ORGANIZATION_REQUIRED');
  for(const key of ['--head','--run','--attempt','--job'])
    if(!Object.hasOwn(opts,key)) throw Error('MISSING_ARGUMENT:'+key);
  for(const key of ['--run','--attempt','--job'])
    if(!/^[1-9][0-9]*$/.test(opts[key]))throw Error('INVALID_NUMERIC_ARGUMENT');
  return {
    repository,expectedHead:opts['--head'],runId:Number(opts['--run']),
    attempt:Number(opts['--attempt']),jobId:Number(opts['--job']),
    requiredSteps
  };
}
async function main() {
  try {
    const options=parse(process.argv.slice(2));
    const read=githubReadOnlyReader(process.env.GITHUB_TOKEN);
    const result=await inspectExactHeadRunner({...options,read});
    // No token or source bytes are returned or printed. This only checks
    // runner metadata, not source checkout or compiler-backed guest cases.
    process.stdout.write(JSON.stringify(result)+'\n');
    process.exitCode=result.runnerExecutionVerified===true?0:1;
  }catch {
    process.stderr.write('RUNNER_PROVENANCE_NOT_VERIFIED: invalid input, token or API access\n');
    process.exitCode=2;
  }
}
await main();
