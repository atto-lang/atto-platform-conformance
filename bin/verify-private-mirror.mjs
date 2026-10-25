#!/usr/bin/env node
// Evidence-only Git tree verifier. Never fetches or modifies private source.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function git(repo, ...args) {
  return execFileSync("git", [
    "-C", repo,
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    ...args
  ], {
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function safePath(path) {
  return typeof path === "string"
    && /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(path)
    && path.split("/").every(p => p !== "." && p !== ".." && p.toLowerCase() !== ".git");
}

function parseTreeRecords(text, kind) {
  const result = new Map();
  for (const record of text.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(record);
    if (!match) throw Error("invalid " + kind + " tree entry");
    const [, mode, type, sha, path] = match;
    if (!safePath(path) || result.has(path)) throw Error("unsafe or duplicate " + kind + " tree path");
    result.set(path, {mode, type, sha});
  }
  return result;
}

function parseIndexRecords(text) {
  const result = new Map();
  for (const record of text.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) ([0-9a-f]{40}) ([0-3])\t([\s\S]+)$/.exec(record);
    if (!match) throw Error("invalid source index entry");
    const [, mode, sha, stage, path] = match;
    if (!safePath(path) || result.has(path)) throw Error("unsafe or duplicate source index path");
    result.set(path, {mode, sha, stage});
  }
  return result;
}

function rawBlobSha(bytes) {
  const header = Buffer.from("blob " + bytes.length + "\0", "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

export function verify({ repo, subtreePath, expectedTree, blobs = [] }) {
  if (!/^[0-9a-f]{40}$/.test(expectedTree) || !safePath(subtreePath)) {
    throw Error("invalid source tree pin or subtree path");
  }
  if (!Array.isArray(blobs)) throw Error("invalid blobs");

  const actual = git(repo, "rev-parse", "HEAD:" + subtreePath);
  if (actual !== expectedTree || git(repo, "cat-file", "-t", actual) !== "tree") {
    throw Error("exact Git subtree mismatch");
  }

  // Never call `git status`, `git diff`, or any content-conversion command
  // here: repository-controlled clean/textconv filters can execute arbitrary
  // commands. Establish cleanliness from immutable HEAD/index metadata plus
  // direct raw-byte hashing instead.
  const untracked = git(repo, "ls-files", "--others", "--exclude-standard", "-z", "--", subtreePath);
  const ignored = git(repo, "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", subtreePath);
  if (untracked || ignored) {
    throw Error("source subtree worktree is dirty or contains untracked files");
  }

  const flags = git(repo, "ls-files", "-v", "--", subtreePath);
  if (flags.split("\n").filter(Boolean).some(line => /^[a-zS] /.test(line))) {
    throw Error("source subtree has hidden index entries");
  }

  const head = parseTreeRecords(
    git(repo, "ls-tree", "-r", "-z", "HEAD", "--", subtreePath),
    "HEAD"
  );
  const index = parseIndexRecords(
    git(repo, "ls-files", "--stage", "-z", "--", subtreePath)
  );

  if (head.size !== index.size) {
    throw Error("source subtree worktree is dirty or index differs from pinned HEAD tree");
  }

  for (const [path, pinned] of head) {
    const staged = index.get(path);
    if (!staged ||
        pinned.type !== "blob" ||
        !["100644", "100755"].includes(pinned.mode) ||
        staged.stage !== "0" ||
        staged.mode !== pinned.mode ||
        staged.sha !== pinned.sha) {
      throw Error("source subtree worktree is dirty or contains symlink, gitlink or unexpected index entry");
    }

    if (!path.startsWith(subtreePath + "/")) {
      throw Error("tracked file lies outside the verified subtree");
    }

    const absolute = resolve(repo, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw Error("source subtree contains symlink, gitlink or unexpected index entry");
    }
    const executable = (stat.mode & 0o111) !== 0;
    if (executable !== (pinned.mode === "100755")) {
      throw Error("source subtree worktree is dirty: executable mode differs from pinned Git tree");
    }

    const raw = readFileSync(absolute);
    if (rawBlobSha(raw) !== pinned.sha) {
      throw Error("source subtree worktree is dirty: raw source bytes differ from pinned Git blob at " + path);
    }
  }

  for (const entry of blobs) {
    if (!entry || !safePath(entry.path) || !/^[0-9a-f]{40}$/.test(entry.sha)) {
      throw Error("invalid blob pin");
    }
    const oid = git(repo, "rev-parse", "HEAD:" + subtreePath + "/" + entry.path);
    if (oid !== entry.sha || git(repo, "cat-file", "-t", oid) !== "blob") {
      throw Error("exact Git blob mismatch at " + entry.path);
    }
  }

  return { status: "EXACT_TREE", sourceTree: actual, verifiedBlobs: blobs.length };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    if (process.argv.length !== 3) throw Error("pass one manifest JSON file");
    const input = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
    console.log(JSON.stringify(verify({ ...input, repo: resolve(input.repository) })));
  } catch (error) {
    console.error("MIRROR_UNVERIFIED: " + error.message);
    process.exitCode = 1;
  }
}
