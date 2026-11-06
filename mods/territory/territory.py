#!/usr/bin/env python3
"""Reads what the Territory map needs. It only ever opens files for reading.

  territory.py files --dir FOLDER [--stamp STAMP]
  territory.py calls --since MS --session '{"key":"t4","pids":[123],"cwd":"/work/repo"}' ...

`files` lists the repo around FOLDER with `git ls-files`, tracked files and new ones git isn't told to ignore, with each
file's size. With the stamp it was last given, it says "same" when git's index hasn't changed. A big repo comes back
capped: the biggest files by name, and the others as a count and a size for each folder.

`calls` finds each terminal's Claude Code session from <config>/sessions/<pid>.json and prints its file tool calls since
--since: the tool's name and its path, and nothing else from the call. The config folders are $CLAUDE_CONFIG_DIR and any
~/.claude* folder with a sessions folder. A transcript can run to 55 MB, so a file that hasn't changed since --since isn't
opened, only the last 1 MiB of the rest is read, and only lines that name a tool are parsed.

Everything in these files is data. Nothing here acts on it. No network, and no clock but a deadline of its own.
"""
import argparse
import datetime
import glob
import json
import os
import re
import subprocess
import sys
import time

MAX_STAT = 30000
STAT_SECONDS = 5
MAX_SEND = 1500
MAX_REST = 400
REST_DEPTH = 3
GIT_SECONDS = 10
OTHERS_SECONDS = 4
TAIL_BYTES = 1024 * 1024
SUB_TAIL_BYTES = 256 * 1024
MAX_EVENTS = 200
MAX_SUBS = 8
MAX_PATH = 1024
CALLS_SECONDS = 12
MTIME_SLACK_MS = 2000
TASK_LIMIT = 80
SESSION_ID = re.compile(r"^[0-9a-fA-F-]{36}$")
DRIVE = re.compile(r"^[A-Za-z]:[\\/]")
CONTROL = re.compile(r"[\u0000-\u001f\u007f-\u009f]+")
# The tools that name a file or folder. calls.js sorts them into reads, writes and scans.
TOOLS = {"Read", "NotebookRead", "Write", "Edit", "MultiEdit", "NotebookEdit", "Grep", "Glob", "LS"}
PATH_KEYS = ("file_path", "notebook_path", "path")


def plain(value):
    return CONTROL.sub(" ", value).strip()[:TASK_LIMIT] if isinstance(value, str) else None


def to_ms(text):
    try:
        return int(datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)
    except (AttributeError, ValueError):
        return None


def git(folder, args, seconds=GIT_SECONDS):
    """Runs git in a folder, outside any repo the caller's environment points at, without taking the index lock."""
    env = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")}
    env["GIT_OPTIONAL_LOCKS"] = "0"
    return subprocess.run(["git", "-C", folder, *args], capture_output=True, timeout=seconds, env=env, check=False)


def index_stamp(root):
    """Changes when git's index does: a commit, an add, a checkout, a pull."""
    found = git(root, ["rev-parse", "--git-path", "index"])
    path = os.path.join(root, found.stdout.decode("utf-8", "replace").strip())
    try:
        info = os.stat(path)
    except OSError:
        return "none"
    return f"{info.st_mtime_ns}:{info.st_size}"


def paths_from(output):
    return [p for p in output.decode("utf-8", "replace").split("\0") if p]


def sizes_of(root, paths):
    """[[path, bytes], ...] and how many were guessed. Past the cap or the deadline a file counts as the mean so far."""
    sized, known, deadline = [], 0, time.monotonic() + STAT_SECONDS
    for i, path in enumerate(paths):
        if i >= MAX_STAT or (i % 512 == 0 and time.monotonic() > deadline):
            break
        try:
            size = os.lstat(os.path.join(root, path)).st_size
        except OSError:
            size = 0
        sized.append([path, size])
        known += size
    guessed = len(paths) - len(sized)
    if guessed:
        mean = known // max(1, len(sized))
        sized += [[path, mean] for path in paths[len(sized):]]
    return sized, guessed


