// Who goes on the map, where a dot lands, what the demo does.

import assert from "node:assert/strict";
import { test } from "node:test";
import { addTouches, COLLISION_MS } from "../mods/territory/activity.js";
import { touchesFrom } from "../mods/territory/calls.js";
import { MAX_DOTS, SUB_QUIET_MS, assignSlots, crewOf, placeOf, withStatus, withTranscripts } from "../mods/territory/crew.js";
import { DEMO_ROOT, demoRepo, demoWorld } from "../mods/territory/demo.js";
import { HEADER_H, DOCK_H, buildFrame, hasMap, placeDots, sizeText, zoneOf } from "../mods/territory/frame.js";
import { helperReply, isShown, timed } from "../mods/territory/poll.js";
import { layoutMap } from "../mods/territory/treemap.js";

const NOW = 1_800_000_000_000;
const space = (id, extra = {}) => ({ id, active: false, machine: null, folder: "", tabs: [{ id: `${id}-tab` }], ...extra });
const live = (address, extra = {}) => ({ address, state: "live", agent: "claude-code", cwd: "/work/harbour", ...extra });
const agent = (address, extra = {}) => ({ address, pane: `p-${address}`, space: "s1", status: "working", tab_name: "1", title: "", ...extra });

test("the map follows the focused pane's folder", () => {
  const place = placeOf({ focused: { space: "s1", cwd: "/work/a" }, spaces: [space("s1")], panes: [], home: "/home" });
  assert.equal(place.folder, "/work/a");
});

test("a mod pane in focus falls back to the space's first terminal, then its folder, then home", () => {
  const panes = [{ tab: "s1-tab", cwd: "/work/b", focused: false }];
  assert.equal(placeOf({ focused: { space: "s1", cwd: null }, spaces: [space("s1")], panes, home: "/h" }).folder, "/work/b");
  assert.equal(placeOf({ focused: { space: "s1", cwd: null }, spaces: [space("s1", { folder: "/work/c" })], panes: [], home: "/h" }).folder, "/work/c");
  assert.equal(placeOf({ focused: { space: "s1", cwd: null }, spaces: [space("s1")], panes: [], home: "/h" }).folder, "/h");
});

test("a space on another machine isn't read, and no space is said plainly", () => {
  assert.equal(placeOf({ focused: { space: "s1" }, spaces: [space("s1", { machine: "vps" })], panes: [], home: "/h" }).state, "remote");
  assert.equal(placeOf({ focused: null, spaces: [], panes: [], home: "/h" }).state, "nofocus");
});

test("the crew is this space's agents, this repo's agents elsewhere, and what they started", () => {
  const list = [
    live("t1"), live("t2", { cwd: "/somewhere" }), live("t3", { cwd: "/work/harbour/src" }), live("t4", { parent: "t1", name: "review", cwd: "/tmp" }),
    live("t5", { cwd: "/unrelated" }), live("t6", { agent: "zsh" }), live("t7", { state: "finished" }), live("vps/t8"),
  ];
  const agents = [agent("t1"), agent("t2"), agent("t3", { space: "s2" }), agent("t5", { space: "s2" })];
  const crew = crewOf({ list, agents, space: "s1", root: "/work/harbour" });
  assert.deepEqual(crew.map((c) => c.key), ["t1", "t4", "t2", "t3"]);
  assert.equal(crew.find((c) => c.key === "t4").name, "review");
});

test("another program's agent is on the crew but isn't marked as readable", () => {
  const crew = crewOf({ list: [live("t1", { agent: "other" })], agents: [agent("t1", { app: "other" })], space: "s1", root: null });
  assert.equal(crew[0].app, "other");
  assert.equal(crew[0].readable, false);
});

test("a name comes from the terminal, then a named tab, then the title", () => {
  const name = (t, a) => crewOf({ list: [live("t1", t)], agents: [agent("t1", a)], space: "s1", root: null })[0].name;
  assert.equal(name({ name: "review" }, {}), "review");
  assert.equal(name({}, { tab_name: "fix login" }), "fix login");
  assert.equal(name({}, { title: "* Sorting the queue" }), "Sorting the queue");
  assert.equal(name({}, {}), "t1");
  assert.ok(name({ name: "a very long name that goes on and on and on" }, {}).length <= 22);
});

