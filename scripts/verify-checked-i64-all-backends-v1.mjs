#!/usr/bin/env node
// Read-only, source-only gate. This never executes or certifies any guest compiler.
import {createHash} from "node:crypto";
import {lstatSync, readFileSync, realpathSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = "contracts/checked-i64-all-backends-v1/";
const SPEC = "https://github.com/atto-lang/atto-spec/pull/144";
const CORPUS_BLOB = "71309fac2ab6b2191a0056c84d78987bd342dce0";
const CORPUS_SHA256 = "e56dfccea11757ff18fc72a81ba5d643380e69184ab309eedf45e1e7b940e133";
const BACKENDS = [
  ["atto","5b9a274490a4567ed9d1088fd1ff304dbe383357","bootstrap"],
  ["cranelift","e867c0a5cf8b94f98ce9b1212d2c735b76bc4120","independent_compiler"],
  ["forge","bca67ceb4ae933ef2e0576926809365518196f40","independent_compiler"],
  ["hdl","023455e496bb9cfbdd157ccc94bb69f31eec44ea","experimental_target"],
  ["java","9caccb4ac57dbbe9cfd13cb490a005e273d217e5","independent_compiler"],
  ["js","ec5201e11f44822e839a625152b2c6d0b979b884","independent_compiler"],
  ["llvm","21eedb54506a43fd2402699616043185b573f452","independent_compiler"],
  ["net","9e1dc9503b01a8908fc95625eecc846fc5a69780","independent_compiler"],
  ["realtime","4f6449470ab075cdad17884c7a1aee2a6e2ab54c","planned_target"],
  ["rs","2a93b5f9358a0ee5642a52c23f6621d0fa9e070d","independent_compiler"],
  ["wasm","7e3f292afdc2e191f631046a56b21a23282c5a55","delegated_compiler_harness"]
];
const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;

function requireThat(condition, reason) {
  if (!condition) throw Error(reason);
}
function exactKeys(obj, keys, name) {
  requireThat(obj && typeof obj === "object" && !Array.isArray(obj) &&
    Object.keys(obj).join("|") === keys.join("|"), name + " must have exact keys");
}
function safeFile(root, path) {
  requireThat(typeof path === "string" && !isAbsolute(path) &&
      path.split("/").every(s => s !== "" && s !== "." && s !== ".."),
    "noncanonical or escaping file path");
  let at = root;
  for (const part of path.split("/")) {
    at = join(at, part);
    const st = lstatSync(at);
    requireThat(!st.isSymbolicLink(), "symlinked conformance file is forbidden");
  }
  requireThat(lstatSync(at).isFile(), "conformance path must be regular file");
  requireThat(relative(root, at) !== ".." &&
    !relative(root, at).startsWith(".." + sep), "escaped conformance root");
  return at;
}
function gitBlob(bytes) {
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
class GuestArithmeticFault extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}
function checked(x) {
  if (x < MIN || x > MAX) throw new GuestArithmeticFault("overflow");
  return x;
}
function evaluate(expression) {
  let i = 0;
  function spaces() { while (expression[i] === " ") i++; }
  function value() {
    spaces();
    const number = /^-?(?:0|[1-9][0-9]*)/.exec(expression.slice(i));
    if (number) { i += number[0].length; return checked(BigInt(number[0])); }
    const name = /^[a-z]+/.exec(expression.slice(i));
    requireThat(name, "bad checked-i64 expression");
    i += name[0].length;
    spaces();
    requireThat(expression[i++] === "(", "missing call opening");
    const args = [];
    spaces();
    if (expression[i] !== ")") {
      while (true) {
        args.push(value());
        spaces();
        if (expression[i] !== ",") break;
        i++;
      }
    }
    requireThat(expression[i++] === ")", "bad checked-i64 call closing");
    const op = name[0], two = ["sum","subtract","multiply","remainder"].includes(op);
    requireThat(args.length === (two ? 2 : 1) && (two || op === "opposite"),
      "unrecognized checked-i64 function or arity");
    switch (op) {
      case "sum": return checked(args[0] + args[1]);
      case "subtract": return checked(args[0] - args[1]);
      case "multiply": return checked(args[0] * args[1]);
      case "opposite": return checked(-args[0]);
      case "remainder":
        if (args[1] === 0n) throw new GuestArithmeticFault("zero");
        return checked(args[0] % args[1]);
      default: throw Error("unknown i64 operation");
    }
  }
  const result = value();
  spaces();
  requireThat(i === expression.length, "trailing checked-i64 expression input");
  return result;
}

export function verifyCheckedI64AllBackends(directory = defaultRoot) {
  const root = resolve(directory);
  requireThat(realpathSync(root) === root, "conformance root must be physical");
  const raw = readFileSync(safeFile(root, folder + "manifest.json"), "utf8");
  const manifest = JSON.parse(raw);
  requireThat(raw === JSON.stringify(manifest, null, 2) + "\n",
    "noncanonical or duplicate-key manifest");
  exactKeys(manifest, ["schema","status","specification","corpus",
    "backend_snapshots","requirements","source_only_not_guest_execution"], "manifest");
  requireThat(manifest.schema === "atto.checked-i64.all-source-backends.v1" &&
    manifest.status === "CANDIDATE_SOURCE_ONLY" &&
    manifest.specification === SPEC, "wrong schema/specification or status");
  exactKeys(manifest.corpus, ["path","git_blob_sha1","sha256","count","expected"], "corpus");
  exactKeys(manifest.corpus.expected, ["value","overflow","zero"], "corpus counts");
  requireThat(manifest.corpus.path === folder + "cases.tsv" &&
    manifest.corpus.git_blob_sha1 === CORPUS_BLOB &&
    manifest.corpus.sha256 === CORPUS_SHA256 &&
    manifest.corpus.count === 15 &&
    manifest.corpus.expected.value === 7 &&
    manifest.corpus.expected.overflow === 7 &&
    manifest.corpus.expected.zero === 1, "canonical source corpus identity changed");
  const corpus = readFileSync(safeFile(root, manifest.corpus.path));
  requireThat(gitBlob(corpus) === CORPUS_BLOB &&
    createHash("sha256").update(corpus).digest("hex") === CORPUS_SHA256,
    "canonical checked-i64 corpus bytes changed");
  const text = corpus.toString("utf8");
  requireThat(!text.includes("\r") && text.endsWith("\n"), "noncanonical source corpus lines");
  const lines = text.split("\n");
  requireThat(lines.length === 16 && lines[15] === "", "expected exactly 15 case lines");
  const counts = {value:0, overflow:0, zero:0}, seen = new Set();
  for (let line of lines.slice(0,-1)) {
    const fields = line.split("|");
    requireThat(fields.length === 4, "bad case column count");
    const [id,kind,expr,expected] = fields;
    requireThat(/^[a-z]+(?:-[a-z]+)*$/.test(id) && !seen.has(id), "invalid or duplicate case ID");
    seen.add(id);
    requireThat(/^[A-Za-z0-9(),+\- ]{1,160}$/.test(expr), "invalid case expression alphabet");
    requireThat(Object.hasOwn(counts,kind), "unknown case kind");
    counts[kind]++;
    let actual, fault;
    try { actual = evaluate(expr); }
    catch (error) {
      if (!(error instanceof GuestArithmeticFault)) throw error;
      fault = error.kind;
    }
    if (kind === "value") {
      requireThat(fault === undefined &&
        /^-?(?:0|[1-9][0-9]*)$/.test(expected) &&
        actual === BigInt(expected), "inconsistent signed-i64 value case: " + id);
    } else if (kind === "overflow") {
      requireThat(fault === "overflow" && expected === "ORES_I64_OVERFLOW",
        "inconsistent overflow case: " + id);
    } else {
      requireThat(fault === "zero" && expected === "DIVISION_BY_ZERO",
        "inconsistent zero divisor case: " + id);
    }
  }
  requireThat(JSON.stringify(counts) === JSON.stringify(manifest.corpus.expected),
    "changed arithmetic case proportions");
  requireThat(Array.isArray(manifest.backend_snapshots) &&
    manifest.backend_snapshots.length === BACKENDS.length, "all eleven source repositories mandatory");
  manifest.backend_snapshots.forEach((b,i) => {
    exactKeys(b, ["id","repository","main_sha","role","execution_status","receipt"], "backend");
    const [id,sha,role] = BACKENDS[i];
    requireThat(b.id === id && b.repository === "atto-lang/atto-source." + id &&
      b.main_sha === sha && b.role === role, "reordered or substituted source backend");
    requireThat(b.execution_status === "NOT_EXECUTED" && b.receipt === null,
      "unverified backend cannot claim executable parity from a source-only manifest");
  });
  requireThat(Array.isArray(manifest.requirements) &&
    manifest.requirements.length === 7 &&
    manifest.requirements.every(x => typeof x === "string" && x.length > 8) &&
    manifest.source_only_not_guest_execution === true,
    "missing independent compiled-guest evidence rules");
  return {sourceOnly:true, backendCount:11, caseCount:15, blob:CORPUS_BLOB};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyCheckedI64AllBackends();
    console.log("ATTO_CHECKED_I64_11_BACKENDS_SOURCE_ONLY_PASS " +
      "backends=" + result.backendCount + " cases=" + result.caseCount +
      " blob=" + result.blob + " GUEST_EXECUTION=NOT_EXECUTED");
  } catch (error) {
    console.error("ATTO_CHECKED_I64_11_BACKENDS_SOURCE_ONLY_FAIL: " + error.message);
    process.exitCode = 1;
  }
}
