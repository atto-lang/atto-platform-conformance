#!/usr/bin/env node
// Post-merge attestation is read-only and never authorizes or performs a merge.
import {readFile} from 'node:fs/promises';
import {makeGitHubReadOnlyClient} from '../src/merge-wave-provider-v1.mjs';
import {collectPostMergeWave} from '../src/merge-wave-postmerge-v1.mjs';

async function main(){
  if(process.argv.length!==3)
    throw Error('Usage: node bin/merge-wave-postmerge.mjs path/to/pinned-postmerge.json');
  const token=process.env.GITHUB_TOKEN||process.env.GH_TOKEN;
  const client=makeGitHubReadOnlyClient({token});
  const manifest=JSON.parse(await readFile(process.argv[2],'utf8'));
  const result=await collectPostMergeWave(manifest,client);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.waveVerified)process.exitCode=1;
}
main().catch(()=>{
  // Do not print provider responses, tokens, URLs containing credentials or private file paths.
  console.error('post-merge verification refused: invalid input or inaccessible evidence');
  process.exitCode=2;
});
