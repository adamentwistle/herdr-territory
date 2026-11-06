// Runs the mod with no app: a fake clock, fake timers and a render after each cx.notify().

import "./register.js";
import { host } from "./herdr.js";

const { default: Territory } = await import("../../mods/territory/main.js");

export { host };

export class Run {
  constructor({ now = Date.UTC(2026, 5, 1, 10, 0, 30), width = 1440, height = 460 } = {}) {
    this.now = now;
    this.timers = [];
    this.renders = 0;
    this.notified = false;
    this.realNow = Date.now;
    Date.now = () => this.now;
    globalThis.localStorage = this.storage();
    this.mod = new Territory();
    this.mod.init(host.props, this.cx());
    this.render();
    this.mod.resized({ width, height }, this.cx());
    this.render();
  }

  storage() {
    const map = new Map();
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
  }

  cx() {
    const add = (ms, fn, repeat) => {
      const timer = { at: this.now + ms, ms, fn, repeat };
      this.timers.push(timer);
      return { cancel: () => this.timers.splice(this.timers.indexOf(timer), 1), is_done: () => false };
    };
    return {
      notify: () => { this.notified = true; },
      stop_propagation() {},
      sleep: () => new Promise(() => {}), // nothing here ever runs late
      spawn: (body) => { body(this.cx()); return { cancel() {}, is_done: () => false }; },
      timer: { after: (ms, fn) => add(ms, fn, false), every: (ms, fn) => add(ms, fn, true) },
    };
  }

  render() {
    this.notified = false;
    this.renders += 1;
    this.tree = this.mod.render();
    return this.tree;
  }

  // Lets every read that has started finish, and draws what they asked for.
  async settle() {
    for (let i = 0; i < 12; i += 1) await new Promise((done) => setImmediate(done));
    if (this.notified) this.render();
  }

  async advance(ms) {
    const end = this.now + ms;
    for (;;) {
      const next = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.now = next.at;
      if (next.repeat) next.at += next.ms;
      else this.timers.splice(this.timers.indexOf(next), 1);
      next.fn(this.cx());
      await this.settle();
    }
    this.now = end;
  }

  stop() {
    Date.now = this.realNow;
    host.reset();
  }
}
