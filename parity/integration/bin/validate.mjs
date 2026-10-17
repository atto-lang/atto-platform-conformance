#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateInventory} from '../src/inventory.mjs';
try {
 if(process.argv.length!==2)throw Error('No promotion flags permitted');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const inventory=JSON.parse(await readFile(resolve(root,'inventory.json'),'utf8'));
 const output=validateInventory(inventory);
 console.log(JSON.stringify(output,null,2));
}catch(e){console.error(e.stack||e.message);process.exitCode=2}