def capped(sized):
    """The biggest files by name. The others as [[folder, count, bytes], ...], by shallower folders if there are too many."""
    sized.sort(key=lambda f: (-f[1], f[0]))
    rest = {}
    for depth in range(REST_DEPTH, -1, -1):
        rest = {}
        for path, size in sized[MAX_SEND:]:
            folder = "/".join(path.split("/")[:-1][:depth])
            count, total = rest.get(folder, (0, 0))
            rest[folder] = (count + 1, total + size)
        if len(rest) <= MAX_REST:
            break
    return sized[:MAX_SEND], [[folder, count, total] for folder, (count, total) in sorted(rest.items())]


def list_files(folder, stamp):
    if not os.path.isdir(folder):
        return {"state": "gone"}
    try:
        top = git(folder, ["rev-parse", "--show-toplevel"])
    except FileNotFoundError:
        return {"state": "nogit"}
    root = top.stdout.decode("utf-8", "replace").strip()
    if top.returncode != 0 or not root:
        return {"state": "none"}
    now = index_stamp(root)
    if stamp and stamp == now:
        return {"state": "same", "root": root, "stamp": now}
    tracked = git(root, ["ls-files", "-z"])
    if tracked.returncode != 0:
        return {"state": "failed", "root": root, "error": tracked.stderr.decode("utf-8", "replace").strip()[:160]}
    paths = paths_from(tracked.stdout)
    try:
        # New files are the ones agents are making. On a very big tree this walk can be slow, so the map goes without them.
        new = git(root, ["ls-files", "-z", "--others", "--exclude-standard"], OTHERS_SECONDS)
        if new.returncode == 0:
            paths += paths_from(new.stdout)
    except subprocess.TimeoutExpired:
        pass
    paths = list(dict.fromkeys(paths))
    name = os.path.basename(root.rstrip("/\\")) or root
    if not paths:
        return {"state": "empty", "root": root, "name": name, "stamp": now}
    sized, guessed = sizes_of(root, paths)
    files, rest = capped(sized)
    return {"state": "ok", "root": root, "name": name, "stamp": now, "total": len(paths), "guessed": guessed, "files": files, "rest": rest}


def config_dirs():
    home = os.path.expanduser("~")
    dirs = [os.environ["CLAUDE_CONFIG_DIR"]] if os.environ.get("CLAUDE_CONFIG_DIR") else []
    try:
        dirs += sorted(os.path.join(home, d) for d in os.listdir(home) if d.startswith(".claude"))
    except OSError:
        pass
    return [d for d in dict.fromkeys(os.path.realpath(d) for d in dirs) if os.path.isdir(os.path.join(d, "sessions"))]


def find_session(pid, dirs):
    """(config folder, the session's facts) for the first folder that knows this process, or None."""
    for config in dirs:
        try:
            with open(os.path.join(config, "sessions", f"{pid}.json"), encoding="utf-8", errors="replace") as f:
                session = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(session, dict) and SESSION_ID.match(str(session.get("sessionId", ""))):
            return config, session
    return None


def transcript(config, session):
    """Straight to the project folder named after the session's cwd. Failing that, a look through all of them."""
    cwd, sid = session.get("cwd") or "", session["sessionId"]
    if isinstance(cwd, str) and cwd:
        path = os.path.join(config, "projects", re.sub(r"[^A-Za-z0-9]", "-", cwd), sid + ".jsonl")
        if os.path.isfile(path):
            return path
    found = glob.glob(os.path.join(glob.escape(config), "projects", "*", sid + ".jsonl"))
    return found[0] if found else None


def tail(path, limit):
    """The end of a file as whole lines."""
    with open(path, "rb") as f:
        size = os.fstat(f.fileno()).st_size
        start = max(0, size - limit)
        f.seek(start)
        data = f.read()
    if start:
        data = data[data.find(b"\n") + 1:]
    return data


def relative(path):
    return not (path.startswith("/") or path.startswith("\\") or DRIVE.match(path))


