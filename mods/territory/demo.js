// A made-up repo and crew for screenshots and GIFs. Nothing here touches a real repo, agent or file. The story goes through
// the same rules as real calls. No imports, so `node --test` can load this file.
//
// A step is 1.5 s on the screen and 15 s on the story's clock, so heat fades while you watch. Calls from before the first
// step are drawn from the same 24 steps, which means the loop has no seam and step 0 is already a lived-in map.

export const DEMO_STEP_MS = 1500;
const STORY_STEP_MS = 15000;
const START = 1893456000000;
const LOOKBACK = 60; // 15 minutes of story, as far back as a block remembers

export const DEMO_ROOT = "/work/harbour";

const SIZES = {
  "src/api/router.ts": 18400, "src/api/handlers/orders.ts": 15200, "src/api/handlers/users.ts": 9100, "src/api/handlers/search.ts": 7300,
  "src/api/middleware.ts": 6200, "src/api/errors.ts": 2100,
  "src/auth/session.ts": 12100, "src/auth/tokens.ts": 8300, "src/auth/passwords.ts": 4100, "src/auth/oauth.ts": 11000,
  "src/db/schema.ts": 21500, "src/db/queries.ts": 16800, "src/db/pool.ts": 3200, "src/db/migrations/001_start.sql": 5100,
  "src/db/migrations/002_orders.sql": 3900, "src/db/migrations/003_search.sql": 2800, "src/db/migrations/004_tokens.sql": 1500,
  "src/jobs/queue.ts": 9900, "src/jobs/mailer.ts": 5400, "src/jobs/cleanup.ts": 2200, "src/jobs/reports.ts": 6600,
  "src/config.ts": 3400, "src/index.ts": 1800, "src/log.ts": 1400,
  "web/app/page.tsx": 8800, "web/app/layout.tsx": 3100, "web/app/orders/page.tsx": 14200, "web/app/orders/detail.tsx": 10100,
  "web/app/account/page.tsx": 7700, "web/app/account/billing.tsx": 9400, "web/app/search/page.tsx": 6500,
  "web/components/table.tsx": 13300, "web/components/nav.tsx": 5900, "web/components/form.tsx": 11800, "web/components/modal.tsx": 4300,
  "web/components/chart.tsx": 12700, "web/components/button.tsx": 1900, "web/components/badge.tsx": 900, "web/components/toast.tsx": 2400,
  "web/styles/theme.css": 7200, "web/styles/reset.css": 1300, "web/lib/fetcher.ts": 3700, "web/lib/format.ts": 2600,
  "tests/api/orders.test.ts": 13900, "tests/api/users.test.ts": 8200, "tests/auth/session.test.ts": 10500, "tests/auth/tokens.test.ts": 6100,
  "tests/db/queries.test.ts": 9600, "tests/web/table.test.tsx": 5200, "tests/helpers.ts": 2900,
  "docs/api.md": 16200, "docs/setup.md": 4800, "docs/decisions.md": 7900,
  "scripts/seed.ts": 4500, "scripts/release.sh": 2300,
  "package.json": 2600, "tsconfig.json": 700, "README.md": 5600, ".gitignore": 120, "pnpm-lock.yaml": 310000,
};

const R = "Read", E = "Edit", W = "Write", G = "Grep";

