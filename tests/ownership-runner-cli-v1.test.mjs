import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/verify-ownership-runner-v1.mjs',import.meta.url));
const valid = [
  '--repo','ores-truffle-oreslang/oreslang-source.java',
  '--head','a'.repeat(40),'--run','31','--attempt','2','--job','41',
  '--required-step','Checkout exact source commit',
  '--required-step','Execute real ownership and primitive-copy JUnit tests'
];
const run = (args,token='sentinel-secret-do-not-print') => spawnSync(process.execPath,
  [bin,...args], {encoding:'utf8',timeout:8000,env:{...process.env,GITHUB_TOKEN:token}});
test('runner verifier CLI refuses invalid source, args and missing token without leaking secrets',()=>{
  const mutants=[
    ['foreign organization',valid.map((v,i)=>i===1?'foreign/private-source':v)],
    ['missing job id',valid.filter((v,i)=>i!==8 && i!==9)],
    ['bad run',valid.map((v,i)=>i===5?'not-a-number':v)],
    ['duplicate repo',valid.concat(['--repo','ores-truffle-oreslang/oreslang-source.llvm'])],
    ['unknown option',valid.concat(['--unknown','value'])]
  ];
  for(const [label,args] of mutants) {
    const r=run(args);
    assert.equal(r.status,2,label+' exit');
    assert.equal(r.stdout,'',label+' output');
    assert.doesNotMatch(r.stderr,/sentinel-secret-do-not-print/,label+' secret');
    assert.match(r.stderr,/RUNNER_PROVENANCE_NOT_VERIFIED/,label+' reason');
  }
  const noToken=run(valid,'');
  assert.equal(noToken.status,2);
  assert.equal(noToken.stdout,'');
});
