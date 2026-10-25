import {test} from "node:test";
import assert from "node:assert/strict";
import {requirePrivateMirror} from "../bin/require-private-mirror.mjs";

const source = "ores-truffle-oreslang/oreslang-source.java";
const destination = "akrion-sim/akrion-sim-e2e";
const good = name => ({
  full_name: name, private: true, visibility: "private",
  archived: false, permissions: {push: true}
});
function fixture(records = {}, calls = []) {
  return async (url, options) => {
    calls.push({url, options});
    assert.match(url, /^https:\/\/api\.github\.com\/repos\//);
    assert.equal(options.redirect, "error");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer restricted-test-token");
    const name = url.slice("https://api.github.com/repos/".length);
    const result = records[name] ?? good(name);
    return {status: result?.status ?? 200, json: async () => result?.data ?? result};
  };
}
const base = {
  source, destination, approvedDestinations: [destination],
  token: "restricted-test-token"
};
const check = (overrides = {}, records = {}, calls = []) =>
  requirePrivateMirror({...base, fetchImpl: fixture(records, calls), ...overrides});

test("accepts only explicitly approved and GitHub-verified writable private destination", async () => {
  const calls = [];
  assert.deepEqual(await check({}, {}, calls), {
    status: "PRIVATE_MIRROR_APPROVED", source, destination
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.endsWith("/" + source), true);
  assert.equal(calls[1].url.endsWith("/" + destination), true);
});

test("rejects public, internal, contradictory, archived and unwritable destinations", async () => {
  for (const metadata of [
    {...good(destination), private: false, visibility: "public"},
    {...good(destination), private: true, visibility: "internal"},
    {...good(destination), private: true, visibility: "public"},
    {...good(destination), archived: true},
    {...good(destination), permissions: {push: false}},
    {...good(destination), permissions: undefined}
  ]) {
    await assert.rejects(check({}, {[destination]: metadata}), /writable verified PRIVATE/);
  }
});

test("rejects wrong or public source metadata even when destination is private", async () => {
  for (const metadata of [
    {...good(source), private: false, visibility: "public"},
    {...good(source), visibility: "internal"},
    {...good(source), archived: true}
  ]) {
    const calls = [];
    await assert.rejects(check({}, {[source]: metadata}, calls), /private source metadata/);
    assert.equal(calls.length, 1, "cannot even inspect target after source rejection");
  }
});

test("unknown, unauthorized and missing metadata fail closed", async () => {
  for (const metadata of [
    {status: 403}, {status: 404}, {status: 401},
    {status: 200, data: {private: true, visibility: "private"}},
    {status: 200, data: {full_name: destination, private: "true", visibility: "private"}},
    {status: 200, data: {full_name: "someone-else/private", private: true, visibility: "private"}}
  ]) {
    await assert.rejects(check({}, {[destination]: metadata}), /unverifiable|invalid or mismatched/);
  }
});

test("missing explicit destination approval is rejected before any network request", async () => {
  for (const approvedDestinations of [undefined, [], ["other/repo"], [destination, "../evil"], Array(40).fill(destination)]) {
    const calls = [];
    await assert.rejects(check({approvedDestinations}, {}, calls), /allowlist/);
    assert.equal(calls.length, 0);
  }
});

test("missing credentials fail closed before any network request", async () => {
  for (const token of [undefined, "", " "]) {
    const calls = [];
    await assert.rejects(check({token}, {}, calls), /authenticated GitHub/);
    assert.equal(calls.length, 0);
  }
});

test("rejects malformed repository names and URL injection before making requests", async () => {
  for (const sourceValue of [
    "../other/repo", "org/repo?private=true", "org/repo#frag",
    "org/repo/extra", "org\\repo", "", "org/..", "org/repo\nHeader: injection"
  ]) {
    const calls = [];
    await assert.rejects(check({source: sourceValue}, {}, calls), /invalid GitHub/);
    assert.equal(calls.length, 0);
  }
});

test("transport, timeout, JSON and redirect failures never become approval", async () => {
  for (const fetchImpl of [
    async () => { throw Error("network error"); },
    async () => { throw Error("redirect not allowed"); },
    async () => ({status: 200, json: async () => { throw Error("invalid JSON"); }}),
    async () => null
  ]) {
    await assert.rejects(check({fetchImpl}));
  }
});

test("no permissive fallback exists if caller fails to supply a fetch implementation", async () => {
  await assert.rejects(check({fetchImpl: null}), /visibility lookup unavailable/);
});

test("transport and JSON parse errors redact credentials even if client errors include them", async () => {
  const secret = "restricted-test-token";
  for (const fetchImpl of [
    async () => { throw Error("bad Authorization: Bearer " + secret); },
    async () => ({status: 200, json: async () => {
      throw Error("request Authorization Bearer " + secret);
    }})
  ]) {
    await assert.rejects(check({fetchImpl}), error => {
      assert.equal(error.message.includes(secret), false, "token leaked in error");
      assert.match(error.message, /visibility lookup failed|metadata could not be decoded/);
      return true;
    });
  }
});
