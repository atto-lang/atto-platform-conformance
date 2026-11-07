// Source-free adversarial tests of the actual Git fetch boundary checker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectGitBoundary,parseGitNullConfig} from '../tools/merge-wave-git-boundary-v1.mjs';

const ORIGIN='https://github.com/ores-truffle-oreslang/oreslang-platform-conformance';
const row=(key,value)=>key+'\n'+value+'\0';
const config=(extra=[])=>row('remote.origin.url',ORIGIN)+extra.map(([k,v])=>row(k,v)).join('');
const sample=(changes={})=>({phase:'preflight',origin:ORIGIN,configText:config(),env:{},...changes});
const admit=(v)=>inspectGitBoundary(v);
const safe=r=>{assert.equal(r.preflight_ok,true,JSON.stringify(r.blockers));
 assert.equal(r.status,'STRUCTURAL_CHECK_ONLY');assert.equal(r.merge_authorized,false);
 assert.equal(r.guest_certified,false);};
const denied=(r,code)=>{assert.equal(r.preflight_ok,false);assert.equal(r.status,'BLOCKED');
 assert.equal(r.merge_authorized,false);assert.equal(r.guest_certified,false);
 assert(r.blockers.includes(code),JSON.stringify(r.blockers));};

test('canonical HTTPS origin with no overrides is structurally acceptable',()=>safe(admit(sample())));
test('canonical HTTPS origin with .git suffix is structurally acceptable',()=>safe(admit(sample({
 origin:ORIGIN+'.git',configText:row('remote.origin.url',ORIGIN+'.git')
}))));
test('postflight with no residual token is structurally acceptable',()=>safe(admit(sample({phase:'postflight'}))));
test('ordinary safe user and core metadata does not block',()=>safe(admit(sample({
 configText:config([['user.name','Atto CI'],['core.filemode','true'],['core.repositoryformatversion','0']])
}))));
for(const [key,value] of [
 ['GIT_TERMINAL_PROMPT','0'],['GIT_OPTIONAL_LOCKS','0'],['GIT_NO_REPLACE_OBJECTS','1']
]){
 test('safe Git runtime variable '+key,()=>safe(admit(sample({env:{[key]:value}}))));
}
const envAttacks=[
 ['GIT_CONFIG_COUNT','1'],['GIT_CONFIG_KEY_0','url.attack.insteadOf'],
 ['GIT_CONFIG_VALUE_0','https://evil.example'],['GIT_CONFIG_GLOBAL','/tmp/evil'],
 ['GIT_CONFIG_SYSTEM','/tmp/system'],['GIT_CONFIG_NOSYSTEM','1'],
 ['GIT_CONFIG_PARAMETERS','http.extraheader=secret'],['GIT_ALTERNATE_OBJECT_DIRECTORIES','/tmp/objects'],
 ['GIT_OBJECT_DIRECTORY','/tmp/objects'],['GIT_DIR','/tmp/other.git'],
 ['GIT_WORK_TREE','/tmp/elsewhere'],['GIT_INDEX_FILE','/tmp/index'],
 ['GIT_NAMESPACE','alternate'],['GIT_REPLACE_REF_BASE','refs/replace/'],
 ['GIT_SSH_COMMAND','sh -c whoami'],['GIT_ASKPASS','/tmp/askpass'],
 ['GIT_TRACE','/tmp/git.trace'],['GIT_TRACE_PACKET','1'],
 ['GIT_CEILING_DIRECTORIES','/tmp'],['GIT_PROXY_COMMAND','/tmp/proxy'],
 ['GH_TOKEN','secret'],['GITHUB_TOKEN','secret'],['FETCH_TOKEN','secret'],
 ['SSH_ASKPASS','/tmp/askpass'],['NODE_OPTIONS','--require=/tmp/agent.cjs'],
 ['LD_PRELOAD','/tmp/lib.so'],['LD_LIBRARY_PATH','/tmp/lib'],
 ['BASH_ENV','/tmp/bashenv'],['ENV','/tmp/env'],
 ['HTTPS_PROXY','https://evil.example'],['HTTP_PROXY','http://evil.example'],
 ['ALL_PROXY','socks5://evil.example'],['https_proxy','http://evil.example'],
 ['GIT_TERMINAL_PROMPT','1'],['GIT_OPTIONAL_LOCKS','1'],['GIT_NO_REPLACE_OBJECTS','0']
];
for(const [key,value] of envAttacks){
 test('reject inherited process override '+key,()=>denied(
  admit(sample({env:{[key]:value}})),'INHERITED_ENVIRONMENT_OVERRIDE'));
}
const configAttacks=[
 ['url.https://evil.example/.insteadof','https://github.com/'],
 ['url.https://evil.example/.pushinsteadof','https://github.com/'],
 ['http.https://github.com/.extraheader','AUTHORIZATION: basic c2VjcmV0'],
 ['http.proxy','http://evil.example'],['http.sslverify','false'],
 ['credential.helper','!evil'],['credential.https://github.com.username','attacker'],
 ['remote.origin.pushurl','https://evil.example/steal'],['remote.origin.uploadpack','sh -c echo'],
 ['remote.origin.proxy','evil'],['remote.backup.url','https://evil.example'],
 ['core.sshcommand','sh -c evil'],['core.hookspath','/tmp/evil-hooks'],
 ['core.fsmonitor','/tmp/fake'],['core.gitproxy','/tmp/proxy'],
 ['core.worktree','/tmp/other'],['extensions.worktreeconfig','true'],
 ['protocol.ext.allow','always'],['protocol.file.allow','always'],
 ['include.path','/tmp/evil'],['includeif.gitdir:/.path','/tmp/evil'],
 ['filter.secret.smudge','sh -c evil'],['submodule.payload.url','https://evil.example'],
 ['alias.fetch','!evil']
];
for(const [key,value] of configAttacks){
 test('reject redirect or credential config '+key,()=>denied(
  admit(sample({configText:config([[key,value]])})),'CONFIG_REDIRECT_OR_CREDENTIAL_OVERRIDE'));
}
const remoteAttacks=[
 'http://github.com/ores-truffle-oreslang/oreslang-platform-conformance',
 'ssh://git@github.com/ores-truffle-oreslang/oreslang-platform-conformance',
 'git@github.com:ores-truffle-oreslang/oreslang-platform-conformance.git',
 'https://token@github.com/ores-truffle-oreslang/oreslang-platform-conformance',
 'https://github.com.evil.example/ores-truffle-oreslang/oreslang-platform-conformance',
 'https://evil.example/github.com/ores-truffle-oreslang/oreslang-platform-conformance',
 'https://github.com/ores-truffle-oreslang/oreslang-source.java',
 ORIGIN+'/other',ORIGIN+'?token=secret',ORIGIN+'#ref',
 ORIGIN+'/', 'HTTPS://GITHUB.COM/ores-truffle-oreslang/oreslang-platform-conformance',
 'https://github.com/ores-truffle-oreslang/oreslang-platform-conformance.git/..'
];
for(const value of remoteAttacks){
 test('reject noncanonical remote '+value,()=>denied(
  admit(sample({origin:value,configText:row('remote.origin.url',value)})),'REMOTE_ORIGIN_UNVERIFIED'));
}
test('URL rewrite is rejected when displayed expanded origin looks canonical',()=>{
 const r=admit(sample({configText:config([['url.https://evil.example/.insteadof','https://github.com/']])}));
 denied(r,'CONFIG_REDIRECT_OR_CREDENTIAL_OVERRIDE');
});
test('remote get-url disagreement with raw origin config is blocked',()=>denied(
 admit(sample({origin:ORIGIN+'.git'})),'CONFIG_REMOTE_ORIGIN_MISMATCH'));