test("transcripts add subagents as agents, and a stopped one still counts for what it did", () => {
  const crew = crewOf({ list: [live("t1")], agents: [agent("t1")], space: "s1", root: "/work/harbour" });
  const sessions = { t1: { name: "Tidy up", events: [[NOW, "Read", "/work/harbour/a.ts", null]], agents: [
    { id: "aa", task: "Check tests", last: NOW - 1000, finished: false, events: [[NOW, "Edit", "/work/harbour/t.ts", null]] },
    { id: "bb", task: "Old one", last: NOW - 1000, finished: true, events: [[NOW - 5, "Edit", "/work/harbour/u.ts", null]] },
    { id: "cc", task: "Hung", last: NOW - SUB_QUIET_MS, finished: false, events: [] },
  ] } };
  const { crew: read, touches, known } = withTranscripts({ crew, sessions, root: "/work/harbour", now: NOW });
  assert.deepEqual(read.map((c) => [c.key, c.name, c.owner, c.readable]), [["t1", "Tidy up", null, true], ["sub:aa", "Check tests", "t1", true]]);
  assert.deepEqual(touches.map((t) => [t.agent, t.path]), [["t1", "a.ts"], ["sub:aa", "t.ts"], ["sub:bb", "u.ts"]]);
  assert.deepEqual(known.map((k) => k.key), ["t1", "sub:aa", "sub:bb", "sub:cc"]);
  assert.equal(known[2].owner, "t1");
});

test("no transcript means the agent stays on the crew, unread", () => {
  const crew = crewOf({ list: [live("t1")], agents: [agent("t1")], space: "s1", root: null });
  assert.equal(withTranscripts({ crew, sessions: {}, root: null, now: NOW }).crew[0].readable, false);
});

test("two agents with one name are told apart, and whoever needs you comes first", () => {
  const crew = crewOf({ list: [live("t1", { name: "fix" }), live("t2", { name: "fix" })], agents: [agent("t1"), agent("t2", { status: "blocked" })], space: "s1", root: null });
  const read = withTranscripts({ crew, sessions: {}, root: null, now: NOW }).crew;
  assert.deepEqual(read.map((c) => c.name), ["fix t2", "fix t1"]);
});

test("a status moves between reads", () => {
  const crew = [{ key: "t1", address: "t1", status: "working" }, { key: "sub:a", address: null, status: "working" }];
  assert.equal(withStatus(crew, [{ address: "t1", status: "blocked" }])[0].status, "blocked");
  assert.equal(withStatus(crew, [])[1].status, "working");
});

test("each agent keeps its colour, and a new one takes a free slot", () => {
  const slots = assignSlots(new Map(), [{ key: "a" }, { key: "b" }], 4);
  assert.deepEqual([...slots.values()], [0, 1]);
  assignSlots(slots, [{ key: "b" }, { key: "c" }], 4);
  assert.equal(slots.get("b"), 1);
  assert.equal(slots.get("c"), 0);
});

test("slots wrap when there are more agents than colours", () => {
  const slots = assignSlots(new Map(), Array.from({ length: 7 }, (_, i) => ({ key: String(i) })), 3);
  assert.ok([...slots.values()].every((s) => s >= 0 && s < 3));
});

const map = layoutMap({ files: [["src/a.ts", 90000], ["src/b.ts", 80000], ["docs/c.md", 70000], ["d.txt", 60000]], width: 1000, height: 388 });
const crewOfTwo = [{ key: "a", name: "Wren", status: "working", readable: true }, { key: "b", name: "Otter", status: "working", readable: true }];

test("a dot sits on the block of its last call", () => {
  const touches = [{ at: NOW, agent: "a", kind: "read", tool: "Read", path: "src/a.ts" }];
  const { dots } = placeDots({ map, crew: crewOfTwo.slice(0, 1), touches, now: NOW, width: 1000, zone: 388 });
  const tile = map.locate("src/a.ts");
  assert.deepEqual([dots[0].where, dots[0].x, dots[0].y], ["map", tile.x + tile.w / 2, tile.y + tile.h / 2]);
});

