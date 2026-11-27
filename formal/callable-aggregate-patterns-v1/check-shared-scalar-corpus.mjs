// Independent same-source differential gate. Both real compilers are required.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const [javaRootArg,jsRootArg]=process.argv.slice(2);
assert(javaRootArg&&jsRootArg,'usage: node check-shared-scalar-corpus.mjs JAVA_ROOT JS_ROOT');
const javaRoot=resolve(javaRootArg),jsRoot=resolve(jsRootArg);
const manifest=JSON.parse(readFileSync(new URL('./shared-scalar-corpus.json',import.meta.url),'utf8'));
assert.equal(manifest.schema,'atto.callable-patterns.shared-scalar-corpus.v1');
assert.equal(manifest.cases.length,13);
const cp=join(javaRoot,'target/classes')+':'+readFileSync(join(javaRoot,'target/parity-classpath.txt'),'utf8').trim();
const java=['-Dpolyglot.engine.WarnInterpreterOnly=false','-cp',cp,'dev.oreslang.launcher.OresMain'];
const js=join(jsRoot,'bin/atto-jsc.mjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const exec=(cmd,args,cwd)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
  assert(!r.error&&!r.signal&&Number.isInteger(r.status),JSON.stringify({error:String(r.error),signal:r.signal,status:r.status}));
  return r;};
const clean=(r,label,javaRuntime=false)=>{
  // Match only two known JDK host-library warning blocks, not guest warnings.
  let residual=r.stderr.replace(/\r\n/g,'\n');
  if(javaRuntime){
    const known=[
      /^WARNING: A restricted method in java\.lang\.System has been called\nWARNING: java\.lang\.System::load has been called by com\.oracle\.truffle\.polyglot\.JDKSupport in an unnamed module \(file:\/[^\n]*\/truffle-api\/25\.3\.4\.1\/truffle-api-25\.3\.4\.1\.jar\)\nWARNING: Use --enable-native-access=ALL-UNNAMED to avoid a warning for callers in this module\nWARNING: Restricted methods will be blocked in a future release unless native access is enabled\n?/m,
      /^WARNING: A terminally deprecated method in sun\.misc\.Unsafe has been called\nWARNING: sun\.misc\.Unsafe::objectFieldOffset has been called by com\.oracle\.truffle\.runtime\.hotspot\.HotSpotTruffleRuntime \(file:\/[^\n]*\/truffle-runtime\/25\.3\.4\.1\/truffle-runtime-25\.3\.4\.1\.jar\)\nWARNING: Please consider reporting this to the maintainers of class com\.oracle\.truffle\.runtime\.hotspot\.HotSpotTruffleRuntime\nWARNING: sun\.misc\.Unsafe::objectFieldOffset will be removed in a future release\n?/m
    ];
    for(const warning of known){
      const match=residual.match(warning);
      if(match){console.log(JSON.stringify({hostWarning:match[0].trim(),case:label}));residual=residual.replace(warning,'');}
    }
  }
  assert.equal(residual.trim(),'',label+' unexpected stderr: '+residual);
};
const root=mkdtempSync(join(tmpdir(),'atto-shared-corpus-'));
const results=[],ids=new Set();
try{
  for(const c of manifest.cases){
    assert(/^[a-z0-9-]+$/.test(c.id)&&!ids.has(c.id));ids.add(c.id);
    assert(Number.isInteger(c.expected)&&c.expected>=3&&c.expected<=125);
    const file=join(root,c.id+'.atto'),output=join(root,c.id+'.mjs');
    writeFileSync(file,c.source,{flag:'wx'});
    const hash=sha(readFileSync(file));
    // Compile/check both frontends before allowing execution.
    const jc=exec('java',[...java,'--check',file],javaRoot);
    assert.equal(jc.status,0,c.id+' Java check: '+jc.stderr);clean(jc,c.id,true);
    const sc=exec(process.execPath,[js,'--functional-source','--check',file],jsRoot);
    assert.equal(sc.status,0,c.id+' JS check: '+sc.stderr);clean(sc,c.id);
    const emit=exec(process.execPath,[js,'--functional-source',file,'--out='+output],jsRoot);
    assert.equal(emit.status,0,c.id+' JS emit: '+emit.stderr);clean(emit,c.id);
    const jr=exec('java',[...java,file],javaRoot);clean(jr,c.id,true);
    assert.equal(jr.stdout.trim(),'');assert.equal(jr.status,c.expected,c.id+' Java result');
    const guest=await import(pathToFileURL(output).href);
    const sv=guest.main();assert.equal(typeof sv,'bigint');assert.equal(sv,BigInt(c.expected),c.id+' JS guest');
    assert.equal(sha(readFileSync(file)),hash,c.id+' source mutation');
    const result={id:c.id,sourceSha256:hash,jsArtifactSha256:sha(readFileSync(output)),
      expected:c.expected,jvmExit:jr.status,jsGuest:sv.toString()};
    results.push(result);console.log(JSON.stringify(result));
  }
  console.log(JSON.stringify({status:'SHARED_SCALAR_GUEST_PROFILE_PASS',cases:results.length,
    java:'JVM launcher',javascript:'generated ESM',fullBackendParity:false,nativeAot:false}));
}finally{rmSync(root,{recursive:true,force:true});}
