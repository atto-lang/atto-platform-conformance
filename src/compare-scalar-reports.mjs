const HEX64=/^[0-9a-f]{64}$/;

function validate(report,backend){
 if(!report||typeof report!=='object'||Array.isArray(report))throw Error(backend+' report must be an object');
 if(report.contract!=='scalar-int64-v1')throw Error(backend+' report contract mismatch');
 if(report.backend&&report.backend!==backend)throw Error(backend+' report backend mismatch');
 if(report.status!=='VERIFIED'||report.ok!==true)throw Error(backend+' report is not verified');
 if(report.total!==32||report.passed!==32)throw Error(backend+' report does not cover all 32 cases');
 if(!HEX64.test(report.matrixSha256||''))throw Error(backend+' report matrix digest missing');
 if(!Array.isArray(report.results)||report.results.length!==32)throw Error(backend+' report results incomplete');
 const ids=new Set();
 for(const r of report.results){
   if(!r||typeof r.id!=='string'||ids.has(r.id)||r.ok!==true)throw Error(backend+' report has invalid case result');
   ids.add(r.id);
 }
 return report;
}

export function compareScalarReports(javaReport,jsReport){
 const j=validate(javaReport,'java');
 const s=validate(jsReport,'js');
 if(j.matrixSha256!==s.matrixSha256)throw Error('Java/JS matrix SHA-256 mismatch');
 if(j.javaReferenceSha&&j.javaReferenceSha!==s.javaReferenceSha)throw Error('Java reference SHA mismatch');
 const jids=j.results.map(x=>x.id).sort(),sids=s.results.map(x=>x.id).sort();
 if(jids.some((id,i)=>id!==sids[i]))throw Error('Java/JS case inventory mismatch');
 return Object.freeze({
   contract:'scalar-int64-v1',
   status:'PARITY_VERIFIED',
   matrixSha256:j.matrixSha256,
   javaReferenceSha:j.declaredSourceSha||j.javaReferenceSha||null,
   javaArtifactSha256:j.artifactSha256,
   jsCompilerScriptSha256:s.compilerScriptSha256,
   cases:32,
   provenanceNote:'This comparison proves agreement only for the supplied verified reports; artifact-to-source provenance still requires independent attestation.'
 });
}
