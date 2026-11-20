#!/usr/bin/env node
// Local diagnostic execution gate for a REAL Oreslang backend command.
// This never upgrades canonical backendEvidence to PASS: a trusted CI
// receipt must also prove the exact backend commit, runner and stepful logs.
// Usage: node tests/run-mutable-state-container-guest-v1.mjs
//          java /local/fixture.ores /path/to/compile-and-run @SOURCE@
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(readFileSync(
  new URL("../contracts/state_regions/mutable-state-container-guest-v1.json", import.meta.url),
  "utf8",
));

export function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(Buffer.from("blob " + bytes.length + "\0", "utf8"))
    .update(bytes)
    .digest("hex");
}

export function verifyPinnedGuestSource(path) {
  const bytes = readFileSync(path);
  const actual = gitBlobSha(bytes);
  if (actual !== manifest.source.gitBlob) {
    throw new Error("guest source Git blob mismatch: expected " +
      manifest.source.gitBlob + ", got " + actual);
  }
  return actual;
}

export function verifyInvocation(backend, command, args) {
  if (!Object.hasOwn(manifest.backendEvidence, backend)) {
    throw new Error("unknown Oreslang backend: " + backend);
  }
  if (!command || command === "@SOURCE@") {
    throw new Error("a compiler-backed executable or wrapper is required");
  }
  if (args.filter(arg => arg === "@SOURCE@").length !== 1) {
    throw new Error("compiler command must receive exactly one @SOURCE@ placeholder");
  }
}

export function verifyGuestResult(result) {
  if (result.error) throw result.error;
  if (result.signal || result.status !== manifest.expected.exitCode ||
      typeof result.stdout !== "string" ||
      result.stdout.trim() !== manifest.expected.stdout) {
    throw new Error("guest compile-and-run mismatch (exit=" + result.status +
      ", stdout=" + JSON.stringify(result.stdout) +
      ", stderr=" + JSON.stringify(result.stderr) + ")");
  }
}

function main(argv) {
  const [backend, source, command, ...args] = argv;
  verifyInvocation(backend, command, args);
  if (!source) throw new Error("pinned .ores source path is required");
  const pathname = resolve(source);
  const sourceBlob = verifyPinnedGuestSource(pathname);
  const result = spawnSync(command, args.map(arg =>
    arg === "@SOURCE@" ? pathname : arg), {
    encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024,
    shell: false,
  });
  verifyGuestResult(result);
  process.stdout.write(JSON.stringify({
    kind: "local-diagnostic-not-ci-parity",
    backend,
    sourceRepository: manifest.source.repository,
    sourceCommit: manifest.source.commit,
    sourceBlob,
    exitCode: result.status,
    observedStdout: result.stdout.trim(),
  }) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
  }
}
