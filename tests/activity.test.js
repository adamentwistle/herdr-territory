// Tool calls to places, heat, trails and the collision window.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTIVE_MS, COLLISION_MS, FADE_BEAT_MS, HEAT_MS, RECENT_MS, TRAIL_MS, addTouches, ago, beat, collisionLine, collisions,
  heatByFile, heatLevel, heatStep, lastTouch, trailOf, visitors,
} from "../mods/territory/activity.js";
import { TOOLS, repoPath, touchesFrom } from "../mods/territory/calls.js";

const NOW = 1_800_000_000_000;
const touch = (agent, kind, path, back = 0) => ({ at: NOW - back, agent, tool: kind === "write" ? "Edit" : "Read", kind, path });

test("a path inside the repo comes back from its top", () => {
  assert.equal(repoPath("/work/harbour/src/a.ts", "/work/harbour"), "src/a.ts");
  assert.equal(repoPath("/work/harbour", "/work/harbour"), "");
  assert.equal(repoPath("/work/harbour/", "/work/harbour/"), "");
});

test("a neighbour with the same start is outside", () => {
  assert.equal(repoPath("/work/harbour-two/a.ts", "/work/harbour"), null);
  assert.equal(repoPath("/etc/hosts", "/work/harbour"), null);
});

test("a relative path starts from the agent's folder, and dots are walked", () => {
  assert.equal(repoPath("src/a.ts", "/work/harbour", "/work/harbour"), "src/a.ts");
  assert.equal(repoPath("../b.ts", "/work/harbour", "/work/harbour/src"), "b.ts");
  assert.equal(repoPath("./c.ts", "/work/harbour", "/work/harbour/src"), "src/c.ts");
  assert.equal(repoPath("/work/harbour/src/../../other/x", "/work/harbour"), null);
  assert.equal(repoPath("a.ts", "/work/harbour"), null);
});

test("Windows paths match whatever their slashes and case", () => {
  assert.equal(repoPath("E:\\dev\\harbour\\src\\a.ts", "E:/dev/harbour"), "src/a.ts");
  assert.equal(repoPath("e:/DEV/harbour/src/a.ts", "E:/dev/harbour"), "src/a.ts");
  assert.equal(repoPath("/WORK/harbour/a.ts", "/work/harbour"), null);
});

test("bad input maps to nothing", () => {
  assert.equal(repoPath(null, "/work"), null);
  assert.equal(repoPath("/work/a", null), null);
});

test("each tool is a read, a write or a scan", () => {
  const kinds = (tool) => touchesFrom("a", [[1, tool, "/r/x.ts", null]], "/r")[0]?.kind;
  for (const tool of ["Read", "NotebookRead"]) assert.equal(kinds(tool), "read");
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) assert.equal(kinds(tool), "write");
  for (const tool of ["Grep", "Glob", "LS"]) assert.equal(kinds(tool), "scan");
  assert.equal(kinds("Bash"), undefined);
  assert.equal(kinds("WebFetch"), undefined);
  assert.equal(Object.keys(TOOLS).length, 9);
});

test("a call outside the repo says the agent left, and a scan of the top says nothing", () => {
  const list = touchesFrom("a", [[1, "Read", "/etc/hosts", null], [2, "Grep", "/r", null], [3, "Edit", "/r/x.ts", null]], "/r");
  assert.deepEqual(list.map((t) => t.path), [null, "x.ts"]);
});

test("a call counts once, however often a read overlaps", () => {
  const one = touch("a", "read", "x.ts", 1000);
  const twice = addTouches(addTouches([], [one], NOW), [{ ...one }], NOW);
  assert.equal(twice.length, 1);
});

test("touches stay in order and old ones go", () => {
  const list = addTouches([], [touch("a", "read", "y", 10), touch("a", "read", "x", 5000), touch("a", "read", "old", RECENT_MS + 1)], NOW);
  assert.deepEqual(list.map((t) => t.path), ["x", "y"]);
});

test("heat starts high, climbs with more writes and is gone after HEAT_MS", () => {
  assert.equal(heatLevel([], NOW), 0);
  assert.equal(heatLevel([NOW], NOW), 0.7);
  assert.ok(heatLevel([NOW, NOW - 1000, NOW - 2000], NOW) > 0.9);
  assert.equal(heatLevel(Array(9).fill(NOW), NOW), 1);
  assert.equal(heatLevel([NOW - HEAT_MS], NOW), 0);
  assert.equal(heatLevel([NOW - HEAT_MS - 1], NOW), 0);
});

test("heat runs down steadily", () => {
  const levels = [0, 1, 2, 3, 4].map((m) => heatLevel([NOW - m * 60000], NOW));
  for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] < levels[i - 1]);
  assert.ok(Math.abs(heatLevel([NOW - HEAT_MS / 2], NOW) - 0.35) < 1e-9);
});

test("heat comes in steps, and only a nothing is nothing", () => {
  assert.equal(heatStep(0), 0);
  assert.equal(heatStep(0.001), 0.1);
  assert.equal(heatStep(0.7), 0.7);
  assert.equal(heatStep(1), 1);
});