test('duplicate remote origins are rejected even when both identical',()=>denied(
 admit(sample({configText:config([['remote.origin.url',ORIGIN]])})),'CONFIG_DUPLICATE_KEY'));
test('no configured remote origin rejects',()=>denied(
 admit(sample({configText:row('core.filemode','true')})),'CONFIG_REMOTE_IDENTITY_UNVERIFIED'));
test('invalid phase rejects',()=>denied(
 admit(sample({phase:'release'})),'PHASE_INVALID'));
test('missing phase rejects',()=>denied(
 admit(sample({phase:undefined})),'PHASE_INVALID'));
test('nonstring origin cannot coerce with toString',()=>denied(
 admit(sample({origin:{toString:()=>ORIGIN}})),'REMOTE_ORIGIN_UNVERIFIED'));
for(const [name,bad] of [
 ['truncated record',row('remote.origin.url',ORIGIN).slice(0,-1)],
 ['bare invalid record','remote.origin.url\0'],
 ['empty key','\nsecret\0'],
 ['empty value','remote.origin.url\n\0'],
 ['newlines in URL config value',row('remote.origin.url',ORIGIN+'\nother')],
 ['control byte in URL config value',row('remote.origin.url',ORIGIN+'\t') ],
 ['oversized config','x'.repeat(65537)],
 ['oversized URL',row('remote.origin.url','x'.repeat(4097))],
 ['bad NUL separated record',row('remote.origin.url',ORIGIN)+'\0'],
 ['nonstring config',{}]
]){
 test('malformed Git config: '+name,()=>denied(
  admit(sample({configText:bad})),'CONFIG_RECORDS_UNVERIFIED'));
}
test('too many Git config entries cannot exhaust memory',()=>{
 const bulk=Array.from({length:257},(_,i)=>row('user.name'+i,'valid')).join('');
 denied(admit(sample({configText:bulk})),'CONFIG_RECORDS_UNVERIFIED');
});
test('nonplain environment with prototype getter is rejected',()=>{
 const env=Object.create({GIT_CONFIG_GLOBAL:'/tmp/evil'});
 denied(admit(sample({env})),'ENVIRONMENT_SHAPE_INVALID');
});
test('environment with accessor property is rejected',()=>{
 const env={};Object.defineProperty(env,'FETCH_TOKEN',{get(){return 'secret'},enumerable:true});
 denied(admit(sample({env})),'ENVIRONMENT_SHAPE_INVALID');
});
test('nonstring environment value is rejected',()=>denied(
 admit(sample({env:{GIT_TRACE:{toString:()=>''}}})),'ENVIRONMENT_SHAPE_INVALID'));
