// The mod itself, on a fake clock with no app: what it reads, when it redraws, what a press does.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { COLLISION_MS, HEAT_MS } from "../mods/territory/activity.js";
import { Run, host } from "./stubs/runner.js";
import { callOf, textOf, walk } from "./stubs/gpui.js";
import { thousands } from "../mods/territory/frame.js";

let run;
afterEach(() => { run?.stop(); run = null; });

const ROOT = "/work/harbour";
const NOW = Date.UTC(2026, 5, 1, 10, 0, 30);

function world({ agents = ["t1", "t2"] } = {}) {
  host.spaces = [{ id: "s1", active: true, machine: null, folder: ROOT, tabs: [{ id: "b1" }] }];
  host.focused = { space: "s1", tab: "b1", pane: "p1", cwd: ROOT };
  host.panes = [{ pane: "p1", tab: "b1", cwd: ROOT, focused: true }];
  host.agents = agents.map((address, i) => ({ address, pane: `p-${address}`, space: "s1", status: "working", tab_name: ["fix login", "tidy docs"][i] ?? String(i), title: "" }));
  host.list = agents.map((address) => ({ address, state: "live", agent: "claude-code", cwd: ROOT }));
  host.facts = Object.fromEntries(agents.map((address, i) => [address, { foreground: { pid: 100 + i } }]));
  host.filesReply = { state: "ok", root: ROOT, name: "harbour", stamp: "s1", total: 3, guessed: 0, files: [["src/a.ts", 9000], ["src/b.ts", 8000], ["README.md", 4000]], rest: [] };
}

const says = (...calls) => ({ sessions: Object.fromEntries(calls.map(([key, ...events]) => [key, { events, agents: [], last: NOW }])), dirs: 1 });
const call = (tool, path, at = NOW) => [at, tool, `${ROOT}/${path}`, null];

function find(id) {
  let found = null;
  walk(run.tree, (el) => { if (callOf(el, "id")?.[1] === id) found = el; });
  return found;
}

function press(id) {
  const found = find(id);
  assert.ok(found, id);
  callOf(found, "on_click")[1]({}, run.cx());
  run.render();
}

const tileOf = (path) => run.mod.frame.map.locate(path).key;
const words = () => textOf(run.tree).join(" | ");

async function started(options) {
  run = new Run(options);
  await run.settle();
  await run.advance(3000);
  return run;
}

test("before anything is read the map says so, with no crash", () => {
  run = new Run();
  assert.match(words(), /No space in focus|Reading the repo/);
});

test("it maps the focused space and puts each agent on its file", async () => {
  world();
  host.callsReply = says(["t1", call("Read", "src/a.ts")], ["t2", call("Edit", "README.md")]);
  await started();
  const dot = (key) => run.mod.frame.dots.find((d) => d.key === key);
  assert.equal(dot("t1").where, "map");
  assert.equal(dot("t1").name, "fix login");
  const tile = run.mod.frame.map.locate("src/a.ts");
  assert.equal(dot("t1").x, tile.x + tile.w / 2);
  assert.ok(find("dot-t2"));
  assert.ok(find(`heat-${tileOf("README.md")}`));
  assert.match(words(), /harbour/);
  assert.match(words(), /3 files/);
  assert.match(words(), /Sees 2 of 2 agents/);
});

test("hc and the helper are asked as the recipe says", async () => {
  world();
  await started();
  assert.deepEqual(host.hcs[0], ["ls", "--all", "--json"]);
  assert.ok(host.hcs.some((args) => args[0] === "get" && args[1] === "t1"));
  const files = host.execs.find((args) => args.includes("files"));
  assert.deepEqual(files.slice(0, 4), ["python3", "-I", "-S", "/home/test/.config/herdr-app/mods/territory/territory.py"]);
  const calls = host.execs.find((args) => args.includes("calls"));
  assert.ok(calls.includes("--since"));
  assert.ok(calls.some((a) => a === JSON.stringify({ key: "t1", pids: [100] })));
});

test("it reads every 3 seconds, and hc get only now and then", async () => {
  world();
  await started();
  const lists = () => host.hcs.filter((a) => a[0] === "ls").length, gets = () => host.hcs.filter((a) => a[0] === "get").length;
  const before = lists(), getsBefore = gets();
  await run.advance(9000);
  assert.equal(lists() - before, 3);
  assert.equal(gets(), getsBefore);
});

test("a map with nothing changing doesn't redraw", async () => {
  world();
  host.callsReply = says(["t1", call("Read", "src/a.ts")]);
  await started();
  await run.advance(1000);
  const renders = run.renders;
  await run.advance(12000); // inside one fade beat
  assert.ok(run.renders - renders <= 1, String(run.renders - renders));
});

