#!/usr/bin/env node
// Real guest execution ONLY. No host emulator, fake success, or self-certification.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("../verification/fixtures/five-backend-actor-channel-v1/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const SHA = /^[0-9a-f]{40}$/u;
const H256 = /^[0-9a-f]{64}$/u;
const LIM = 1048576;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const blobSha = bytes => createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0")).update(bytes).digest("hex");
function requireValid(ok, msg) { if (!ok) throw new Error(msg); }
function command(argv, cwd) {
  requireValid(Array.isArray(argv) && argv.length > 0 &&
    argv.every(s => typeof s === "string" && s.length > 0 && s.length < 8192),
    "explicit non-empty argv required");
  requireValid(isAbsolute(argv[0]), "command executable must be absolute");
  const run = spawnSync(argv[0], argv.slice(1), {
    cwd, shell: false, timeout: 120000, maxBuffer: LIM, encoding: "buffer",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/nonexistent",
      LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }
  });
  return {
    exitCode: run.status, signal: run.signal, error: run.error?.message ?? null,
    stdout: run.stdout?.toString("utf8") ?? "",
    stderr: run.stderr?.toString("utf8") ?? "",
    stdoutSha256: sha256(run.stdout ?? Buffer.alloc(0)),
    stderrSha256: sha256(run.stderr ?? Buffer.alloc(0)),
    stdoutBytes: run.stdout?.length ?? 0, stderrBytes: run.stderr?.length ?? 0
  };
}
function binaryIdentity(path, digest) {
  requireValid(typeof path === "string" && isAbsolute(path) && H256.test(digest),
    "binary path and expected SHA256 required");
  const stat = statSync(path);
  requireValid(stat.isFile() && stat.size > 0 && stat.size <= 2 * 1024 ** 3,
    "compiler or guest runner is not a bounded regular file");
  // Direct hashing: execution is not accepted if the declared compiler bytes differ.
  const actual = sha256(readFileSync(path));
  requireValid(actual === digest, "binary SHA256 mismatch: " + path);
}
function expand(argv, vars) {
  requireValid(Array.isArray(argv), "argv must be array");
  return argv.map(part => {
    requireValid(typeof part === "string" && part.length > 0, "invalid argv part");
    return part.replace(/\{(source|artifact)\}/gu, (_, name) => vars[name]);
  });
}
function pinConfig(backend, adapter) {
  requireValid(adapter && typeof adapter === "object", backend + ": missing backend adapter");
  for (const key of ["sourceRepo", "sourceCommitSha", "sourceTreeSha",
                     "compilerCommitSha", "compilerTreeSha"])
    requireValid(typeof adapter[key] === "string" && adapter[key].length > 0,
      backend + ": missing " + key);
  for (const key of ["sourceCommitSha", "sourceTreeSha", "compilerCommitSha", "compilerTreeSha"])
    requireValid(SHA.test(adapter[key]), backend + ": invalid " + key);
  binaryIdentity(adapter.compilerPath, adapter.compilerSha256);
  binaryIdentity(adapter.guestRunnerPath, adapter.guestRunnerSha256);
  requireValid(Array.isArray(adapter.compileArgv) &&
    adapter.compileArgv[0] === adapter.compilerPath,
    backend + ": compile executable must match pinned compiler");
  requireValid(Array.isArray(adapter.runArgv) &&
    adapter.runArgv[0] === adapter.guestRunnerPath,
    backend + ": guest executable must match pinned runner");
}
function exactSource(caseInfo) {
  requireValid(/^[a-z0-9-]+\.atto$/u.test(caseInfo.file), "invalid fixture filename");
  const path = join(here, caseInfo.file);
  requireValid(statSync(path).isFile() && statSync(path).size < 65536, "invalid fixture type/size");
  const bytes = readFileSync(path);
  requireValid(SHA.test(caseInfo.gitBlobSha1) && blobSha(bytes) === caseInfo.gitBlobSha1,
    "fixture Git blob identity mismatch: " + caseInfo.id);
  return { path, sha256: sha256(bytes), gitBlobSha1: caseInfo.gitBlobSha1 };
}
function runCase(backend, adapter, testCase) {
  const src = exactSource(testCase);
  const working = mkdtempSync(join(tmpdir(), "atto-e2e-"));
  try {
    const vars = { source: src.path, artifact: join(working, "program.bin") };
    const build = command(expand(adapter.compileArgv, vars), working);
    const entry = { id: testCase.id, kind: testCase.kind,
      source: src, build, guest: null, passed: false };
    if (testCase.kind === "reject") {
      const message = build.stdout + "\n" + build.stderr;
      requireValid(typeof testCase.diagnosticPattern === "string" &&
        testCase.diagnosticPattern.length > 0, "negative diagnostic missing");
      entry.passed = build.error === null && build.signal === null &&
        Number.isInteger(build.exitCode) && build.exitCode !== 0 &&
        new RegExp(testCase.diagnosticPattern, "iu").test(message);
    } else if (testCase.kind === "accept") {
      requireValid(build.error === null && build.signal === null &&
        build.exitCode === 0, backend + "/" + testCase.id + ": compiler did not pass");
      requireValid(statSync(vars.artifact).isFile(), "compiled guest artifact missing");
      const guest = command(expand(adapter.runArgv, vars), working);
      entry.guest = guest;
      entry.passed = guest.error === null && guest.signal === null &&
        guest.exitCode === 0 && guest.stdout === testCase.stdout && guest.stderr === "";
    } else {
      throw new Error("unexpected case kind");
    }
    return entry;
  } finally {
    rmSync(working, { force: true, recursive: true });
  }
}
const report = { schemaVersion: 1, sourceCheckout: null,
  certified: false, nativeVerified: false, hostOracle: false,
  backendStatus: Object.fromEntries(manifest.backends.map(b => [b, "NOT_EXECUTED"])),
  executions: [], errors: [] };