test("two dots on one block sit apart, with their names apart too", () => {
  const touches = ["a", "b"].map((agent) => ({ at: NOW, agent, kind: "read", tool: "Read", path: "src/a.ts" }));
  const { dots } = placeDots({ map, crew: crewOfTwo, touches, now: NOW, width: 1000, zone: 388 });
  assert.ok(Math.hypot(dots[0].x - dots[1].x, dots[0].y - dots[1].y) >= 16);
  assert.notEqual(dots[0].labelTop + dots[0].y, dots[1].labelTop + dots[1].y);
});

test("a name stays inside the map at its edges", () => {
  const edge = { tiles: [], locate: () => ({ x: 0, y: 0, w: 20, h: 20 }) };
  const touches = [{ at: NOW, agent: "a", kind: "read", tool: "Read", path: "x" }];
  const [dot] = placeDots({ map: edge, crew: crewOfTwo.slice(0, 1), touches, now: NOW, width: 500, zone: 300 }).dots;
  assert.ok(dot.x - 16 + dot.labelLeft >= 0);
});

test("agents with no place wait in the dock and say why", () => {
  const crew = [...crewOfTwo, { key: "c", name: "Lark", status: "idle", readable: false }];
  const touches = [{ at: NOW, agent: "a", kind: "read", tool: "Read", path: null }];
  const { dots } = placeDots({ map, crew, touches, now: NOW, width: 1000, zone: 388 });
  assert.deepEqual(dots.map((d) => [d.where, d.word]), [["dock", "outside the repo"], ["dock", "no file yet"], ["dock", "no transcript"]]);
  assert.ok(dots.every((d) => d.y > 388));
});

test("the dots stop at the cap and the rest are counted", () => {
  const crew = Array.from({ length: MAX_DOTS + 5 }, (_, i) => ({ key: `k${i}`, name: `n${i}`, status: "working", readable: true }));
  const touches = crew.map((c) => ({ at: NOW, agent: c.key, kind: "read", tool: "Read", path: "src/a.ts" }));
  const { dots, more } = placeDots({ map, crew, touches, now: NOW, width: 1000, zone: 388 });
  assert.equal(dots.length, MAX_DOTS);
  assert.equal(more, 5);
});

test("sizes read as people say them", () => {
  assert.equal(sizeText(900), "900 B");
  assert.equal(sizeText(2048), "2.0 KB");
  assert.equal(sizeText(3 * 1024 * 1024), "3.0 MB");
});

test("the map needs room, and the header alone doesn't draw one", () => {
  assert.equal(hasMap(44), false);
  assert.equal(hasMap(460), true);
  assert.equal(zoneOf(460), 460 - HEADER_H - DOCK_H);
});

test("the frame's signature ignores the clock until the picture changes", () => {
  const touches = [{ at: NOW, agent: "a", kind: "write", tool: "Edit", path: "src/a.ts" }];
  const frame = (at) => buildFrame({ map, crew: crewOfTwo, touches, now: at, width: 1000, height: 460 }).sig;
  const start = Math.ceil(NOW / 15000) * 15000;
  assert.equal(frame(start + 1), frame(start + 14000));
  assert.notEqual(frame(start), frame(start + 60000));
});

test("a collision reaches the frame with a line, and clears on its own", () => {
  const touches = [{ at: NOW, agent: "a", tool: "Edit", kind: "write", path: "src/a.ts" }, { at: NOW, agent: "b", tool: "Read", kind: "read", path: "src/a.ts" }];
  const nameOf = (k) => (k === "a" ? "Wren" : "Otter");
  const hit = buildFrame({ map, crew: crewOfTwo, touches, now: NOW, width: 1000, height: 460, nameOf });
  assert.equal(hit.line, "src/a.ts: Wren writing and Otter reading");
  assert.equal(hit.clash.has(map.locate("src/a.ts").key), true);
  assert.equal(hit.firstClash, map.locate("src/a.ts").key);
  assert.equal(buildFrame({ map, crew: crewOfTwo, touches, now: NOW + COLLISION_MS, width: 1000, height: 460 }).line, null);
});

