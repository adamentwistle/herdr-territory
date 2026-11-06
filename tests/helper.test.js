// territory.py on hand-made fixtures: a transcript in tests/fixtures, and git repos made fresh for each test.
// TERRITORY_TMP picks where those repos go.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { TOOLS, repoPath, touchesFrom } from "../mods/territory/calls.js";

const helper = fileURLToPath(new URL("../mods/territory/territory.py", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/home", import.meta.url));
// `python3` is the program the mod runs. On Windows that name can be a store shortcut that only prints a message.
const PYTHON = ["python3", "python"].find((name) => spawnSync(name, ["-c", "print(1)"], { encoding: "utf8" }).stdout?.trim() === "1");
const scratch = mkdtempSync(join(process.env.TERRITORY_TMP ?? tmpdir(), "territory-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function helperRun(args, env = {}) {
  const plain = { ...process.env, HOME: fixtures, USERPROFILE: fixtures, ...env };
  delete plain.CLAUDE_CONFIG_DIR;
  if (env.CLAUDE_CONFIG_DIR) plain.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR;
  const done = spawnSync(PYTHON, ["-I", "-S", helper, ...args], { env: plain, encoding: "utf8", maxBuffer: 1 << 24 });
  assert.equal(done.status, 0, done.stderr);
  return { reply: JSON.parse(done.stdout), raw: done.stdout };
}

const git = (dir, ...args) => {
  const done = spawnSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { encoding: "utf8" });
  assert.equal(done.status, 0, done.stderr);
  return done.stdout;
};

let count = 0;
function repo(files = {}) {
  const dir = join(scratch, `repo${(count += 1)}`);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  if (Object.keys(files).length) git(dir, "add", "-A");
  return dir;
}

const files = (dir, ...more) => helperRun(["files", "--dir", dir, ...more]).reply;

test("a repo comes back with sizes, and a folder inside it maps the whole repo", () => {
  const dir = repo({ "a.txt": "12345", "src/b.ts": "1234567890", "src/deep/c.ts": "1" });
  const reply = files(join(dir, "src", "deep"));
  assert.equal(reply.state, "ok");
  assert.equal(reply.total, 3);
  assert.equal(reply.guessed, 0);
  assert.deepEqual(reply.files, [["src/b.ts", 10], ["a.txt", 5], ["src/deep/c.ts", 1]]);
  assert.deepEqual(reply.rest, []);
  assert.match(reply.name, /^repo\d+$/);
});

test("a new file shows, and an ignored one doesn't", () => {
  const dir = repo({ ".gitignore": "built/\n", "a.txt": "1" });
  mkdirSync(join(dir, "built"));
  writeFileSync(join(dir, "built", "x.js"), "1");
  writeFileSync(join(dir, "new.txt"), "1");
  assert.deepEqual(files(dir).files.map((f) => f[0]).sort(), [".gitignore", "a.txt", "new.txt"]);
});

test("a tracked file that's gone from disk counts as empty", () => {
  const dir = repo({ "a.txt": "1", "b.txt": "22" });
  rmSync(join(dir, "b.txt"));
  assert.deepEqual(files(dir).files, [["a.txt", 1], ["b.txt", 0]]);
});

test("names with spaces and other scripts come through whole", () => {
  const dir = repo({ "with space/é中.txt": "1" });
  assert.equal(files(dir).files[0][0], "with space/é中.txt");
});

test("no repo, no folder and an empty repo each say so", () => {
  const plain = join(scratch, "plain");
  mkdirSync(plain, { recursive: true });
  assert.equal(files(plain).state, "none");
  assert.equal(files(join(scratch, "nowhere")).state, "gone");
  const empty = files(repo());
  assert.equal(empty.state, "empty");
  assert.match(empty.name, /^repo\d+$/);
});

test("the stamp says nothing changed, until the index does", () => {
  const dir = repo({ "a.txt": "1" });
  const { stamp } = files(dir);
  assert.equal(files(dir, "--stamp", stamp).state, "same");
  writeFileSync(join(dir, "b.txt"), "2");
  git(dir, "add", "-A");
  assert.equal(files(dir, "--stamp", stamp).state, "ok");
});

test("a big repo is capped, and nothing goes missing from the count", () => {
  const dir = repo();
  const many = {};
  for (let i = 0; i < 2100; i += 1) many[`pkg${i % 6}/sub${i % 5}/f${i}.txt`] = "x".repeat(1 + (i % 50));
  for (const [path, text] of Object.entries(many)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git(dir, "add", "-A");
  const { reply, raw } = helperRun(["files", "--dir", dir]);
  assert.equal(reply.total, 2100);
  assert.equal(reply.files.length, 1500);
  assert.equal(reply.files[0][1], 50);
  const rest = reply.rest.reduce((sum, r) => sum + r[1], 0);
  assert.equal(rest + reply.files.length, 2100);
  assert.ok(reply.rest.every(([folder]) => folder.startsWith("pkg")));
  assert.ok(raw.length < 8 * 1024 * 1024);
});

const session = (key, ...pids) => ["--session", JSON.stringify({ key, pids })];
const calls = (args, env) => helperRun(["calls", "--since", "0", ...args], env);

test("calls come out as a tool and a path, in order", () => {
  const { reply } = calls(session("t1", 4242));
  const found = reply.sessions.t1;
  assert.equal(found.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(found.name, "Tidy the router");
  assert.deepEqual(found.events.map((e) => e.slice(1)), [
    ["Read", "/work/harbour/src/router.ts", null],
    ["Write", "src/new.ts", "/work/harbour"],
    ["Grep", "/work/harbour/src", null],
  ]);
  assert.equal(found.events[0][0], Date.UTC(2026, 5, 1, 10, 0, 1));
});

test("an edit that failed isn't a write", () => {
  const { reply } = calls(session("t1", 4242));
  assert.equal(reply.sessions.t1.events.some((e) => e[1] === "Edit"), false);
});

test("nothing from inside a call comes out", () => {
  const { raw } = calls(session("t1", 4242));
  assert.doesNotMatch(raw, /secret/i);
  assert.doesNotMatch(raw, /sed -i/);
});

test("an old-style sidechain line in a session is left out, and a Grep with no path has no place", () => {
  const { reply } = calls(session("t1", 4242));
  assert.equal(reply.sessions.t1.events.some((e) => /old-sidechain/.test(e[2])), false);
  assert.equal(reply.sessions.t1.events.length, 3);
});

test("since drops older calls", () => {
  const { reply } = helperRun(["calls", "--since", String(Date.UTC(2026, 5, 1, 10, 0, 4)), ...session("t1", 4242)]);
  assert.deepEqual(reply.sessions.t1.events.map((e) => e[1]), ["Write", "Grep"]);
});

test("subagents come with their task, and whether they've finished", () => {
  const { reply } = calls(session("t1", 4242));
  const agents = reply.sessions.t1.agents.sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepEqual(agents.map((a) => [a.id, a.task, a.finished]), [["aa1", "Check the tests", false], ["bb2", "Finished one", true]]);
  assert.deepEqual(agents[0].events.map((e) => e[1]), ["Read"]);
  assert.deepEqual(agents[1].events.map((e) => e[2]), ["/work/harbour/tests/helpers.ts"]);
});

test("any ~/.claude* folder with sessions is searched, and empty ones are skipped", () => {
  const { reply } = calls(session("t2", 5151));
  assert.equal(reply.dirs, 2);
  assert.deepEqual(reply.sessions.t2.events.map((e) => e[1]), ["NotebookEdit"]);
});

test("CLAUDE_CONFIG_DIR counts too, wherever it points", () => {
  const home = join(scratch, "bare-home");
  mkdirSync(home, { recursive: true });
  const { reply } = calls(session("t1", 4242), { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(fixtures, ".claude") });
  assert.equal(reply.dirs, 1);
  assert.ok(reply.sessions.t1);
});

test("the next pid is tried when the first has no session", () => {
  assert.ok(calls(session("t1", 99999, 4242)).reply.sessions.t1);
});

test("a process with no session, a file that isn't one and bad input are left out", () => {
  const { reply } = calls([...session("a", 99999), ...session("b", 4243), ...session("c", "4242"), "--session", "not json", "--session", "[1]"]);
  assert.deepEqual(reply.sessions, {});
});

test("a transcript that hasn't changed since --since isn't read", () => {
  const home = join(scratch, "quiet-home"), project = join(home, ".claude", "projects", "-w");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(home, ".claude", "sessions"), { recursive: true });
  const id = "33333333-3333-4333-8333-333333333333";
  writeFileSync(join(home, ".claude", "sessions", "7.json"), JSON.stringify({ sessionId: id, cwd: "/w" }));
  const log = join(project, `${id}.jsonl`);
  const line = { type: "assistant", timestamp: "2031-01-01T00:00:00.000Z", message: { content: [{ type: "tool_use", id: "x", name: "Read", input: { file_path: "/w/a" } }] } };
  writeFileSync(log, `${JSON.stringify(line)}\n`);
  utimesSync(log, new Date("2020-01-01"), new Date("2020-01-01"));
  const since = String(Date.UTC(2030, 0, 1));
  const quiet = helperRun(["calls", "--since", since, ...session("t", 7)], { HOME: home, USERPROFILE: home }).reply;
  assert.deepEqual(quiet.sessions.t.events, []);
  utimesSync(log, new Date("2031-06-01"), new Date("2031-06-01"));
  const busy = helperRun(["calls", "--since", since, ...session("t", 7)], { HOME: home, USERPROFILE: home }).reply;
  assert.equal(busy.sessions.t.events.length, 1);
});

test("what the helper prints goes straight into the map's rules", () => {
  const { reply } = calls(session("t1", 4242));
  const touches = touchesFrom("t1", reply.sessions.t1.events, "/work/harbour");
  assert.deepEqual(touches.map((t) => [t.kind, t.path]), [["read", "src/router.ts"], ["write", "src/new.ts"], ["scan", "src"]]);
  assert.equal(repoPath(reply.sessions.t1.events[1][2], "/work/harbour", reply.sessions.t1.events[1][3]), "src/new.ts");
});

test("the helper and the rules name the same tools", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(helper, "utf8"), named = /^TOOLS = \{(.+)\}$/m.exec(text)[1];
  assert.deepEqual([...named.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort(), Object.keys(TOOLS).sort());
});