test("heat belongs to the last writer, and reads don't warm a file", () => {
  const heat = heatByFile([touch("a", "write", "x", 3000), touch("b", "write", "x", 1000), touch("c", "read", "y", 1000)], NOW);
  assert.equal(heat.get("x").agent, "b");
  assert.equal(heat.has("y"), false);
});

test("fades run on the beat", () => {
  assert.equal(beat(FADE_BEAT_MS * 7 + 1234), FADE_BEAT_MS * 7);
});

test("two agents on a file with a write between them collide", () => {
  const [hit] = collisions([touch("a", "write", "x", 30000), touch("b", "read", "x", 10000)], NOW);
  assert.equal(hit.path, "x");
  assert.deepEqual(hit.agents.map((a) => [a.agent, a.kind]), [["a", "write"], ["b", "read"]]);
});

test("two readers don't collide", () => {
  assert.deepEqual(collisions([touch("a", "read", "x"), touch("b", "read", "x")], NOW), []);
});

test("one agent alone doesn't collide with itself", () => {
  assert.deepEqual(collisions([touch("a", "write", "x"), touch("a", "read", "x", 5)], NOW), []);
});

test("different files don't collide", () => {
  assert.deepEqual(collisions([touch("a", "write", "x"), touch("b", "write", "y")], NOW), []);
});

test("the window is exact: inside it counts, on its edge it doesn't", () => {
  const inside = [touch("a", "write", "x", COLLISION_MS - 1), touch("b", "read", "x", COLLISION_MS - 1)];
  const edge = [touch("a", "write", "x", COLLISION_MS), touch("b", "read", "x", 0)];
  assert.equal(collisions(inside, NOW).length, 1);
  assert.deepEqual(collisions(edge, NOW), []);
});

test("a collision ends by itself when the write leaves the window", () => {
  const list = [touch("a", "write", "x", 0), touch("b", "read", "x", 0)];
  assert.equal(collisions(list, NOW + COLLISION_MS - 1).length, 1);
  assert.equal(collisions(list, NOW + COLLISION_MS).length, 0);
});

test("a scan isn't holding a file", () => {
  assert.deepEqual(collisions([touch("a", "write", "x"), { at: NOW, agent: "b", tool: "Grep", kind: "scan", path: "x" }], NOW), []);
});

test("an agent's own subagent doesn't collide with it, but a sibling and an outsider do", () => {
  const ownerOf = (key) => ({ s1: "a", s2: "a" })[key] ?? null;
  assert.deepEqual(collisions([touch("a", "read", "x"), touch("s1", "write", "x")], NOW, ownerOf), []);
  assert.equal(collisions([touch("s1", "read", "x"), touch("s2", "write", "x")], NOW, ownerOf).length, 1);
  const [hit] = collisions([touch("a", "read", "x"), touch("s1", "write", "x"), touch("b", "read", "x")], NOW, ownerOf);
  assert.deepEqual(hit.agents.map((e) => e.agent).sort(), ["a", "b", "s1"].filter((k) => k !== "a").concat("a").sort().filter((k) => k !== "a"));
});

test("the newest collision comes first, and the line names the file and both agents", () => {
  const list = collisions([touch("a", "write", "old", 60000), touch("b", "read", "old", 60000), touch("a", "write", "new", 1000), touch("c", "write", "new", 2000)], NOW);
  assert.deepEqual(list.map((c) => c.path), ["new", "old"]);
  const names = { a: "Wren", b: "Otter", c: "Finch" };
  assert.equal(collisionLine(list, (k) => names[k]), "new: Wren writing and Finch writing (+1 more)");
  assert.equal(collisionLine(list.slice(1), (k) => names[k]), "old: Wren writing and Otter reading");
  assert.equal(collisionLine([], (k) => k), null);
});

test("an agent stands at its last touch until it has been quiet too long", () => {
  const list = [touch("a", "read", "x", 5000), touch("a", "write", "y", 1000), touch("b", "read", "z", ACTIVE_MS)];
  assert.equal(lastTouch(list, "a", NOW).path, "y");
  assert.equal(lastTouch(list, "b", NOW), null);
  assert.equal(lastTouch(list, "c", NOW), null);
});

test("a trail is reads, in order, without repeats, and leaves after TRAIL_MS", () => {
  const list = [touch("a", "read", "old", TRAIL_MS), touch("a", "read", "x", 3000), touch("a", "read", "x", 2500), touch("a", "write", "w", 2000), touch("a", "read", "y", 1000), touch("b", "read", "z", 1000)];
  assert.deepEqual(trailOf(list, "a", NOW).map((s) => s.path), ["x", "y"]);
});

test("a block's visitors say what they did last", () => {
  const rows = visitors([touch("a", "read", "x", 9000), touch("a", "write", "x", 4000), touch("b", "read", "x", 1000), touch("c", "read", "y", 1000)], (p) => p === "x", NOW);
  assert.deepEqual(rows.map((r) => [r.agent, r.kind, r.reads, r.writes]), [["b", "read", 1, 0], ["a", "write", 1, 1]]);
});

test("ages are rough on purpose, so they don't redraw every second", () => {
  assert.equal(ago(40000), "just now");
  assert.equal(ago(130000), "2 min ago");
});
