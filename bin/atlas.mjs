#!/usr/bin/env node
// repo-atlas: a 3D map of a repo's architecture.
//   atlas serve [folder]   a local server with a project picker (the folders of [folder])
//   atlas <repo>           one map, written as a self-contained HTML file
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { scan } from "../src/scan.mjs";
import { renderMap } from "../src/render.mjs";
import { serve } from "../src/serve.mjs";

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const values = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const positional = args.filter((a, i) => !a.startsWith("-") && !["--out", "--ignore", "--port", "--back", "--back-label"].includes(args[i - 1]));

if (flag("-h") || flag("--help") || !args.length) {
  console.log(`Usage:
  atlas serve [folder]   open the map in your browser, with a picker for the projects in [folder]
                         (default: the folder repo-atlas sits in, e.g. ~/Code)
  atlas <repo>           write one map as a self-contained HTML file

Options:
  --open           open the browser
  --port <n>       serve: the port (default 4317)
  --out <file>     <repo>: where to write the map (default: maps/<repo>.html in repo-atlas)
  --all            also show data and docs files nothing imports (.md, .json, …)
  --no-source      leave the code out of the map (it's there for the optional AI summaries)
  --public         <repo>: structure only, for a map anyone may see (no code, comments, doc quotes,
                   exports or commit messages)
  --back <url>     <repo>: a link back at the top of the map (with --back-label "Back to the site")
  --json           <repo>: write the scanned graph as JSON instead of a map
  --ignore <dir>   <repo>: leave a folder out (repeatable), e.g. --ignore docs/`);
  process.exit(args.length ? 0 : 1);
}

if (positional[0] === "serve") {
  const root = path.resolve(positional[1] || path.dirname(home));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`Not a folder: ${root}`);
    process.exit(1);
  }
  serve({ root, port: +(value("--port") || 4317), open: flag("--open"), source: !flag("--no-source") });
} else {
  const repo = path.resolve(positional[0]);
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
    console.error(`Not a folder: ${repo}`);
    process.exit(1);
  }
  const t0 = Date.now();
  const data = scan(repo, { ignore: values("--ignore"), all: flag("--all"), source: !flag("--no-source"), publicMode: flag("--public") });
  if (value("--back")) data.back = { href: value("--back"), label: value("--back-label") || "Back" };
  const lines = data.files.reduce((s, f) => s + f.lines, 0);
  console.log(
    `${data.name}: ${data.files.length} files, ${lines.toLocaleString("en")} lines, ` +
    `${data.edges.length} imports between files, ${data.packages.length} packages` +
    (data.unresolved ? `, ${data.unresolved} imports not found` : "") +
    ` (${Date.now() - t0} ms)`,
  );
  const out = path.resolve(value("--out") || path.join(home, "maps", `${data.name}.${flag("--json") ? "json" : "html"}`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, flag("--json") ? JSON.stringify(data) : renderMap(data));
  console.log(`Wrote ${out}` + (flag("--json") || flag("--no-source") || flag("--public") ? "" : " (it holds the code, for the optional AI summaries: --no-source leaves it out)"));
  if (flag("--open") && !flag("--json")) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try { execFileSync(opener, [out], { stdio: "ignore" }); } catch {}
  }
}
