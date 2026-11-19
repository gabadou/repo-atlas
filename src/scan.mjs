// Reads a repo: which files there are, how long they are, and what imports what.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { docMentions, exportsOf, isDocFile, openingComment, roleOf, routeRoots } from "./describe.mjs";
import { history } from "./history.mjs";

// Files that become buildings.
const CODE = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".astro", ".vue", ".svelte", ".mdx",
  ".css", ".scss", ".sass", ".less",
  ".py", ".go", ".rs", ".rb", ".java", ".kt", ".swift", ".php", ".cs",
  ".sql", ".sh",
]);
// Files that become buildings only when some code imports them.
const DATA = new Set([".json", ".md", ".yaml", ".yml", ".toml", ".txt", ".html", ".svg"]);

const MAX_SOURCE_FILE = 24_000; // characters of code per file kept for AI summaries
const MAX_SOURCE_TOTAL = 12_000_000;

// Folders that are generated or vendored.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".astro", ".expo",
  ".turbo", ".vercel", ".wrangler", ".svelte-kit", "coverage", "vendor",
  "__pycache__", ".venv", "venv", "target", "Pods", "ios", "android", ".cache",
]);

const RESOLVE_EXTS = [
  ".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".astro", ".vue",
  ".svelte", ".mdx", ".json", ".css", ".scss", ".d.ts",
];

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

export function scan(root, { ignore = [], all: includeAll = false, source = true } = {}) {
  root = path.resolve(root);
  const all = listFiles(root).filter((p) => {
    const parts = p.split("/");
    if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d))) return false;
    if (/\.min\.(js|css)$/.test(p) || /\.d\.ts$/.test(p) && p.includes("generated")) return false;
    return !ignore.some((g) => p.startsWith(g.replace(/\/?\*.*$/, "")));
  });
  const known = new Set(all);
  const candidates = all.filter((p) => CODE.has(ext(p)) || DATA.has(ext(p)));

  const tsconfigs = new Map(); // dir -> alias rules (or null)
  const files = new Map(); // path -> { path, ext, lines, imports: Set, packages: Set }
  const read = (p) => {
    try {
      const buf = fs.readFileSync(path.join(root, p));
      if (buf.length > 2_000_000 || buf.includes(0)) return null;
      return buf.toString("utf8");
    } catch {
      return null;
    }
  };

  let unresolved = 0;
  for (const p of candidates) {
    if (!CODE.has(ext(p))) continue;
    const text = read(p);
    if (text == null) continue;
    const f = { path: p, ext: ext(p), lines: countLines(text), text, imports: new Set(), packages: new Set() };
    files.set(p, f);
    for (const spec of extractImports(p, text)) {
      const r = resolve(spec, p, { root, known, tsconfigs });
      if (r.file && r.file !== p) f.imports.add(r.file);
      else if (r.pkg) f.packages.add(r.pkg);
      else if (!r.file && !r.skip) {
        unresolved++;
        if (process.env.ATLAS_DEBUG) console.error(`not found: ${p} -> ${typeof spec === "string" ? spec : JSON.stringify(spec)}`);
      }
    }
  }

  // Data files join the map only when imported (or with --all).
  if (includeAll) {
    for (const p of candidates) {
      if (files.has(p)) continue;
      const text = read(p);
      if (text != null) files.set(p, { path: p, ext: ext(p), lines: countLines(text), text, imports: new Set(), packages: new Set() });
    }
  }
  for (const f of [...files.values()]) {
    for (const t of f.imports) {
      if (!files.has(t)) {
        const text = read(t);
        files.set(t, { path: t, ext: ext(t), lines: text ? countLines(text) : 1, text: text || "", imports: new Set(), packages: new Set() });
      }
    }
  }

  const list = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  const index = new Map(list.map((f, i) => [f.path, i]));
  const pkgCount = new Map();
  for (const f of list) for (const k of f.packages) pkgCount.set(k, (pkgCount.get(k) || 0) + 1);
  const packages = [...pkgCount.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const pkgIndex = new Map(packages.map((n, i) => [n, i]));

  const edges = [];
  const packageEdges = [];
  for (const f of list) {
    const i = index.get(f.path);
    for (const t of f.imports) edges.push([i, index.get(t)]);
    for (const k of f.packages) packageEdges.push([i, pkgIndex.get(k)]);
  }

  // What each file is for: its own comment, the docs, conventions, exports, and git history.
  const docs = candidates.filter(isDocFile).map((p) => ({ path: p, text: read(p) || "" }));
  const mentions = docMentions(list.map((f) => f.path), docs);
  const roots = routeRoots(list.map((f) => f.path));
  const git = history(root, list.map((f) => f.path));
  // Each file's code goes into the map for the optional AI summaries (capped per file and in total).
  let sourceLeft = source ? MAX_SOURCE_TOTAL : 0;
  const describe = (f) => {
    const out = { path: f.path, lines: f.lines };
    if (sourceLeft > 0 && CODE.has(f.ext)) {
      const code = f.text.slice(0, Math.min(MAX_SOURCE_FILE, sourceLeft));
      out.source = code;
      if (code.length < f.text.length) out.cut = true;
      sourceLeft -= code.length;
    }
    const about = openingComment(f.text, f.ext);
    if (about) out.about = about;
    const role = roleOf(f.path, f.text, roots);
    if (role) Object.assign(out, role);
    const ex = exportsOf(f.text, f.ext);
    if (ex.length) out.exports = ex;
    const d = mentions.get(f.path);
    if (d) out.docs = d;
    if (git?.files[f.path]) out.git = git.files[f.path];
    return out;
  };

  return {
    name: path.basename(root),
    generatedAt: new Date().toISOString(),
    commit: gitHead(root),
    history: git ? { commits: git.commits, first: git.first, last: git.last, people: git.people } : null,
    files: list.map(describe),
    edges,
    packages,
    packageEdges,
    unresolved,
  };
}

function listFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    const files = out.toString("utf8").split("\0").filter(Boolean);
    if (files.length) return files.filter((p) => fs.existsSync(path.join(root, p)));
  } catch {}
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(rel);
      } else if (e.isFile()) files.push(rel);
    }
  };
  walk("");
  return files;
}

function gitHead(root) {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
  } catch {
    return null;
  }
}

const ext = (p) => {
  const b = p.slice(p.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
};

const countLines = (text) => text.split("\n").filter((l) => l.trim()).length || 1;

// --- Imports -------------------------------------------------------------

const JS_STATIC = /(?:^|[;\s}])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]*?\s+from\s+)?["']([^"'\n]+)["']/g;
const JS_DYNAMIC = /\b(?:import|require)\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
const CSS_IMPORT = /@(?:import|use|forward)\s+(?:url\()?\s*["']([^"'\n]+)["']/g;
const PY_FROM = /^\s*from\s+(\.*[\w.]*)\s+import\s+/gm;
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm;
const GO_IMPORT = /^\s*(?:import\s+)?(?:\w+\s+)?"([\w./-]+)"\s*$/gm;

function extractImports(p, text) {
  const e = ext(p);
  const specs = [];
  const all = (re, src = text) => { for (const m of src.matchAll(re)) specs.push(m[1]); };
  if ([".css", ".scss", ".sass", ".less"].includes(e)) {
    all(CSS_IMPORT);
  } else if (e === ".py") {
    for (const m of text.matchAll(PY_FROM)) specs.push({ py: m[1] });
    for (const m of text.matchAll(PY_IMPORT)) for (const s of m[1].split(",")) specs.push({ py: s.trim() });
  } else if (e === ".go") {
    const block = text.match(/import\s*\(([\s\S]*?)\)/g) || [];
    for (const b of block) all(GO_IMPORT, b);
    for (const m of text.matchAll(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm)) specs.push(m[1]);
    return specs.map((s) => ({ go: s }));
  } else if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".astro", ".vue", ".svelte", ".mdx"].includes(e)) {
    const src = stripComments(text);
    all(JS_STATIC, src);
    all(JS_DYNAMIC, src);
    if ([".astro", ".vue", ".svelte"].includes(e)) all(CSS_IMPORT, src);
  }
  return specs;
}

// Drops block comments and whole-line // comments (keeps "https://" in strings).
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// --- Resolution ----------------------------------------------------------

