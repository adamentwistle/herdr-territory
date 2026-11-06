// The files themselves: no timers a mod doesn't have, a layout that fits the mod, a recipe in the gallery's order.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const mod = "mods/territory/";
const scripts = readdirSync(new URL(mod, root)).filter((f) => f.endsWith(".js"));

test("no mod file uses a timer that doesn't exist there", () => {
  for (const file of scripts) assert.doesNotMatch(read(mod + file), /\b(setTimeout|clearTimeout|setInterval|clearInterval|requestAnimationFrame)\b/, file);
});

test("the rules import nothing from the app", () => {
  for (const file of ["treemap.js", "calls.js", "activity.js", "crew.js", "frame.js", "poll.js", "demo.js"]) {
    assert.doesNotMatch(read(mod + file), /from "(herdr|gpui-kit|gpui-base)"/, file);
  }
});

test("nothing keeps a cx for later", () => {
  assert.doesNotMatch(read(`${mod}main.js`), /this\.\w+\s*=\s*cx\b/);
  assert.doesNotMatch(read(`${mod}main.js`), /=\s*\(\)\s*=>\s*cx\./);
});

test("view.js leaves `window` as the runtime's, which has paint_path", () => {
  assert.doesNotMatch(read(`${mod}view.js`), /import \{[^}]*\bwindow\b[^}]*\} from "herdr"/);
});

test("colours come from the theme", () => {
  for (const file of scripts) assert.doesNotMatch(read(mod + file), /["'`]#[0-9a-fA-F]{3,8}/, file);
});

test("the helper opens nothing for writing and reaches no network", () => {
  const text = read(`${mod}territory.py`);
  assert.doesNotMatch(text, /open\([^)]*["'][wax+]/);
  assert.doesNotMatch(text, /\b(socket|urllib|http\.client|requests)\b/);
});

test("the layout is main's window with the map on top", () => {
  const layout = JSON.parse(read("layouts/territory.json"));
  const nodes = new Map();
  const visit = (node) => { nodes.set(node.id, node); (node.children ?? []).forEach(visit); };
  visit(layout);
  assert.deepEqual(layout.cloned_from, { name: "main", version: "0.1.12" });
  assert.equal(layout.type, "column");
  const block = layout.children[0];
  assert.equal(block.id, "territory");
  assert.equal(block.content.mod, "territory");
  assert.equal(block.content.props, undefined);
  assert.equal(block.size.px, 460);
  assert.equal(block.min, 44);
  assert.match(read(`${mod}main.js`), /OPEN_PX = 460/);
  assert.match(read(`${mod}main.js`), /FOLD_PX = 44/);
  assert.match(read(`${mod}main.js`), /BLOCK = "territory"/);
  for (const id of ["sidebar", "spaces", "agents", "tabs", "main", "panel", "status"]) assert.ok(nodes.has(id), id);
  assert.equal(nodes.get("main").content.tab, "active");
  assert.ok(existsSync(new URL(layout.preview, root)));
});

test("the key reaches the mod", () => {
  const keys = JSON.parse(read("keys.json"));
  assert.equal(keys["layout:territory"]["ctrl-shift-m"], "territory.fold");
  assert.match(read(`${mod}main.js`), /=== "fold"/);
});

test("the recipe has its six parts in order", () => {
  const recipe = read("RECIPE.md");
  const heads = [...recipe.matchAll(/^#{1,2} (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ["Territory", "What you see", "How it behaves", "Built from", "Watch out", "Done when"]);
  assert.match(recipe, /!\[Territory\]\(preview\.png\)/);
});

test("the writing has no long dashes", () => {
  for (const file of ["RECIPE.md", "README.md", `${mod}territory.py`, ...scripts.map((f) => mod + f)]) assert.doesNotMatch(read(file), /[\u2014\u2013]/, file);
});
