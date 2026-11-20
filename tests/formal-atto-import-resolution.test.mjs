// Bounded policy model; this does not execute an AttoLang compiler.
import test from "node:test";
import assert from "node:assert/strict";

function resolve_atto_import(specifier, project_root, env) {
  let base, suffix;
  if (specifier.startsWith("+")) {
    base = project_root;
    suffix = specifier.slice(1);
  } else {
    const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}\/(.+)$/.exec(specifier);
    if (!match || !Object.hasOwn(env, match[1])) throw Error("unresolved import root");
    base = env[match[1]];
    suffix = match[2];
  }
  if (!base.startsWith("/") || base.includes("\\") || !suffix || suffix.includes("\\") ||
      suffix.startsWith("/") || suffix.split("/").some(s => !s || s === "." || s === "..")) {
    throw Error("unsafe import path");
  }
  return base.replace(/\/$/, "") + "/" + suffix;
}

test("bounded import model: + means project root while ${repo} reads the environment", () => {
  let checked = 0;
  for (const root of ["/project0", "/project1"]) {
    for (const variable of ["/deps0", "/deps1"]) {
      for (const relative of ["src/main.atto", "lib/a.atto", "nested/b.atto"]) {
        const env = {repo: variable};
        assert.equal(resolve_atto_import("+" + relative, root, env), root + "/" + relative);
        assert.equal(resolve_atto_import("${repo}/" + relative, root, env), variable + "/" + relative);
        assert.notEqual(root + "/" + relative, variable + "/" + relative);
        checked++;
      }
    }
  }
  assert.equal(checked, 12);
});

test("negative candidate policy: traversal, missing variables and $repo alias fail closed", () => {
  for (const spec of ["+../escape", "+src/../escape", "+/absolute", "+src//bad",
                       "$repo/src/a.atto", "${missing}/a.atto"]) {
    assert.throws(() => resolve_atto_import(spec, "/project", {repo: "/deps"}));
  }
  assert.throws(() => resolve_atto_import("${repo}/a.atto", "/project", {repo: "deps"}));
});
