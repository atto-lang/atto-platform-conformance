import test from 'node:test';
import assert from 'node:assert/strict';
import {compareScalarReports} from '../src/compare-scalar-reports.mjs';

const digest='a'.repeat(64),javaSha='b'.repeat(40);
const ids=Array.from({length:32},(_,i)=>'case-'+i);
const results=ids.map(id=>({id,ok:true}));
const javaReport={
 contract:'scalar-int64-v1',backend:'java',status:'VERIFIED',ok:true,total:32,passed:32,
 matrixSha256:digest,declaredSourceSha:javaSha,artifactSha256:'c'.repeat(64),results
};
const jsReport={
 contract:'scalar-int64-v1',backend:'js',status:'VERIFIED',ok:true,total:32,passed:32,
 matrixSha256:digest,javaReferenceSha:javaSha,compilerScriptSha256:'d'.repeat(64),results
};

test('complete matching Java/JS reports promote to narrow parity evidence',()=>{
 const out=compareScalarReports(javaReport,jsReport);
 assert.equal(out.status,'PARITY_VERIFIED');
 assert.equal(out.cases,32);
 assert.equal(out.matrixSha256,digest);
});

test('mismatch, partial or failed reports never promote',()=>{
 assert.throws(()=>compareScalarReports({...javaReport,matrixSha256:'e'.repeat(64)},jsReport),/matrix SHA-256 mismatch/);
 assert.throws(()=>compareScalarReports({...javaReport,passed:31},jsReport),/all 32/);
 assert.throws(()=>compareScalarReports(javaReport,{...jsReport,status:'MISMATCH',ok:false}),/not verified/);
 assert.throws(()=>compareScalarReports(javaReport,{...jsReport,results:jsReport.results.slice(0,31)}),/results incomplete/);
});