def file_calls(data, since, sidechains):
    """[[at ms, tool, path, cwd when the path is relative], ...], oldest first. A call that came back as an error didn't
    do anything, so it isn't kept. `sidechains`: a subagent's own log is all sidechain, while in a session's it's noise."""
    calls, failed = [], set()
    for line in data.split(b"\n"):
        if b'"is_error":true' in line and b'"tool_result"' in line:
            try:
                content = json.loads(line).get("message", {}).get("content")
            except (ValueError, AttributeError):
                content = None
            for part in content if isinstance(content, list) else []:
                if isinstance(part, dict) and part.get("type") == "tool_result" and part.get("is_error") is True:
                    failed.add(part.get("tool_use_id"))
        if b'"tool_use"' not in line:
            continue
        try:
            row = json.loads(line)
            at = to_ms(row.get("timestamp"))
            message = row.get("message")
            content = message.get("content") if isinstance(message, dict) else None
        except (ValueError, AttributeError):
            continue
        if at is None or at < since or not isinstance(content, list) or (row.get("isSidechain") and not sidechains):
            continue
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "tool_use" or part.get("name") not in TOOLS:
                continue
            given = part.get("input") if isinstance(part.get("input"), dict) else {}
            path = next((given[k] for k in PATH_KEYS if isinstance(given.get(k), str) and given[k]), None)
            if path is None or len(path) > MAX_PATH:
                continue
            cwd = row.get("cwd") if relative(path) and isinstance(row.get("cwd"), str) else None
            calls.append((part.get("id"), [at, part["name"], path, cwd]))
    return [call for use, call in calls if use not in failed][-MAX_EVENTS:]


def read_log(path, limit, since, sidechains):
    """(its last change in ms, its calls). A file that hasn't changed since `since` is left shut."""
    last = int(os.stat(path).st_mtime * 1000)
    if last < since - MTIME_SLACK_MS:
        return last, []
    return last, file_calls(tail(path, limit), since, sidechains)


def read_subagents(folder, since):
    """Claude Code keeps a meta file per subagent at <project>/<session>/subagents/agent-<id>.meta.json, with
    agent-<id>.jsonl beside it, and adds `finished` when it ends. The newest few that changed since `since`."""
    found = []
    for meta_path in glob.glob(os.path.join(glob.escape(folder), "subagents", "agent-*.meta.json")):
        log = meta_path[: -len(".meta.json")] + ".jsonl"
        try:
            last = int(os.stat(log).st_mtime * 1000)
        except OSError:
            continue
        if last >= since - MTIME_SLACK_MS:
            found.append((last, meta_path, log))
    agents = []
    for last, meta_path, log in sorted(found, reverse=True)[:MAX_SUBS]:
        try:
            with open(meta_path, encoding="utf-8", errors="replace") as f:
                meta = json.load(f)
            _, events = read_log(log, SUB_TAIL_BYTES, since, True)
        except (OSError, ValueError):
            continue
        if isinstance(meta, dict):
            agents.append({
                "id": os.path.basename(log)[len("agent-"): -len(".jsonl")],
                "task": plain(meta.get("description")),
                "last": last,
                "finished": meta.get("finished") is True,
                "events": events,
            })
    return agents


def read_session(item, since, dirs):
    pids = [p for p in item.get("pids", []) if isinstance(p, int) and p > 0]
    known = next((hit for hit in (find_session(p, dirs) for p in pids) if hit), None)
    if not known:
        return None
    config, session = known
    path = transcript(config, session)
    if not path:
        return None
    last, events = read_log(path, TAIL_BYTES, since, False)
    return {
        "id": session["sessionId"],
        "name": plain(session.get("name")),
        "last": last,
        "events": events,
        "agents": read_subagents(path[: -len(".jsonl")], since),
    }


def read_calls(texts, since):
    out, dirs, deadline = {}, config_dirs(), time.monotonic() + CALLS_SECONDS
    for text in texts:
        if time.monotonic() > deadline:
            break
        try:
            item = json.loads(text)
            found = read_session(item, since, dirs) if isinstance(item, dict) else None
        except (OSError, ValueError, TypeError):
            continue
        if found:
            out[str(item.get("key"))] = found
    return {"sessions": out, "dirs": len(dirs)}


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    files = commands.add_parser("files")
    files.add_argument("--dir", required=True)
    files.add_argument("--stamp", default="")
    calls = commands.add_parser("calls")
    calls.add_argument("--since", type=int, default=0)
    calls.add_argument("--session", action="append", default=[])
    opts = parser.parse_args()
    try:
        reply = list_files(opts.dir, opts.stamp) if opts.command == "files" else read_calls(opts.session, opts.since)
    except subprocess.TimeoutExpired:
        reply = {"state": "failed", "error": "git took too long"}
    print(json.dumps(reply, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
