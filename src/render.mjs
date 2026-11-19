// Turns scanned data into one self-contained HTML page: Studio G's fonts and tokens, the map's styles,
// the bundled viewer (rebuilt when its sources change) and the data.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viewer = (...p) => path.join(home, "src", "viewer", ...p);

function bundle() {
  const out = path.join(home, "dist", "viewer.js");
  const sources = ["main.js", "city.js", "graph.js", "ai.js", "picker.js"].map((p) => viewer(p)).filter((p) => fs.existsSync(p));
  const stale = !fs.existsSync(out) || sources.some((s) => fs.statSync(s).mtimeMs > fs.statSync(out).mtimeMs);
  if (stale) execFileSync(process.execPath, [path.join(home, "scripts", "build.mjs")], { stdio: "inherit" });
  return fs.readFileSync(out, "utf8");
}

function styles() {
  // The fonts are embedded, so a map works offline.
  const face = (family, file, weight) =>
    `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${fs.readFileSync(viewer("fonts", file)).toString("base64")}) format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`;
  return [
    face("Inter", "Inter-400.woff2", 400),
    face("Inter", "Inter-500.woff2", 500),
    face("Inter", "Inter-600.woff2", 600),
    face("Instrument Serif", "InstrumentSerif-400.woff2", 400),
    fs.readFileSync(viewer("tokens.css"), "utf8"),
    fs.readFileSync(viewer("viewer.css"), "utf8"),
  ].join("\n");
}

// server: false for a file, or { root, browse } when `atlas serve` serves the page (it then has a project picker).
export function renderMap(data, { server = false } = {}) {
  const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
  const fill = {
    title: `${escapeHtml(data.name)} · repo atlas`,
    css: styles(),
    server: json(server),
    data: json(data),
    js: bundle().replace(/<\/script/gi, "<\\/script"),
  };
  // One pass, so a placeholder written inside the mapped code (say, this file's) is never filled.
  return fs.readFileSync(viewer("index.html"), "utf8")
    .replace(/\/\*\{\{(css|js)\}\}\*\/|\{\{(title|server|data)\}\}/g, (_, a, b) => fill[a || b]);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