test("a hidden block reads nothing and draws nothing, and reads at once when it's back", async () => {
  world();
  await started();
  host.layout.children[0].hidden = true;
  await run.advance(1000);
  const reads = host.execs.length + host.hcs.length, renders = run.renders;
  await run.advance(60000);
  assert.equal(host.execs.length + host.hcs.length, reads);
  assert.equal(run.renders, renders);
  host.layout.children[0].hidden = false;
  await run.advance(1000);
  assert.ok(host.hcs.length + host.execs.length > reads);
});

test("no timers but its own second", async () => {
  world();
  await started();
  assert.equal(run.timers.length, 1);
  assert.equal(run.timers[0].ms, 1000);
});

test("two agents on a file flash its block and name it, and it clears after the window", async () => {
  world();
  host.callsReply = says(["t1", call("Edit", "src/a.ts")], ["t2", call("Read", "src/a.ts")]);
  await started();
  assert.match(words(), /src\/a\.ts: fix login writing and tidy docs reading/);
  const tile = find(tileOf("src/a.ts"));
  let flashing = false;
  walk(tile, (el) => { if (callOf(el, "loop")) flashing = true; });
  assert.ok(flashing);
  host.callsReply = says();
  await run.advance(COLLISION_MS);
  assert.equal(run.mod.frame.line, null);
  assert.doesNotMatch(words(), /writing/);
});

test("heat fades away over the minutes after a write", async () => {
  world();
  host.callsReply = says(["t1", call("Write", "src/b.ts")]);
  await started();
  const key = tileOf("src/b.ts"), before = run.mod.frame.heat.get(key).level;
  host.callsReply = says();
  await run.advance(HEAT_MS / 2);
  assert.ok(run.mod.frame.heat.get(key).level < before);
  await run.advance(HEAT_MS / 2 + 20000);
  assert.equal(run.mod.frame.heat.has(key), false);
});

test("a new file list redraws the map even with nothing else moving", async () => {
  world();
  await started();
  host.filesReply = { ...host.filesReply, stamp: "s2", total: 4, files: [...host.filesReply.files, ["src/c.ts", 3000]] };
  await run.advance(30000);
  assert.match(words(), /c\.ts/);
  assert.match(words(), /4 files/);
});

test("a press on a block lists its recent agents, a press on the row goes there, a second press closes it", async () => {
  world();
  host.callsReply = says(["t1", call("Edit", "src/a.ts")]);
  await started();
  const key = tileOf("src/a.ts");
  press(key);
  assert.match(words(), /src\/a\.ts/);
  assert.match(words(), /wrote just now/);
  press("card-t1");
  assert.deepEqual(host.ran.at(-1), ["pane.focus", { pane: "p-t1" }]);
  press(key);
  assert.equal(find("card"), null);
});

test("a press on a dot focuses that agent", async () => {
  world();
  host.callsReply = says(["t1", call("Read", "src/a.ts")]);
  await started();
  press("dot-t1");
  assert.deepEqual(host.ran, [["pane.focus", { pane: "p-t1" }]]);
});

test("an agent with no pane peeks, and a subagent goes to its session", async () => {
  world();
  host.agents = [host.agents[0]];
  host.list = [host.list[0], { address: "t9", state: "live", agent: "claude-code", cwd: ROOT, parent: "t1", name: "worker" }];
  host.callsReply = { sessions: { t1: { events: [], last: NOW, agents: [{ id: "aa", task: "Check", last: NOW, finished: false, events: [call("Read", "src/a.ts")] }] } }, dirs: 1 };
  await started();
  press("dot-t9");
  assert.deepEqual(host.ran.at(-1), ["terminal.peek", { terminal: "t9" }]);
  press("dot-sub:aa");
  assert.deepEqual(host.ran.at(-1), ["pane.focus", { pane: "p-t1" }]);
});

test("the button folds to the header, keeps the warning, and comes back to the height it had", async () => {
  world();
  host.callsReply = says(["t1", call("Edit", "src/a.ts")], ["t2", call("Read", "src/a.ts")]);
  await started();
  press("fold");
  assert.deepEqual(host.ran.at(-1), ["layout.resize", { id: "territory", px: 44 }]);
  run.mod.resized({ width: 1440, height: 44 }, run.cx());
  run.render();
  assert.equal(find("map"), null);
  assert.match(words(), /src\/a\.ts: fix login writing/);
  assert.match(words(), /Map/);
  press("fold");
  assert.deepEqual(host.ran.at(-1), ["layout.resize", { id: "territory", px: 460 }]);
});