// Each step: [agent, tool, path] calls. Wren and Otter meet on the router at step 7, and it clears after step 15.
const STORY = [
  [["wren", R, "src/api/middleware.ts"], ["otter", R, "src/db/queries.ts"], ["finch", R, "web/components/table.tsx"], ["heron", R, "docs/api.md"]],
  [["wren", R, "src/auth/session.ts"], ["finch", E, "web/components/table.tsx"], ["swift", R, "tests/api/orders.test.ts"]],
  [["otter", E, "src/db/queries.ts"], ["heron", R, "src/api/handlers/orders.ts"], ["swift", R, "tests/helpers.ts"]],
  [["wren", E, "src/auth/session.ts"], ["finch", R, "web/app/orders/page.tsx"], ["swift", E, "tests/api/orders.test.ts"]],
  [["otter", R, "src/db/schema.ts"], ["heron", R, "src/api/handlers/users.ts"], ["finch", E, "web/app/orders/page.tsx"]],
  [["wren", R, "src/api/router.ts"], ["otter", E, "src/db/schema.ts"], ["swift", R, "tests/auth/session.test.ts"]],
  [["wren", E, "src/api/router.ts"], ["finch", R, "web/components/form.tsx"], ["heron", E, "docs/api.md"]],
  [["otter", R, "src/api/router.ts"], ["swift", E, "tests/auth/session.test.ts"], ["finch", E, "web/components/form.tsx"]],
  [["wren", E, "src/api/router.ts"], ["heron", R, "docs/decisions.md"]],
  [["finch", R, "web/app/orders/detail.tsx"], ["swift", R, "tests/db/queries.test.ts"]],
  [["otter", E, "src/api/router.ts"], ["finch", E, "web/app/orders/detail.tsx"], ["heron", E, "docs/decisions.md"]],
  [["wren", R, "src/api/handlers/orders.ts"], ["swift", E, "tests/db/queries.test.ts"]],
  [["otter", R, "src/api/handlers/search.ts"], ["finch", R, "web/components/nav.tsx"]],
  [["wren", E, "src/api/handlers/orders.ts"], ["otter", E, "src/api/handlers/search.ts"], ["heron", R, "scripts/release.sh"]],
  [["finch", E, "web/components/nav.tsx"], ["swift", R, "tests/web/table.test.tsx"]],
  [["wren", R, "src/auth/tokens.ts"], ["otter", R, "src/db/migrations/003_search.sql"]],
  [["wren", E, "src/auth/tokens.ts"], ["otter", W, "src/db/migrations/005_index.sql"], ["finch", R, "web/styles/theme.css"]],
  [["heron", G, "src"], ["swift", E, "tests/web/table.test.tsx"], ["finch", E, "web/styles/theme.css"]],
  [["wren", R, "src/config.ts"], ["otter", R, "src/jobs/queue.ts"]],
  [["otter", E, "src/jobs/queue.ts"], ["finch", R, "web/app/account/billing.tsx"]],
  [["wren", E, "src/config.ts"], ["finch", E, "web/app/account/billing.tsx"]],
  [["otter", R, "src/jobs/reports.ts"], ["swift", R, "tests/auth/tokens.test.ts"]],
  [["wren", R, "src/index.ts"], ["otter", E, "src/jobs/reports.ts"], ["finch", R, "web/lib/fetcher.ts"]],
  [["heron", R, "README.md"], ["swift", E, "tests/auth/tokens.test.ts"], ["finch", E, "web/lib/fetcher.ts"]],
];

const CREW = [
  { key: "wren", name: "Wren", readable: true },
  { key: "otter", name: "Otter", readable: true },
  { key: "finch", name: "Finch", readable: true },
  { key: "heron", name: "Heron", readable: true },
  { key: "swift", name: "Swift", readable: true, owner: "wren", sub: true },
  { key: "lark", name: "Lark", readable: false },
];

const blockedAt = (at) => at >= 19 && at <= 22;
const wrap = (step) => ((step % STORY.length) + STORY.length) % STORY.length;

export function demoRepo() {
  const files = Object.entries(SIZES).map(([path, bytes]) => [path, bytes]);
  return { state: "ok", root: DEMO_ROOT, name: "harbour", stamp: "demo", total: files.length, guessed: 0, files, rest: [] };
}

// `{ now, crew, events }` at a step. `events` is keyed by agent, in the form territory.py prints.
export function demoWorld(step) {
  const now = START + step * STORY_STEP_MS, events = {};
  for (let back = LOOKBACK; back >= 0; back -= 1) {
    const at = now - back * STORY_STEP_MS;
    for (const [agent, tool, path] of STORY[wrap(step - back)]) (events[agent] ??= []).push([at, tool, `${DEMO_ROOT}/${path}`, null]);
  }
  const crew = CREW.map((c) => ({
    ...c, address: null, pane: null, owner: c.owner ?? null, sub: c.sub ?? false,
    status: c.key === "heron" && blockedAt(wrap(step)) ? "blocked" : c.key === "lark" ? "idle" : "working",
  }));
  return { now, crew, events };
}
