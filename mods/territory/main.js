// Territory: the focused space's repo as a map, with each coding agent as a dot on the file it last touched. The rules are in
// treemap.js, calls.js, activity.js, crew.js and frame.js, the made-up story is in demo.js, the drawing is in view.js and
// territory.py does the reading. This file holds the state and the timers.
//
// One timer ticks once a second. While the block can't be seen it does nothing else. While it can, it reads every third
// tick, and it redraws only when the picture has changed. Dots, fades and pulses are the app's own motion.
import { View } from "gpui-kit";
import { agents, appHome, exec, focused, hc, home, layout, nextCommand, panes, props, run, settings, spaces, theme, window } from "herdr";
import { RECENT_MS, addTouches } from "./activity.js";
import { touchesFrom } from "./calls.js";
import { READABLE_APP, assignSlots, crewOf, placeOf, withStatus, withTranscripts } from "./crew.js";
import { DEMO_STEP_MS, demoRepo, demoWorld } from "./demo.js";
import { buildFrame, hasMap, thousands, zoneOf } from "./frame.js";
import { helperFailure, helperReply, isShown, timed } from "./poll.js";
import { layoutMap } from "./treemap.js";
import { COLOURS, territory } from "./view.js";

const BLOCK = "territory"; // the map's node in the layout
const OPEN_PX = 460; // its height in the layout
const FOLD_PX = 44; // the header alone
const FIRST_SIZE = { width: 1280, height: OPEN_PX }; // until the first layout says
const TICK_MS = 1000;
const READ_EVERY = 3; // ticks between reads of the transcripts
const FILES_EVERY = 30; // ticks between looks at git's index
const NEW_FILE_EVERY = 10; // ticks between looks when a new file has turned up
const OVERLAP_MS = 10000; // each read reaches this far behind the last, and repeats are dropped
const PID_MS = 20000;
const HC_MS = 8000;
const CALLS_MS = 20000;
const FILES_MS = 25000;
const HELPER = () => `${appHome()}/mods/territory/territory.py`;

const NOTES = {
  loading: { title: "Reading the repo" },
  nofocus: { title: "No space in focus" },
  none: { title: "No git repo here" },
  empty: { title: "Nothing in this repo yet" },
  gone: { title: "This folder has gone" },
  nogit: { title: "git isn't installed" },
  failed: { title: "Couldn't read the repo" },
};

