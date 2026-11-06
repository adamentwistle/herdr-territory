// The treemap: every block inside the map, sizes that follow files, small files grouped, a big repo still bounded.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TILES, buildTree, layoutMap, squarify, weightOf } from "../mods/territory/treemap.js";

const files = (n, dir = "src", size = 2000) => Array.from({ length: n }, (_, i) => [`${dir}/file${i}.ts`, size + i]);
const inside = (b, w, h) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h;

test("squarify fills its rectangle without overlaps", () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((weight) => ({ weight }));
  const spots = squarify(items, { x: 0, y: 0, w: 600, h: 400 });
  assert.equal(spots.length, items.length);
  const area = spots.reduce((sum, s) => sum + s.w * s.h, 0);
  assert.ok(Math.abs(area - 600 * 400) < 1e-6);
  for (const a of spots) {
    for (const b of spots) {
      if (a === b) continue;
      const apart = a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6;
      assert.ok(apart);
    }
  }
});

test("squarify keeps blocks near square", () => {
  const items = Array.from({ length: 12 }, () => ({ weight: 1 }));
  for (const s of squarify(items, { x: 0, y: 0, w: 900, h: 300 })) assert.ok(Math.max(s.w / s.h, s.h / s.w) < 2.5);
});

test("area follows the cube root of bytes, with a floor", () => {
  assert.equal(weightOf(8000), 20);
  assert.equal(weightOf(0), weightOf(10));
});

test("a lockfile doesn't swallow the map", () => {
  const map = layoutMap({ files: [["pnpm-lock.yaml", 900000], ...files(20)], width: 1000, height: 400 });
  const lock = map.tiles.find((t) => t.path === "pnpm-lock.yaml");
  assert.ok(lock.w * lock.h < 1000 * 400 * 0.45);
});

test("every block sits inside the map, and a small repo gets a block per file", () => {
  const list = [["README.md", 3000], ["src/a.ts", 9000], ["src/b.ts", 7000], ["src/lib/c.ts", 5000], ["src/lib/d.ts", 4000], ["docs/e.md", 4000]];
  const map = layoutMap({ files: list, width: 1000, height: 400 });
  assert.equal(map.count, 6);
  assert.equal(map.tiles.filter((t) => t.kind === "file").length, 6);
  assert.equal(map.grouped, 0);
  for (const b of [...map.tiles, ...map.folders]) assert.ok(inside(b, 1000, 400), JSON.stringify(b));
  assert.ok(map.folders.some((f) => f.path === "src"));
});

test("a folder's blocks sit inside its frame, under its name", () => {
  const map = layoutMap({ files: files(6, "src/api", 8000), width: 1000, height: 400 });
  const frame = map.folders[0];
  for (const t of map.tiles) assert.ok(t.x >= frame.x && t.y >= frame.y + 14 && t.x + t.w <= frame.x + frame.w + 1);
});

test("a folder chain reads as one folder", () => {
  const tree = buildTree([["src/main/java/acme/a.java", 100], ["src/main/java/acme/b.java", 100]]);
  assert.equal(tree.list[0].name, "src/main/java/acme");
  assert.equal(tree.list[0].path, "src/main/java/acme");
});

test("small files group into one block that says how many", () => {
  const list = [...files(10, "big", 400000), ...Array.from({ length: 200 }, (_, i) => [`big/tiny${i}.txt`, 10])];
  const map = layoutMap({ files: list, width: 500, height: 300 });
  const group = map.tiles.find((t) => t.kind === "group");
  assert.ok(group.count > 50);
  assert.match(group.label, /^\d+ small files$/);
  assert.equal(map.locate("big/tiny7.txt"), group);
  assert.equal(map.grouped, group.count);
});

test("what the helper left out shows up as a group in its folder", () => {
  const map = layoutMap({ files: files(5, "src", 50000), rest: [["src", 4000, 800000], ["vendor/deep", 9000, 90000000]], width: 900, height: 400 });
  assert.equal(map.count, 13005);
  const group = map.locate("src/never-listed.ts");
  assert.equal(group.kind, "group");
  assert.ok(group.count >= 4000);
  assert.equal(map.locate("vendor/deep/x.c").kind, "group");
});

test("a huge repo stays inside the block budget", () => {
  const list = Array.from({ length: 1500 }, (_, i) => [`pkg${i % 40}/sub${i % 7}/file${i}.ts`, 500 + (i * 37) % 9000]);
  const rest = Array.from({ length: 280 }, (_, i) => [`pkg${i % 40}/sub${i % 7}`, 100, 40000]);
  const started = process.hrtime.bigint();
  const map = layoutMap({ files: list, rest, width: 1440, height: 390 });
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 500);
  assert.ok(map.tiles.length <= MAX_TILES, String(map.tiles.length));
  assert.ok(map.folders.length <= MAX_TILES);
  assert.ok(map.grouped > 0);
  assert.equal(map.count, 1500 + 280 * 100);
  for (const b of map.tiles) assert.ok(inside(b, 1440, 390));
  for (const [path] of list) assert.ok(map.locate(path), path);
});

test("the map still works when it's narrow and short", () => {
  const map = layoutMap({ files: files(400, "src"), width: 390, height: 120 });
  assert.ok(map.tiles.length >= 1 && map.tiles.length <= MAX_TILES);
  for (const b of map.tiles) assert.ok(b.w >= 1 && b.h >= 1);
});

test("a file the list doesn't have lands on its nearest folder, or nowhere", () => {
  const map = layoutMap({ files: files(4, "src", 9000), width: 1000, height: 400 });
  assert.equal(map.locate("src/brand-new.ts").path, "src");
  assert.equal(map.locate("src/brand-new.ts").kind, undefined);
  assert.equal(map.locate("elsewhere/file.ts"), null);
});

test("a repo with nothing in it has no blocks", () => {
  const map = layoutMap({ files: [], width: 800, height: 300 });
  assert.equal(map.tiles.length, 0);
  assert.equal(map.locate("a"), null);
});

test("no room means no blocks", () => {
  assert.equal(layoutMap({ files: files(3), width: 0, height: 300 }).tiles.length, 0);
});
