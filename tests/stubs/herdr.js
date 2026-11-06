// Stands in for the `herdr` module. A test sets what it answers through `host`.

const THEME = {
  background: "#101010", canvas: "#0a0a0a", surface: "#141414", raised: "#1c1c1c", popover: "#202020", hover: "#262626", input: "#333333", border: "#2a2a2a",
  foreground: "#eeeeee", muted: "#aaaaaa", dim: "#777777", accent: "#88aaff", blocked: "#ff5544", done: "#55cc88", working: "#ffcc44",
  ansi1: "#ff5544", ansi2: "#55cc88", ansi3: "#ffcc44", ansi4: "#5599ff", ansi5: "#cc77ff", ansi6: "#44cccc",
  ansi9: "#ff7766", ansi10: "#77ddaa", ansi11: "#ffdd66", ansi12: "#77aaff", ansi13: "#dd99ff", ansi14: "#66dddd",
};

const tree = () => ({ id: "root", type: "column", children: [{ id: "territory", type: "block" }, { id: "body", type: "row", children: [] }] });
const fresh = () => ({
  agents: [], props: null, zoom: 1, ran: [], layout: tree(), spaces: [], panes: [], focused: null, execs: [], hcs: [],
  list: [], facts: {}, filesReply: { state: "none" }, callsReply: { sessions: {}, dirs: 1 }, execFails: null,
});

export const host = { ...fresh(), reset() { Object.assign(host, fresh()); } };

export const agents = () => host.agents;
export const appHome = () => "/home/test/.config/herdr-app";
export const home = () => "/home/test";
export const focused = () => host.focused;
export const layout = () => host.layout;
export const panes = () => host.panes;
export const props = () => host.props;
export const settings = () => ({ zoom: host.zoom });
export const spaces = () => host.spaces;
export const theme = () => THEME;
export const window = () => null;
export const nextCommand = () => new Promise(() => {});
export const run = (name, args) => { host.ran.push([name, args]); return null; };

export async function exec(command, args) {
  host.execs.push([command, ...args]);
  if (host.execFails) throw new Error(host.execFails);
  const reply = args.includes("files") ? host.filesReply : host.callsReply;
  return { code: 0, stdout: JSON.stringify(reply), stderr: "" };
}

export async function hc(args) {
  host.hcs.push(args);
  if (args[0] === "ls") return { code: 0, stdout: JSON.stringify({ terminals: host.list }), stderr: "" };
  return { code: 0, stdout: JSON.stringify(host.facts[args[1]] ?? {}), stderr: "" };
}
