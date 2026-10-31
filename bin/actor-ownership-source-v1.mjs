#!/usr/bin/env node
// This runner only checks compiler acceptance/rejection. It never executes
// generated guest binaries and never certifies actor/runtime equivalence.
import { runSourceAdmission } from "../src/actor-ownership-source-gate-v1.mjs";

try {
  const args = {};
  for (const token of process.argv.slice(2)) {
    const match = /^--(backend|argv|source-sha)=(.+)$/.exec(token);
    if (!match || Object.hasOwn(args, match[1])) throw Error("invalid or duplicate option");
    args[match[1]] = match[2];
  }
  if (!args.backend) throw Error("--backend=java|llvm required");
  const argv = args.argv ? JSON.parse(args.argv) : undefined;
  const result = await runSourceAdmission({
    backend: args.backend, argv, sourceSha: args["source-sha"]
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exitCode = 2;
}