let resultPath = null;
try {
  requireValid(manifest.state === "CANDIDATE_NOT_EXECUTED" &&
    manifest.nativeGuestReceipts.length === 0 && manifest.fixtures.length === 10,
    "manifest must remain uncertified and contain ten pinned cases");
  const ids = new Set();
  const filenames = new Set();
  for (const f of manifest.fixtures) {
    requireValid(typeof f.id === "string" && /^[a-z0-9-]+$/u.test(f.id) &&
      !ids.has(f.id), "duplicate/invalid fixture id");
    requireValid(!filenames.has(f.file), "duplicate fixture file");
    requireValid(f.kind === "accept" || f.kind === "reject", "invalid fixture kind");
    if (f.kind === "reject") {
      requireValid(typeof f.diagnosticPattern === "string" &&
        f.diagnosticPattern.length > 0 && f.diagnosticPattern.length < 1024,
        "missing/broad negative diagnostic pattern");
      new RegExp(f.diagnosticPattern, "iu");
    }
    ids.add(f.id);
    filenames.add(f.file);
    exactSource(f);
  }
  requireValid(["reject-function-message", "reject-nested-callable-message",
    "reject-captured-closure-message", "reject-nominal-callable-field-message",
    "reject-nested-callable-topic"].every(id => ids.has(id)),
    "data-only transport negative coverage missing");
  const configFile = process.argv[2];
  requireValid(configFile && isAbsolute(resolve(configFile)), "adapter JSON required");
  resultPath = process.argv[3] ? resolve(process.argv[3]) : null;
  // Exact checkout head and Git tree: recorded, never copied from an arbitrary YAML claim.
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const getGit = args => {
    const r = command(["/usr/bin/git", ...args], repoRoot);
    requireValid(r.exitCode === 0, "git readback failed: " + r.stderr);
    return r.stdout.trim();
  };
  report.sourceCheckout = { commit: getGit(["rev-parse", "HEAD"]),
    tree: getGit(["rev-parse", "HEAD^{tree}"]) };
  requireValid(SHA.test(report.sourceCheckout.commit) && SHA.test(report.sourceCheckout.tree),
    "source Git identity invalid");
  const cfg = JSON.parse(readFileSync(resolve(configFile), "utf8"));
  requireValid(cfg.schemaVersion === 1 && cfg.adapters && typeof cfg.adapters === "object",
    "adapter configuration missing");
  for (const backend of manifest.backends) {
    try {
      const adapter = cfg.adapters[backend];
      pinConfig(backend, adapter);
      const cases = manifest.fixtures.map(f => runCase(backend, adapter, f));
      report.executions.push({ backend,
        sourceRepo: adapter.sourceRepo, sourceCommitSha: adapter.sourceCommitSha,
        sourceTreeSha: adapter.sourceTreeSha, compilerCommitSha: adapter.compilerCommitSha,
        compilerTreeSha: adapter.compilerTreeSha, compilerSha256: adapter.compilerSha256,
        guestRunnerSha256: adapter.guestRunnerSha256, cases });
      report.backendStatus[backend] = cases.every(c => c.passed) ? "GUEST_EXECUTED" : "FAILED";
    } catch (error) {
      report.errors.push({backend, message:String(error.message)});
      // Missing/invalid/unavailable adapters NEVER graduate to a passing lane.
      report.backendStatus[backend] = "NOT_EXECUTED";
    }
  }
} catch (error) {
  report.errors.push({backend:"admission", message:String(error.message)});
}
if (resultPath) writeFileSync(resultPath, JSON.stringify(report,null,2)+"\n", {flag:"wx"});
const allGreen = manifest.backends.every(b => report.backendStatus[b] === "GUEST_EXECUTED");
process.stdout.write(JSON.stringify({backendStatus:report.backendStatus,
  sourceCheckout:report.sourceCheckout, errors:report.errors})+"\n");
process.exitCode = allGreen && report.errors.length === 0 ? 0 : 1;