test('too many environment keys cannot exhaust preflight',()=>{
 const env=Object.fromEntries(Array.from({length:4097},(_,i)=>['HARMLESS_'+i,'v']));
 denied(admit(sample({env})),'ENVIRONMENT_UNBOUNDED');
});
test('NUL config parser returns the exact key/value records for benign config',()=>{
 const r=parseGitNullConfig(config([['user.email','ci@example.com']]));
 assert.equal(r.length,2);assert.equal(r[0].key,'remote.origin.url');
 assert.equal(r[1].value,'ci@example.com');
});
test('no caller provided flag can make boundary result authorize a merge',()=>{
 const v=admit({...sample(),merge_authorized:true,guest_certified:true,preflight_ok:true});
 safe(v);assert.equal(v.merge_authorized,false);assert.equal(v.guest_certified,false);
});
test('special host environment wrapper requires plain snapshot before admission',()=>{
 const special=Object.create({inherited:'untrusted'});
 Object.defineProperty(special,'GIT_TERMINAL_PROMPT',{value:'0',enumerable:true});
 denied(admit(sample({env:special})),'ENVIRONMENT_SHAPE_INVALID');
 const flat=Object.fromEntries(Object.entries(special));
 safe(admit(sample({env:flat})));
});
const workflow=()=>readFileSync('.github/workflows/merge-wave-real-five-gates-v1.yml','utf8');
test('Git boundary invoked before token injection and after cleanup',()=>{
 const y=workflow();
 const pre=y.indexOf('node tools/merge-wave-git-boundary-v1.mjs preflight');
 const fetch=y.indexOf('FETCH_TOKEN:');
 const post=y.indexOf('node tools/merge-wave-git-boundary-v1.mjs postflight');
 const tests=y.indexOf('node --test ');
 assert(pre>0&&fetch>pre&&post>fetch&&tests>post);
});
test('workflow retains nonpersisted checkout and ephemeral fetch authorization',()=>{
 const y=workflow();assert(y.includes('persist-credentials: false'));
 assert(y.includes('GIT_CONFIG_COUNT=1'));assert(y.includes('unset fetch_auth'));
 assert(!y.includes('persist-credentials: true'));
});
test('workflow uses original PR head and does not grant write privileges',()=>{
 const y=workflow();
 assert(y.includes('github.event.pull_request.head.sha'));
 assert(y.includes('contents: read'));
 assert(!y.includes('pull_request_target:'));
 assert(!y.includes('id-token: write'));
});
test('every authenticated immutable fetch is guarded immediately before and after',()=>{
 const y=workflow();
 const fetch=y.slice(y.indexOf('      - name: Fetch immutable'),y.indexOf('      - name: Execute pinned'));
 assert(/do\n(?:\s+#[^\n]*\n)*\s+node tools\/merge-wave-git-boundary-v1\.mjs preflight\n\s+GIT_CONFIG_COUNT=1/.test(fetch));
 assert(/git -c protocol\.version=2 fetch --no-tags --depth=1 origin "\$pin"\n\s+node tools\/merge-wave-git-boundary-v1\.mjs postflight/.test(fetch));
});
test('native Node asserts exact total number of test callbacks',()=>{
 const y=workflow();
 assert(y.includes('tests/merge-wave-git-boundary-v1.test.mjs'));
 assert(y.includes("grep -Eq '^# tests 268$'"));
 assert(y.includes("grep -Eq '^# pass 268$'"));
 assert(y.includes("grep -Eq '^# fail 0$'"));
});
