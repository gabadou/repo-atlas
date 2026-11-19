// Each file's git history from one `git log` over the whole repo (renames followed): when it was created,
// when it last changed and why, how many commits touched it, how many in the last 90 days, by how many people.
import { execFileSync } from "node:child_process";

const DAY = 86_400;

export function history(root, paths) {
  let out;
  try {
    out = execFileSync(
      "git",
      ["log", "--no-merges", "-M", "--name-status", "--format=%x1e%at%x1f%an%x1f%s", "--max-count=50000"],
      { cwd: root, maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    ).toString("utf8");
  } catch {
    return null;
  }
  if (!out.trim()) return null;

  const wanted = new Set(paths);
  const alias = new Map(); // older path -> today's path
  const now = Math.floor(Date.now() / 1000);
  const stats = new Map();
  let commits = 0;
  let first = Infinity;
  let last = 0;
  const people = new Set();

  // Newest first, so a rename is seen before the older commits that used the old name.
  for (const entry of out.split("\x1e")) {
    if (!entry.trim()) continue;
    const [head, ...rest] = entry.split("\n");
    const [at, author, subject] = head.split("\x1f");
    const t = +at;
    commits++;
    first = Math.min(first, t);
    last = Math.max(last, t);
    people.add(author);
    for (const line of rest) {
      if (!line) continue;
      const parts = line.split("\t");
      const status = parts[0];
      let current;
      if (status[0] === "R" || status[0] === "C") {
        const [, from, to] = parts;
        current = alias.get(to) || to;
        if (status[0] === "R") alias.set(from, current);
      } else {
        current = alias.get(parts[1]) || parts[1];
      }
      if (!wanted.has(current)) continue;
      let s = stats.get(current);
      if (!s) {
        s = { n: 0, n90: 0, first: t, last: t, lastMsg: subject, authors: new Set() };
        stats.set(current, s);
      }
      s.n++;
      if (now - t < 90 * DAY) s.n90++;
      s.first = Math.min(s.first, t); // the oldest commit seen is where it was created
      s.authors.add(author);
    }
  }

  const files = {};
  for (const [p, s] of stats) {
    files[p] = { n: s.n, n90: s.n90, first: s.first, last: s.last, msg: s.lastMsg, people: s.authors.size };
  }
  return { commits, first, last, people: people.size, files };
}