test("a press on a block lists who has been there, and the card stays on the map", () => {
  const touches = [{ at: NOW - 200000, agent: "a", tool: "Edit", kind: "write", path: "src/a.ts" }, { at: NOW, agent: "b", tool: "Read", kind: "read", path: "src/a.ts" }];
  const tile = map.locate("src/a.ts"), nameOf = (k) => (k === "a" ? "Wren" : "Otter");
  const { card } = buildFrame({ map, crew: crewOfTwo, touches, now: NOW, width: 1000, height: 460, picked: tile.key, nameOf });
  assert.deepEqual(card.rows.map((r) => r.name), ["Otter", "Wren"]);
  assert.match(card.rows[1].when, /^wrote \d min ago$/);
  assert.equal(card.title, "src/a.ts");
  assert.ok(card.x >= 0 && card.x + 280 <= 1000);
});

test("hidden means hidden, however far up", () => {
  const tree = { id: "root", children: [{ id: "col", hidden: true, children: [{ id: "x" }] }, { id: "s", type: "stack", active: "b", children: [{ id: "a" }, { id: "b" }] }, { id: "y" }] };
  assert.equal(isShown(tree, "x"), false);
  assert.equal(isShown(tree, "a"), false);
  assert.equal(isShown(tree, "b"), true);
  assert.equal(isShown(tree, "y"), true);
  assert.equal(isShown(tree, "gone"), false);
  assert.equal(isShown(null, "x"), false);
});

test("a helper's reply is checked", () => {
  assert.deepEqual(helperReply({ code: 0, stdout: '{"a":1}' }, "h"), { value: { a: 1 }, error: null });
  assert.match(helperReply({ code: 2, stderr: "boom\n" }, "h").error, /code 2: boom/);
  assert.match(helperReply({ code: 0, stdout: "oops" }, "h").error, /isn't JSON/);
});

test("a read that hangs gives up", async () => {
  await assert.rejects(timed(new Promise(() => {}), 2000, "hc ls", async () => {}), /didn't answer within 2 s/);
});

const demoTouches = (step) => {
  const world = demoWorld(step);
  return { world, touches: addTouches([], Object.entries(world.events).flatMap(([key, events]) => touchesFrom(key, events, DEMO_ROOT)), world.now) };
};
const demoFrame = (step, width = 1440, height = 460) => {
  const repo = demoRepo(), { world, touches } = demoTouches(step);
  const dmap = layoutMap({ files: repo.files, width, height: zoneOf(height) }), owners = new Map(world.crew.map((c) => [c.key, c.owner]));
  return buildFrame({ map: dmap, crew: world.crew, touches, now: world.now, width, height, nameOf: (k) => world.crew.find((c) => c.key === k)?.name ?? k, ownerOf: (k) => owners.get(k) ?? null });
};

test("the demo has a repo, moving agents and a collision on the router", () => {
  assert.ok(demoRepo().total >= 50);
  const lines = Array.from({ length: 24 }, (_, i) => demoFrame(i).line);
  const hits = lines.filter(Boolean);
  assert.ok(hits.length >= 6 && hits.length <= 16, String(hits.length));
  assert.ok(hits.every((line) => line.startsWith("src/api/router.ts: ")));
  assert.ok(hits.some((line) => /Wren/.test(line) && /Otter/.test(line)));
});

test("the demo loops with no seam", () => {
  const strip = (f) => JSON.stringify(JSON.parse(f.sig).slice(0, 5));
  assert.equal(strip(demoFrame(3)), strip(demoFrame(27)));
});

test("the demo's map is warm from the first step, keeps everyone in view, and shows the dock", () => {
  const frame = demoFrame(0);
  assert.ok(frame.heat.size >= 6);
  assert.equal(frame.dots.length, 6);
  assert.equal(frame.dots.filter((d) => d.where === "dock").length, 1);
  assert.equal(frame.dots.find((d) => d.where === "dock").word, "no transcript");
});

test("every file the demo touches is on its map, and one new file shows how that looks", () => {
  const paths = new Set(demoRepo().files.map(([p]) => p));
  const { touches } = demoTouches(23);
  const missing = [...new Set(touches.map((t) => t.path))].filter((p) => p && !paths.has(p));
  assert.deepEqual(missing.filter((p) => p !== "src"), ["src/db/migrations/005_index.sql"]);
});

test("the demo fits a window 390 wide", () => {
  const frame = demoFrame(8, 390, 460);
  assert.ok(frame.line);
  for (const tile of frame.map.tiles) assert.ok(tile.x + tile.w <= 390);
  for (const dot of frame.dots) assert.ok(dot.x <= 390);
});