export default class Territory extends View {
  init(_props, cx) {
    this.demo = props()?.demo === true;
    this.size = null;
    this.slots = new Map();
    this.known = new Map(); // everyone seen on this repo, gone or not: key -> { name, owner }
    this.crew = [];
    this.touches = [];
    this.place = null;
    this.repo = null;
    this.map = null;
    this.mapFor = "";
    this.frame = null;
    this.drawn = "";
    this.picked = null;
    this.problem = null;
    this.reading = false;
    this.listing = false;
    this.ticks = 0;
    this.seenUntil = null;
    this.shown = false;
    this.pids = new Map();
    this.looked = new Set();
    this.wantFiles = false;
    this.step = 0;
    this.openHeight = Number(localStorage.getItem("open")) || OPEN_PX;
    this.onSize = (size, cx) => this.resized(size, cx);
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "fold") this.toggleFold();
    });
    if (this.demo) {
      this.repo = demoRepo();
      this.playDemo();
      cx.timer.every(DEMO_STEP_MS, (cx) => this.demoTick(cx));
      return;
    }
    cx.timer.every(TICK_MS, (cx) => this.tick(cx));
    this.tick(cx);
  }

  // ---- The story, for screenshots and GIFs.

  playDemo() {
    const world = demoWorld(this.step);
    this.now = world.now;
    this.crew = world.crew;
    assignSlots(this.slots, this.crew, COLOURS);
    this.known = new Map(this.crew.map((c) => [c.key, c]));
    this.touches = addTouches([], Object.entries(world.events).flatMap(([key, events]) => touchesFrom(key, events, this.repo.root)), world.now);
  }

  demoTick(cx) {
    if (!isShown(layout(), BLOCK)) return;
    this.step += 1;
    this.playDemo();
    this.update(cx);
  }

  // ---- Reading.

  tick(cx) {
    const seen = isShown(layout(), BLOCK), back = seen && !this.shown;
    this.shown = seen;
    if (!seen) return;
    this.ticks += 1;
    const moved = this.follow(cx);
    if (moved || back || this.ticks % READ_EVERY === 0) this.readCalls(cx);
    if (this.wantFiles && this.ticks % NEW_FILE_EVERY === 0) {
      this.wantFiles = false;
      this.readFiles(cx, true);
    } else if (this.ticks % FILES_EVERY === 0) this.readFiles(cx);
    this.crew = withStatus(this.crew, agents());
    this.update(cx);
  }

  // True when the map should now show somewhere else.
  follow(cx) {
    const next = placeOf({ focused: focused(), spaces: spaces(), panes: panes(), home: home() });
    if (next.key === this.place?.key) return false;
    this.place = next;
    if (next.state === "ok") this.readFiles(cx);
    else this.setRepo({ state: next.state, machine: next.machine });
    return true;
  }

  setRepo(repo) {
    const moved = repo.root !== this.repo?.root;
    this.repo = repo;
    this.map = null; this.mapFor = ""; this.frame = null;
    if (moved) { this.touches = []; this.seenUntil = null; this.picked = null; this.looked.clear(); this.known.clear(); }
  }

  // One list at a time. A folder that changed while it ran gets its own turn on the next tick.
  readFiles(cx, fresh = false) {
    if (this.listing || this.place?.state !== "ok") return;
    this.listing = true;
    const asked = this.place.folder, known = !fresh && this.repo?.stamp && this.repo.folder === asked ? this.repo.stamp : "";
    cx.spawn(async (cx) => {
      const args = ["-I", "-S", HELPER(), "files", "--dir", asked];
      if (known) args.push("--stamp", known);
      let reply;
      try {
        const { value, error } = helperReply(await timed(exec("python3", args), FILES_MS, "territory.py", (ms) => cx.sleep(ms)), "territory.py");
        reply = value ?? { state: "failed", error };
      } catch (e) {
        reply = { state: "failed", error: helperFailure(e, "territory.py") };
      }
      this.listing = false;
      if (asked !== this.place?.folder) { this.readFiles(cx); return; }
      if (reply.state === "same") return;
      this.setRepo({ ...reply, folder: asked });
      this.readCalls(cx);
      this.update(cx);
    });
  }

  // One read at a time, so a slow one can't be overtaken for ever.
  readCalls(cx) {
    if (this.reading || !this.place) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        await this.loadCalls((ms) => cx.sleep(ms));
      } catch (e) {
        this.problem = String(e?.message ?? e);
      }
      this.reading = false;
      this.update(cx);
    });
  }

  // Every terminal hc knows. A failure says what went wrong rather than looking like an empty list.
  async listTerminals(sleep) {
    const listed = await timed(hc(["ls", "--all", "--json"]), HC_MS, "hc ls", sleep);
    if (listed?.code !== 0) throw new Error(`hc ls stopped with code ${listed?.code}`);
    const list = helperReply(listed, "hc ls").value?.terminals;
    if (!Array.isArray(list)) throw new Error("hc ls gave no list of terminals");
    return list;
  }

  // The processes a terminal runs. Asked of hc now and then, because it takes a call per terminal.
  async pidsOf(address, sleep, now) {
    const had = this.pids.get(address);
    if (had && now - had.at < PID_MS) return had.pids;
    const got = await timed(hc(["get", address, "--json"]), HC_MS, "hc get", sleep).catch(() => null);
    const facts = got?.code === 0 ? helperReply(got, "hc get").value : null;
    const pids = [facts?.foreground?.pid, facts?.pid].filter((pid) => Number.isInteger(pid) && pid > 0);
    this.pids.set(address, { at: now, pids });
    return pids;
  }

  async loadCalls(sleep) {
    const now = Date.now(), asked = this.place, root = this.repo?.root ?? null;
    const crew = crewOf({ list: await this.listTerminals(sleep), agents: agents(), space: asked.space, root });
    const readable = crew.filter((c) => c.app === READABLE_APP);
    const sessions = await Promise.all(readable.map(async (c) => ({ key: c.key, pids: await this.pidsOf(c.key, sleep, now) })));
    const since = this.seenUntil == null ? now - RECENT_MS : this.seenUntil - OVERLAP_MS;
    const reply = await this.readSessions(sessions.filter((s) => s.pids.length), since, sleep);
    if (asked !== this.place || root !== (this.repo?.root ?? null)) return; // the map moved on while this read
    this.problem = reply.error;
    const { crew: read, touches, known } = withTranscripts({ crew, sessions: reply.sessions, root, now });
    this.crew = read;
    for (const entry of known) this.known.set(entry.key, entry);
    assignSlots(this.slots, known, COLOURS);
    this.touches = addTouches(this.touches, touches, now);
    this.seenUntil = now;
    this.lookForNewFiles(touches);
  }

  async readSessions(sessions, since, sleep) {
    if (!sessions.length) return { sessions: {}, error: null };
    const args = ["-I", "-S", HELPER(), "calls", "--since", String(since)];
    for (const s of sessions) args.push("--session", JSON.stringify(s));
    try {
      const { value, error } = helperReply(await timed(exec("python3", args), CALLS_MS, "territory.py", sleep), "territory.py");
      return { sessions: value?.sessions ?? {}, error: error ? `Transcripts unreadable: ${error}` : null };
    } catch (e) {
      return { sessions: {}, error: `Transcripts unreadable: ${helperFailure(e, "territory.py")}` };
    }
  }

  // A write that lands on a bare folder is a file the map doesn't have yet, so the list is out of date. Once per file, so a
  // path git ignores can't ask again and again.
  lookForNewFiles(touches) {
    const map = this.currentMap();
    if (!map) return;
    for (const t of touches) {
      if (t.kind !== "write" || !t.path || this.looked.has(t.path) || map.locate(t.path)?.kind) continue;
      this.looked.add(t.path);
      this.wantFiles = true;
    }
  }

  // ---- The picture.

  // on_size_change reports window pixels, and everything drawn is in the app's own, scaled by the zoom.
  resized(size, cx) {
    const zoom = settings()?.zoom || 1;
    const next = { width: size.width / zoom, height: size.height / zoom };
    if (next.width === this.size?.width && next.height === this.size?.height) return;
    this.size = next;
    this.frame = null;
    cx.notify();
  }

  area() { return this.size ?? FIRST_SIZE; }

  currentMap() {
    const { width, height } = this.area();
    const key = `${this.repo?.root}|${this.repo?.stamp}|${width}|${zoneOf(height)}`;
    if (key === this.mapFor) return this.map;
    this.mapFor = key;
    this.map = this.repo?.state === "ok" && hasMap(height)
      ? layoutMap({ files: this.repo.files, rest: this.repo.rest, width, height: zoneOf(height) })
      : null;
    return this.map;
  }

  clock() { return this.demo ? this.now : Date.now(); }

  picture() {
    const { width, height } = this.area();
    return buildFrame({
      map: this.currentMap(), crew: this.crew, touches: this.touches, now: this.clock(), width, height, picked: this.picked, repoName: this.repo?.name ?? "",
      nameOf: (key) => this.known.get(key)?.name ?? "An agent", ownerOf: (key) => this.known.get(key)?.owner ?? null,
    });
  }

  // What the drawing depends on, beyond the frame: the map's shape and what the header and the dock say.
  signature(frame) {
    return `${this.mapFor}|${this.repo?.state}|${this.problem}|${this.seeing()}|${frame.sig}`;
  }

  // Redraws only when the picture has changed.
  update(cx) {
    const frame = this.picture();
    this.frame = frame;
    if (this.signature(frame) !== this.drawn) cx.notify();
  }

  // ---- What the header and the dock say.

  title() { return this.repo?.name ?? "Territory"; }

  facts() {
    const repo = this.repo;
    if (repo?.state !== "ok") return "";
    const count = thousands(repo.total), grouped = this.frame?.map?.grouped ?? 0;
    return grouped ? `${count} files, ${thousands(grouped)} in groups` : `${count} files`;
  }

  note() {
    const repo = this.repo;
    if (repo?.state === "remote") return { title: `This space is on ${repo.machine}`, detail: "Territory reads this computer only" };
    const note = NOTES[repo?.state ?? "loading"] ?? NOTES.loading;
    return { ...note, detail: repo?.error ?? (repo?.state === "none" ? this.place?.folder : null) };
  }

  // Says what the map can't: it comes from transcripts, and only those it can read.
  seeing(short) {
    const all = this.crew.length, read = this.crew.filter((c) => c.readable).length;
    if (short) return `Seconds behind. Sees ${read} of ${all}.`;
    return `From transcripts, a few seconds behind. Sees ${read} of ${all} agent${all === 1 ? "" : "s"}.`;
  }

  // ---- Presses.

  pressTile(key, cx) {
    this.picked = this.picked === key ? null : key;
    this.frame = null;
    cx.notify();
  }

  // Goes to the agent. A subagent has no terminal, so a press on it goes to the session that started it.
  pressDot(key) {
    if (this.demo) return;
    const agent = this.crew.find((c) => c.key === key), target = agent?.owner ? this.crew.find((c) => c.key === agent.owner) : agent;
    if (target?.pane) run("pane.focus", { pane: target.pane });
    else if (target?.address) run("terminal.peek", { terminal: target.address });
  }

  isFolded() { return this.area().height <= FOLD_PX + 1; }

  // Down to the header, which keeps the collision line in view, or back to the height it had.
  toggleFold() {
    if (this.isFolded()) {
      run("layout.resize", { id: BLOCK, px: this.openHeight });
      return;
    }
    this.openHeight = Math.round(this.area().height);
    localStorage.setItem("open", String(this.openHeight));
    run("layout.resize", { id: BLOCK, px: FOLD_PX });
  }

  render() {
    const frame = this.frame ?? this.picture();
    this.frame = frame;
    this.drawn = this.signature(frame);
    const { width, height } = this.area(), w = window();
    return territory(this, frame, {
      width, height, inset: w?.platform === "macos" && !w.fullscreen ? 84 : 16, folded: this.isFolded(), showMap: hasMap(height), onSize: this.onSize,
    }, theme());
  }
}
