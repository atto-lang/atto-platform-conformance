#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {validateRegistry,validateMember} from "../src/ecosystem-contract.mjs";
const args=process.argv.slice(2);
if (args.length > 2 || (args.length === 2 && args[0] !== "--member")) {
  console.error("usage: node bin/audit-ecosystem.mjs [--member /path/to/integration.json]"); process.exit(2);
}
try {
  const registry=JSON.parse(readFileSync(new URL("../integration/repositories.json",import.meta.url),"utf8"));
  const count=validateRegistry(registry);
  if(args.length) console.log("member:",validateMember(registry,JSON.parse(readFileSync(resolve(args[1]),"utf8"))));
  console.log("metadata audit only; no compilation, execution or parity proof:",JSON.stringify(count));
} catch(error) { console.error(String(error));process.exitCode=1; }
