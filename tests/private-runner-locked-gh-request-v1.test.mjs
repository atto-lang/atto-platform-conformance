import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIVATE_RUNNER_CONTROL as p } from
  '../verification/qualify-private-runner-admission-v1.mjs';
import { pinnedRunnerApiRequest } from
  '../verification/private-runner-locked-gh-request-v1.mjs';

const env={GH_TOKEN:'synthetic-read-only-token'};
const build = (suffix,e=env) => pinnedRunnerApiRequest(suffix,e);

test('real canary run route is fixed to github.com using read-only GET',()=>{
 const x=build('/actions/runs/'+p.runId);
 assert.deepEqual(x.argv.slice(0,5),['api','--hostname','github.com','-X','GET']);
 assert.equal(x.argv.at(-1),'/repos/'+p.repository+'/actions/runs/'+p.runId);
 assert.equal(x.environment.GH_HOST,'github.com');
});
test('all five expected evidence REST endpoint forms remain available',()=>{
 for(const suffix of [
   '/actions/runs/'+p.runId,
   '/actions/runs/'+p.runId+'/attempts/14/jobs?per_page=100',
   '/actions/jobs/128180053317',
   '/actions/jobs/128180053317/logs',
   '/contents/'+p.workflowPath+'?ref='+p.sourceHead
 ]) {
   assert.ok(build(suffix).argv.at(-1).endsWith(suffix));
 }
});
test('host environment, proxy, repository and enterprise redirects are stripped',()=>{
 const x=build('/actions/runs/'+p.runId,{
   ...env,
   GH_HOST:'attacker.example',GH_REPO:'attacker/fake',
   GITHUB_API_URL:'https://attacker.example/api',
   GH_ENTERPRISE_TOKEN:'evil',
   GH_CONFIG_DIR:'/tmp/attacker-gh-config',
   HTTPS_PROXY:'http://attacker.example:8000',
   HTTP_PROXY:'http://attacker.example:8000',
   ALL_PROXY:'socks5://attacker.example:9050',
   GIT_CONFIG_GLOBAL:'/tmp/attacker-git-config',
   NODE_OPTIONS:'--require /tmp/attacker.js'
 });
 for(const bad of [
   'GH_ENTERPRISE_TOKEN','GH_CONFIG_DIR','GH_REPO','HTTPS_PROXY',
   'HTTP_PROXY','ALL_PROXY','GIT_CONFIG_GLOBAL','GITHUB_API_URL','NODE_OPTIONS'
 ]) assert.equal(x.environment[bad],undefined,bad);
 assert.equal(x.environment.GH_HOST,'github.com');
 assert.equal(x.environment.GH_PROMPT_DISABLED,'1');
});
test('token never appears in process arguments or endpoint strings',()=>{
 const x=build('/actions/runs/'+p.runId,{GH_TOKEN:'SENSITIVE_TOKEN_123'});
 assert.equal(x.argv.join(' ').includes('SENSITIVE_TOKEN_123'),false);
 assert.equal(x.environment.GH_TOKEN,'SENSITIVE_TOKEN_123');
});
test('GITHUB_TOKEN fallback requires no saved gh credentials',()=>{
 const x=build('/actions/runs/'+p.runId,{GITHUB_TOKEN:'synthetic-fallback'});
 assert.equal(x.environment.GH_TOKEN,'synthetic-fallback');
 assert.equal(x.environment.GITHUB_TOKEN,undefined);
});
test('missing, blank and malformed tokens fail closed',()=>{
 for(const v of [{},{GH_TOKEN:''},{GH_TOKEN:'line\nbreak'},{GH_TOKEN:'x'.repeat(16385)}]){
   assert.throws(()=>build('/actions/runs/'+p.runId,v));
 }
});
test('foreign repository or arbitrary API scopes never qualify as evidence',()=>{
 for(const suffix of [
   '/repos/attacker/example/actions/runs/'+p.runId,
   '/actions/runs/'+(p.runId+1),
   '/actions/permissions',
   '/actions/runners',
   '/issues',
   '/contents/README.md?ref=main',
   '/actions/runs/'+p.runId+'/rerun',
   '/actions/jobs/123/re-run'
 ]) assert.throws(()=>build(suffix),suffix);
});
test('endpoint traversal, query injection and suffix tricks reject',()=>{
 for(const suffix of [
   '/actions/runs/'+p.runId+'/../other',
   '/actions/runs/'+p.runId+'?page=other',
   '/actions/runs/'+p.runId+'/attempts/14/jobs?per_page=100&foo=bar',
   '/actions/runs/'+p.runId+'/attempts/13/jobs?per_page=100',
   '/actions/runs/'+p.runId+'/attempts/0/jobs?per_page=100',
   '/actions/jobs/0',
   '/actions/jobs/42/logs?raw=true',
   '//evil.example/',
   null,
   ['actions','runs']
 ]) assert.throws(()=>build(suffix),String(suffix));
});
test('unsafe bigint-like job identifiers and attempts reject',()=>{
 const tooBig='9'.repeat(100);
 assert.throws(()=>build('/actions/jobs/'+tooBig));
 assert.throws(()=>build('/actions/runs/'+p.runId+'/attempts/'+tooBig+'/jobs?per_page=100'));
});
test('host and HTTP method cannot be supplied by caller',()=>{
 assert.throws(()=>build('https://evil.example/repos/'+p.repository));
 const x=build('/actions/jobs/12345/logs',{GH_TOKEN:'safe',GH_HOST:'evil.example'});
 assert.ok(x.argv.includes('GET'));
 assert.ok(x.argv.includes('github.com'));
 assert.equal(x.argv.includes('POST'),false);
});
