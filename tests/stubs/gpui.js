// Stands in for gpui-kit and gpui-base: elements that remember how they were built, so a test can look at them.

class El {
  constructor(tag) {
    this.tag = tag;
    this.calls = [];
    this.kids = [];
  }
  child(c) { this.kids.push(c); return this; }
  children(list) { this.kids.push(...list); return this; }
  when(condition, then) { return condition ? then(this) : this; }
  hover(then) { this.calls.push(["hover", then(element("hover"))]); return this; }
}

function element(tag) {
  const target = new El(tag);
  const self = new Proxy(target, {
    get(_, name) {
      if (name in target) {
        const value = target[name];
        return typeof value === "function" ? value.bind(self) : value;
      }
      return (...args) => { target.calls.push([name, ...args]); return self; };
    },
  });
  return self;
}

export const div = () => element("div");
export const h_flex = () => element("h_flex");
export const v_flex = () => element("v_flex");
export class View {}

function builder() {
  const steps = [];
  const self = {
    dash_array: () => self,
    move_to: (x, y) => { steps.push([x, y]); return self; },
    line_to: (x, y) => { steps.push([x, y]); return self; },
    build: () => steps,
  };
  return self;
}
export const PathBuilder = { stroke: builder };
globalThis.window = { paint_path: (path, color) => element("path").path(path).color(color) };

// Every element in a tree, parents first.
export function walk(el, visit) {
  visit(el);
  for (const kid of el.kids ?? []) if (typeof kid === "object" && kid) walk(kid, visit);
}
export const callOf = (el, name) => el.calls.find((c) => c[0] === name);
export function textOf(el) {
  const out = [];
  walk(el, (e) => { for (const kid of e.kids ?? []) if (typeof kid === "string") out.push(kid); });
  return out;
}
