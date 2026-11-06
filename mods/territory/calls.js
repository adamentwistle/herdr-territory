// Turns tool calls from a transcript into places on the map. No Herdr imports, so `node --test` can load this file.

// A read or a write has the file in hand. A scan only says where the agent is looking, so the dot goes there and nothing
// else follows from it. territory.py keeps the same names.
export const TOOLS = {
  Read: "read", NotebookRead: "read",
  Write: "write", Edit: "write", MultiEdit: "write", NotebookEdit: "write",
  Grep: "scan", Glob: "scan", LS: "scan",
};

const slashes = (path) => path.replace(/\\/g, "/");
const absolute = (path) => path.startsWith("/") || /^[A-Za-z]:\//.test(path);
const onDrive = (path) => /^[A-Za-z]:\//.test(path);

function tidy(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "." || (part === "" && out.length)) continue;
    if (part === ".." && out.length > 1) out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// A path from the top of the repo: "" for the top itself, null for anywhere outside it. A relative path starts from
// `cwd`. Drive letters and Windows paths don't care about case.
export function repoPath(raw, root, cwd) {
  if (typeof raw !== "string" || !raw || !root) return null;
  let path = slashes(raw);
  if (!absolute(path)) {
    if (typeof cwd !== "string" || !cwd) return null;
    path = `${slashes(cwd).replace(/\/+$/, "")}/${path}`;
  }
  path = tidy(path);
  const base = slashes(root).replace(/\/+$/, "");
  const same = onDrive(base) ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
  if (same(path, base)) return "";
  if (path[base.length] === "/" && same(path.slice(0, base.length), base)) return path.slice(base.length + 1);
  return null;
}

// One touch per call, oldest first. A call outside the repo has no `path`: the agent has gone elsewhere. A scan of the
// whole repo says nothing about where it is, so it's dropped. `events` is what territory.py printed:
// [[at ms, tool, path, cwd or null], ...].
export function touchesFrom(agent, events, root) {
  const out = [];
  for (const [at, tool, path, cwd] of events ?? []) {
    const kind = TOOLS[tool];
    if (!kind || !Number.isFinite(at)) continue;
    const inside = repoPath(path, root, cwd);
    if (inside === "") continue;
    out.push({ at, agent, tool, path: inside, kind });
  }
  return out;
}
