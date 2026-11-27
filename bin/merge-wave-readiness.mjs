#!/usr/bin/env node
// Read-only provider fetcher. No GitHub mutation methods are used.
import {readFile} from 'node:fs/promises';
import {makeGitHubReadOnlyClient} from '../src/merge-wave-provider-v1.mjs';
import {collectProtectedWave} from '../src/merge-wave-protected-v1.mjs';

async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error('Usage: node bin/merge-wave-readiness.mjs path/to/manifest.json');
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const client = makeGitHubReadOnlyClient({token});
  const manifest = JSON.parse(await readFile(path,'utf8'));
  const result = await collectProtectedWave(manifest,client);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if (!result.readyForHumanFinalReview) process.exitCode = 1;
}
main().catch(e=>{console.error('merge-wave preflight refused: '+e.message);process.exitCode=2;});