test("the map keeps reading while folded, because the warning still shows", async () => {
  world();
  await started();
  run.mod.resized({ width: 1440, height: 44 }, run.cx());
  const reads = host.hcs.length;
  await run.advance(3000);
  assert.ok(host.hcs.length > reads);
});

test("a repo the helper can't map says why, and the agents wait in the dock", async () => {
  world();
  host.filesReply = { state: "none" };
  await started();
  assert.match(words(), /No git repo here/);
  assert.ok(run.mod.frame.dots.every((d) => d.where === "dock"));
  assert.match(words(), /no transcript/);
});

test("an empty repo says so", async () => {
  world();
  host.filesReply = { state: "empty", root: ROOT, name: "harbour", stamp: "s" };
  await started();
  assert.match(words(), /Nothing in this repo yet/);
});

test("a space on another machine isn't read", async () => {
  world();
  host.spaces[0].machine = "vps";
  await started();
  assert.match(words(), /This space is on vps/);
  assert.equal(host.execs.filter((a) => a.includes("files")).length, 0);
});

test("a big repo says how many files it grouped", async () => {
  world();
  const files = Array.from({ length: 1500 }, (_, i) => [`pkg${i % 30}/f${i}.ts`, 1000 + i]);
  host.filesReply = { state: "ok", root: ROOT, name: "harbour", stamp: "s", total: 48211, guessed: 0, files, rest: [["pkg1", 46711, 90000000]] };
  await started();
  assert.match(words(), /48,211 files, [\d,]+ in groups/);
  assert.ok(run.mod.frame.map.tiles.length <= 140);
});

test("a helper that can't start says so on the map", async () => {
  world();
  await started();
  host.execFails = "no such program";
  await run.advance(3000);
  assert.match(words(), /Transcripts unreadable: python3 couldn't start territory\.py: .*no such program/);
  host.execFails = null;
  await run.advance(3000);
  assert.doesNotMatch(words(), /Transcripts unreadable/);
});

test("moving to another repo starts clean", async () => {
  world();
  host.callsReply = says(["t1", call("Edit", "src/a.ts")]);
  await started();
  assert.equal(run.mod.touches.length, 1);
  host.focused.cwd = "/work/other";
  host.filesReply = { state: "ok", root: "/work/other", name: "other", stamp: "o", total: 1, guessed: 0, files: [["x.ts", 100]], rest: [] };
  host.callsReply = says();
  await run.advance(1000);
  assert.match(words(), /other/);
  assert.equal(run.mod.touches.length, 0);
});

test("a write to a new file asks for the list again, once", async () => {
  world();
  host.callsReply = says(["t1", call("Write", "src/brand-new.ts")]);
  await started();
  assert.equal(run.mod.wantFiles, true);
  const before = host.execs.filter((a) => a.includes("files")).length;
  await run.advance(10000);
  assert.equal(host.execs.filter((a) => a.includes("files")).length, before + 1);
  assert.equal(run.mod.wantFiles, false);
  await run.advance(9000);
  assert.equal(host.execs.filter((a) => a.includes("files")).length, before + 1);
});

test("sizes are the app's own at any zoom", async () => {
  world();
  host.zoom = 1.25;
  await started({ width: 1800, height: 575 });
  assert.equal(run.mod.area().width, 1440);
  assert.equal(run.mod.area().height, 460);
});

test("demo mode needs no repo and no agents, and a dot press does nothing", async () => {
  host.props = { demo: true };
  run = new Run();
  assert.deepEqual([host.execs.length, host.hcs.length], [0, 0]);
  assert.match(words(), /harbour/);
  assert.ok(run.mod.frame.dots.length >= 5);
  let collided = false;
  for (let i = 0; i < 24; i += 1) {
    await run.advance(1500);
    collided ||= /src\/api\/router\.ts: /.test(words());
  }
  assert.ok(collided);
  assert.deepEqual([host.execs.length, host.hcs.length], [0, 0]);
  const dot = run.mod.frame.dots.find((d) => d.where === "map");
  press(`dot-${dot.key}`);
  assert.deepEqual(host.ran, []);
  press(run.mod.frame.map.tiles[0].key);
  assert.ok(find("card"));
});

test("a hidden demo stops", async () => {
  host.props = { demo: true };
  run = new Run();
  host.layout.children[0].hidden = true;
  const renders = run.renders;
  await run.advance(15000);
  assert.equal(run.renders, renders);
});

test("counts take commas without locale data, which Herdr's script engine doesn't have", () => {
  assert.deepEqual([0, 999, 1000, 48211, 1234567].map(thousands), ["0", "999", "1,000", "48,211", "1,234,567"]);
  assert.doesNotMatch(readFileSync(new URL("../mods/territory/main.js", import.meta.url), "utf8"), /toLocaleString/);
});