function resolve(spec, from, ctx) {
  if (typeof spec === "object" && spec.py != null) return resolvePy(spec.py, from, ctx);
  if (typeof spec === "object" && spec.go != null) return resolveGo(spec.go, ctx);
  spec = spec.replace(/[?#].*$/, "");
  if (!spec || /^(https?:|data:|virtual:)/.test(spec)) return { skip: true };
  if (/^astro:/.test(spec)) return { pkg: "astro" };
  const dir = path.posix.dirname(from);

  if (spec.startsWith(".") || spec.startsWith("/")) {
    const base = path.posix.normalize(spec.startsWith("/") ? spec.slice(1) : path.posix.join(dir, spec));
    // Reaching outside the repo (a sibling project): shown as a package.
    if (base.startsWith("../")) return { pkg: base.replace(/^(\.\.\/)+/, "../").split("/").slice(0, 2).join("/") };
    return { file: tryFile(base, ctx.known) };
  }
  for (const target of aliasTargets(spec, dir, ctx)) {
    const f = tryFile(target, ctx.known);
    if (f) return { file: f };
  }
  if (spec.startsWith("~/") || spec.startsWith("@/")) return {};
  return { pkg: packageName(spec) };
}

function tryFile(base, known) {
  base = path.posix.normalize(base).replace(/^\.\//, "");
  if (base.startsWith("..")) return null;
  const tries = [base];
  const m = base.match(/\.(m?js|cjs|jsx)$/); // TS ESM: "./x.js" is "./x.ts"
  if (m) {
    const stem = base.slice(0, -m[0].length);
    tries.push(stem + ".ts", stem + ".tsx", stem + ".mts");
  }
  for (const e of RESOLVE_EXTS) tries.push(base + e);
  for (const e of RESOLVE_EXTS) tries.push(`${base}/index${e}`);
  return tries.find((t) => known.has(t)) || null;
}

function packageName(spec) {
  if (spec.startsWith("node:") || BUILTINS.has(spec.split("/")[0])) return "node";
  if (spec.startsWith("bun:")) return "bun";
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// tsconfig/jsconfig "paths", found from the nearest config up to the root.
function aliasTargets(spec, dir, ctx) {
  const rules = nearestAliases(dir, ctx);
  const out = [];
  for (const { pattern, targets, base } of rules) {
    if (pattern.endsWith("*")) {
      const pre = pattern.slice(0, -1);
      if (spec.startsWith(pre)) {
        const rest = spec.slice(pre.length);
        for (const t of targets) out.push(path.posix.join(base, t.replace("*", rest)));
      }
    } else if (spec === pattern) {
      for (const t of targets) out.push(path.posix.join(base, t));
    }
  }
  // Common fallbacks when no config says otherwise.
  if (!rules.length && (spec.startsWith("@/") || spec.startsWith("~/"))) out.push(`src/${spec.slice(2)}`, spec.slice(2));
  return out;
}

function nearestAliases(dir, ctx) {
  let d = dir;
  while (true) {
    const key = d === "." ? "" : d;
    if (!ctx.tsconfigs.has(key)) ctx.tsconfigs.set(key, readAliases(key, ctx));
    const rules = ctx.tsconfigs.get(key);
    if (rules) return rules;
    if (!key) return [];
    d = path.posix.dirname(key);
  }
}

function readAliases(dir, ctx) {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const rel = dir ? `${dir}/${name}` : name;
    const abs = path.join(ctx.root, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const json = JSON.parse(jsonc(fs.readFileSync(abs, "utf8")));
      const co = json.compilerOptions || {};
      const base = path.posix.join(dir || ".", co.baseUrl || ".");
      const paths = co.paths || {};
      const rules = Object.entries(paths).map(([pattern, targets]) => ({ pattern, targets, base }));
      // Longest prefix first, like TypeScript.
      rules.sort((a, b) => b.pattern.length - a.pattern.length);
      return rules;
    } catch {
      return [];
    }
  }
  return null;
}

// JSON with comments and trailing commas (tsconfig), leaving strings like "**/*.ts" alone.
function jsonc(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j;
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && s[i + 1] === "*") {
      i = s.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function resolvePy(mod, from, ctx) {
  let base;
  if (mod.startsWith(".")) {
    const dots = mod.match(/^\.+/)[0].length;
    let dir = path.posix.dirname(from);
    for (let i = 1; i < dots; i++) dir = path.posix.dirname(dir);
    base = path.posix.join(dir, mod.slice(dots).replace(/\./g, "/"));
  } else {
    base = mod.replace(/\./g, "/");
  }
  for (const root of ["", "src/"]) {
    for (const t of [`${root}${base}.py`, `${root}${base}/__init__.py`]) {
      if (ctx.known.has(path.posix.normalize(t))) return { file: path.posix.normalize(t) };
    }
  }
  if (mod.startsWith(".")) return {};
  return { pkg: mod.split(".")[0] };
}

function resolveGo(spec, ctx) {
  // Points at the package's first file when the import is inside this module.
  if (!ctx.goModule) {
    try {
      ctx.goModule = fs.readFileSync(path.join(ctx.root, "go.mod"), "utf8").match(/^module\s+(\S+)/m)?.[1] || "";
    } catch {
      ctx.goModule = "";
    }
  }
  if (ctx.goModule && spec.startsWith(ctx.goModule + "/")) {
    const dir = spec.slice(ctx.goModule.length + 1) + "/";
    const f = [...ctx.known].find((k) => k.startsWith(dir) && k.endsWith(".go") && !k.slice(dir.length).includes("/") && !k.endsWith("_test.go"));
    if (f) return { file: f };
  }
  return { pkg: spec.includes(".") ? spec.split("/").slice(0, 3).join("/") : "go std" };
}
