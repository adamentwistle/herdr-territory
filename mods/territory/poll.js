// Guards for the reads the map makes on a timer. No Herdr imports, so `node --test` can load this file.

// Rejects once `ms` has passed with no answer, so one hung call can't hold the map. `sleep` is `cx.sleep`.
export function timed(promise, ms, what, sleep) {
  const late = sleep(ms).then(() => { throw new Error(`${what} didn't answer within ${Math.round(ms / 1000)} s`); });
  return Promise.race([promise, late]);
}

// What a helper printed, as `{ value, error }`. A crash or bad output is named, not passed off as nothing to show.
export function helperReply(result, name) {
  if (result?.code !== 0) {
    const why = String(result?.stderr ?? "").trim().split("\n").at(-1)?.slice(0, 160);
    return { value: null, error: `${name} stopped with code ${result?.code ?? "unknown"}${why ? `: ${why}` : ""}` };
  }
  try {
    return { value: JSON.parse(result.stdout), error: null };
  } catch {
    return { value: null, error: `${name} printed something that isn't JSON` };
  }
}

// Why a helper couldn't run at all: it didn't answer, or python3 couldn't start it.
export const helperFailure = (e, name) => {
  const why = String(e?.message ?? e);
  return /didn't answer/.test(why) ? why : `python3 couldn't start ${name}: ${why}`;
};

function pathTo(node, id) {
  if (node?.id === id) return [node];
  for (const child of node?.children ?? []) {
    const below = pathTo(child, id);
    if (below) return [node, ...below];
  }
  return null;
}

// Can this block be seen? Its node and everything above it must be showing, and any stack on the way must have that
// branch as its active child. A block that isn't in the shown layout can't be seen either.
export function isShown(root, id) {
  const path = pathTo(root, id);
  if (!path) return false;
  return path.every((node, i) => !node?.hidden && (node?.type !== "stack" || !path[i + 1] || node.active === path[i + 1].id));
}
