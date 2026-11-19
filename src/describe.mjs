// What a file is for, read from the code itself: its opening comment, what the repo's docs say about it,
// its role (page, component, test…) from common conventions, and what it exports. No AI, nothing guessed:
// when a file says nothing about itself, these stay empty.
import path from "node:path";

const MAX_ABOUT = 420;

// ---------- Opening comment ----------------------------------------------

const TOOLING = /^(eslint|prettier|@ts-|ts-|istanbul|c8 |biome|jshint|global |noinspection|#region|region|endregion|@flow|@jsx|@vitest|@jest|copyright|license|spdx|generated|auto-?generated|do not edit)/i;

// The first paragraph of the first full-line comment block near the top of the file.
export function openingComment(text, ext) {
  const lines = text.split("\n").slice(0, 60);
  const style = commentStyle(ext);
  if (!style) return null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (i === 0 && t.startsWith("#!")) continue;
    const block = readBlock(lines, i, style);
    if (block) {
      const about = clean(block.text);
      if (about && about.length >= 12 && !TOOLING.test(about)) return about;
      i = block.end;
      continue;
    }
    // Code before the comment is fine (imports, a directive, a metadata export): keep looking near the top.
    if (i > 45) break;
  }
  return null;
}

function commentStyle(ext) {
  if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".astro", ".vue", ".svelte", ".go", ".rs", ".java", ".kt", ".swift", ".cs", ".php", ".css", ".scss", ".less", ".sass"].includes(ext)) return "c";
  if ([".py", ".rb", ".sh", ".yaml", ".yml", ".toml"].includes(ext)) return "hash";
  if (ext === ".sql") return "sql";
  if ([".html", ".md", ".mdx", ".svg"].includes(ext)) return "html";
  return null;
}

// A comment starting at line i, at the start of the line. Returns its text (first paragraph) and last line.
function readBlock(lines, i, style) {
  const line = lines[i];
  const lead = (re) => re.test(line);
  const take = (re, strip) => {
    const out = [];
    let j = i;
    while (j < lines.length && re.test(lines[j])) {
      const s = lines[j].replace(strip, "").trim().replace(/^[-*•]\s+/, "· ");
      if (!s && out.length) break; // a blank comment line ends the first paragraph
      if (s) out.push(s);
      j++;
    }
    while (j < lines.length && re.test(lines[j])) j++;
    return { text: out.join(" "), end: j - 1 };
  };
  const block = (open, close, strip) => {
    let j = i;
    const out = [];
    let first = line.slice(line.indexOf(open) + open.length);
    let done = false;
    for (let s = first; j < lines.length; s = lines[++j]) {
      let part = s;
      if (part.includes(close)) { part = part.slice(0, part.indexOf(close)); done = true; }
      part = part.replace(strip, "").trim();
      if (part.startsWith("@")) { if (done) break; continue; } // JSDoc tags
      if (!part && out.length) { while (!done && j < lines.length && !lines[j].includes(close)) j++; break; }
      if (part) out.push(part);
      if (done) break;
    }
    return { text: out.join(" "), end: j };
  };
  if (style === "c") {
    if (lead(/^\/\//)) return take(/^\/\//, /^\/\/+!?/);
    if (lead(/^\/\*/)) return block("/*", "*/", /^\s*\*+\s?|^\*+\s?/);
    if (lead(/^\s*<!--/)) return block("<!--", "-->", /^\s*/);
  } else if (style === "hash") {
    if (lead(/^#(?!!)/)) return take(/^#(?!!)/, /^#+/);
    if (lead(/^("""|''')/)) {
      const q = line.trim().slice(0, 3);
      const rest = line.trim().slice(3);
      if (rest.includes(q)) return { text: rest.slice(0, rest.indexOf(q)), end: i };
      return block(q, q, /^\s*/);
    }
  } else if (style === "sql") {
    if (lead(/^--/)) return take(/^--/, /^--+/);
    if (lead(/^\/\*/)) return block("/*", "*/", /^\s*\*+\s?/);
  } else if (style === "html") {
    if (lead(/^\s*<!--/)) return block("<!--", "-->", /^\s*/);
  }
  return null;
}

function clean(s) {
  s = s.replace(/\s+/g, " ").replace(/^[-=*#~_ ]+$/, "").trim();
  if (!/[a-z]{3,}/i.test(s)) return null;
  if (s.length > MAX_ABOUT) {
    const cut = s.slice(0, MAX_ABOUT);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
    s = (end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")) + " …";
  }
  return s;
}

// ---------- What the docs say --------------------------------------------

const DOC_NAMES = /^(readme|claude|agents|architecture|contributing|design|overview)\.md$/i;

export function isDocFile(p) {
  const base = p.slice(p.lastIndexOf("/") + 1);
  return DOC_NAMES.test(base) || /(^|\/)docs?\/[^/]+\.md$/i.test(p);
}

// For each file, the sentences in the repo's docs that name it (by path, or by name in backticks when that name is
// unique in the repo). Returns Map(path -> [{ doc, text }]).
export function docMentions(files, docs) {
  const byBase = new Map();
  for (const p of files) {
    const b = p.slice(p.lastIndexOf("/") + 1);
    byBase.set(b, (byBase.get(b) || 0) + 1);
  }
  const out = new Map();
  for (const { path: doc, text } of docs) {
    const dir = path.posix.dirname(doc) === "." ? "" : path.posix.dirname(doc) + "/";
    const lines = text.split("\n");
    for (const p of files) {
      const base = p.slice(p.lastIndexOf("/") + 1);
      const stem = p.replace(/\.[^./]+$/, "");
      const names = [p];
      if (dir && p.startsWith(dir)) names.push(p.slice(dir.length));
      if (byBase.get(base) === 1 && !/^index\./.test(base)) names.push("`" + base + "`");
      if (/\.(ts|tsx|js|mjs)$/.test(p) && stem.includes("/")) names.push(stem + "`"); // `src/lib/seo` written without extension
      let found = 0;
      for (let li = 0; li < lines.length && found < 3; li++) {
        const line = lines[li];
        const hit = names.find((n) => hasName(line, n));
        if (!hit) continue;
        const sentence = sentenceAround(line, line.indexOf(hit.replace(/`$/, "")));
        if (!sentence || sentence.length < 16) continue;
        const list = out.get(p) || [];
        if (list.some((x) => x.text === sentence)) continue;
        list.push({ doc, text: sentence });
        out.set(p, list);
        found++;
      }
    }
  }
  return out;
}

function hasName(line, name) {
  let i = line.indexOf(name);
  while (i >= 0) {
    const before = line[i - 1];
    const after = line[i + name.length];
    // Not part of a longer path or name.
    if ((!before || !/[\w./-]/.test(before) || name.startsWith("`")) && (!after || !/[\w/-]/.test(after) || after === ".")) {
      if (!(after === "." && /\w/.test(line[i + name.length + 1] || ""))) return true;
    }
    i = line.indexOf(name, i + 1);
  }
  return false;
}

// The sentence of a Markdown line that contains position i, without list markers or bold.
function sentenceAround(line, i) {
  const md = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").replace(/^#+\s*/, "").replace(/^\|/, "");
  const shift = line.length - md.length;
  i = Math.max(0, i - shift);
  const boundary = /(?<=[.!?;])\s+(?=[A-Z`(*"])|\s+\|\s+/g;
  let start = 0;
  let end = md.length;
  for (const m of md.matchAll(boundary)) {
    if (m.index < i) start = m.index + m[0].length;
    else { end = m.index; break; }
  }
  let s = md.slice(start, end).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (s.length > 360) {
    const a = Math.max(0, i - start - 170);
    s = (a ? "… " : "") + s.slice(a, a + 340).trim() + " …";
  }
  return s;
}

// ---------- Role, from conventions ---------------------------------------

// Folders that are route trees: Next.js app/ (has page or layout files), Expo Router app/ (has _layout),
// pages/ (Astro, Next.js pages router).
export function routeRoots(files) {
  const roots = new Map();
  for (const p of files) {
    const m = p.match(/^((?:[^/]+\/)*?app)\/(?:.*\/)?(page|layout)\.(tsx|jsx|ts|js|mdx)$/);
    if (m) roots.set(m[1], "next");
  }
  for (const p of files) {
    const m = p.match(/^((?:[^/]+\/)*?app)\/_layout\.(tsx|jsx|ts|js)$/);
    if (m && !roots.has(m[1])) roots.set(m[1], "expo");
  }
  for (const p of files) {
    const m = p.match(/^((?:[^/]+\/)?(?:src\/)?pages)\/.+\.(astro|tsx|jsx|ts|js|md|mdx)$/);
    if (m && !roots.has(m[1])) roots.set(m[1], "pages");
  }
  return roots;
}

export function roleOf(p, text, roots) {
  const base = p.slice(p.lastIndexOf("/") + 1);
  const ext = path.posix.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length);
  const dirs = p.split("/").slice(0, -1);
  const inDir = (...names) => dirs.some((d) => names.includes(d.toLowerCase()));

  for (const [root, kind] of roots) {
    if (!p.startsWith(root + "/")) continue;
    const rel = p.slice(root.length + 1);
    const route = (r) => "/" + r.split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/").replace(/\/?index$/, "").replace(/\/$/, "");
    if (kind === "next") {
      const relDir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const at = route(relDir);
      if (stem === "page") return { role: "Page", route: at || "/" };
      if (stem === "layout") return { role: "Layout", route: at || "/" };
      if (stem === "route") return { role: "API route", route: at || "/" };
      if (stem === "loading") return { role: "Loading screen", route: at || "/" };
      if (stem === "error" || stem === "global-error") return { role: "Error screen", route: at || "/" };
      if (stem === "not-found") return { role: "Not found page" };
      if (stem === "sitemap") return { role: "Sitemap", route: "/sitemap.xml" };
      if (stem === "robots") return { role: "robots.txt", route: "/robots.txt" };
      if (/\.(json|xml|txt)$/.test(relDir)) return { role: "Generated file", route: route(relDir) };
    } else if (kind === "expo" && /\.(tsx|jsx|ts|js)$/.test(ext)) {
      const r = rel.slice(0, -ext.length);
      if (stem === "_layout") return { role: "Navigation layout", route: route(r.replace(/_layout$/, "")) || "/" };
      if (stem.startsWith("+")) return { role: "Special screen" };
      return { role: "Screen", route: route(r) || "/" };
    } else if (kind === "pages") {
      const r = rel.slice(0, -ext.length);
      if (rel.startsWith("api/")) return { role: "API route", route: route(r) };
      if ([".ts", ".js"].includes(ext)) return { role: "Endpoint", route: route(r).replace(/\.(\w+)$/, ".$1") || "/" };
      return { role: "Page", route: route(r) || "/" };
    }
  }

  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base) || inDir("test", "tests", "__tests__", "spec", "e2e") || /^test_.*\.py$|_test\.(py|go)$/.test(base)) return { role: "Test" };
  if (ext === ".sql" && inDir("migrations", "migration", "migrate")) return { role: "Database migration" };
  if (ext === ".sql") return { role: "Database query" };
  if (inDir("evals", "eval")) return { role: "Eval" };
  if (/\.config\.[cm]?[jt]s$|^(tsconfig|jsconfig|package|wrangler|app|vercel|netlify)\.json$|^wrangler\.(toml|jsonc)$|^\.?eslintrc|^babel\.config|^metro\.config/.test(base)) return { role: "Config" };
  if (ext === ".sh" || inDir("scripts", "bin", "tools")) return { role: "Script" };
  if (/\bexport\s+default\s*\{[\s\S]{0,4000}?\basync\s+fetch\s*\(|\bexport\s+default\s*\{[\s\S]{0,4000}?\bfetch\s*:/.test(text || "") || /addEventListener\(\s*["']fetch["']/.test(text || "")) return { role: "Server entry", note: "handles requests" };
  if (base === "index.ts" && inDir("api", "server", "worker")) return { role: "Server entry" };
  if (inDir("layouts") && [".astro", ".tsx", ".jsx", ".vue", ".svelte"].includes(ext)) return { role: "Layout" };
  if (inDir("hooks") || /^use[A-Z-]/.test(stem)) return { role: "Hook" };
  if ([".css", ".scss", ".sass", ".less"].includes(ext)) return { role: "Styles" };
  if (inDir("i18n", "locales", "lang", "translations")) return { role: "Translations" };
  if (stem === "types" || base.endsWith(".d.ts") || /^types?$/.test(dirs.at(-1) || "")) return { role: "Types" };
  if (inDir("components", "ui", "views", "widgets") && [".astro", ".tsx", ".jsx", ".vue", ".svelte"].includes(ext)) return { role: "Component" };
  if ([".vue", ".svelte"].includes(ext)) return { role: "Component" };
  if (ext === ".astro") return { role: "Component" };
  if (inDir("constants", "config")) return { role: "Settings" };
  if (inDir("content", "data") || [".json", ".md", ".yaml", ".yml"].includes(ext)) return { role: "Data" };
  if (inDir("lib", "utils", "util", "helpers", "shared", "common")) return { role: "Library" };
  return null;
}

// ---------- Exports ------------------------------------------------------

export function exportsOf(text, ext) {
  const out = new Map();
  const add = (name, kind) => { if (name && !out.has(name)) out.set(name, kind); };
  if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".astro", ".vue", ".svelte"].includes(ext)) {
    const src = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const jsx = /x$/.test(ext);
    for (const m of src.matchAll(/^export\s+(default\s+)?(?:declare\s+)?(async\s+)?(function\*?|class|const|let|var|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const [, , , kw, name] = m;
      let kind = /class/.test(kw) ? "class" : kw === "type" || kw === "interface" ? "type" : kw === "enum" ? "enum" : kw.startsWith("function") ? "function" : "value";
      if ((kind === "function" || kind === "value") && jsx && /^[A-Z]/.test(name)) kind = "component";
      else if (kind === "value") {
        const line = src.slice(m.index, (src.indexOf("\n", m.index) + 1 || src.length + 1) - 1);
        if (/=\s*(async\s+)?(\(|[\w$]+\s*=>|function\b)/.test(line)) kind = jsx && /^[A-Z]/.test(name) ? "component" : "function";
      }
      add(name, kind);
    }
    for (const m of src.matchAll(/^export\s+(type\s+)?\{([^}]*)\}/gm)) {
      for (const part of m[2].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, "").trim();
        if (!name || !/^[\w$]+$/.test(name)) continue;
        if (m[1] || /^type\s/.test(part.trim())) { add(name, "type"); continue; }
        // `export { Name }`: the kind of the local declaration it names.
        const local = part.trim().split(/\s+as\s+/)[0];
        const decl = src.match(new RegExp(`^(?:async\\s+)?(function|class|const|let|var|type|interface|enum)\\s+${local.replace(/\$/g, "\\$")}\\b`, "m"));
        const kw = decl?.[1];
        add(name, kw === "class" ? "class" : kw === "function" ? (jsx && /^[A-Z]/.test(name) ? "component" : "function") : kw === "type" || kw === "interface" ? "type" : kw === "enum" ? "enum" : "value");
      }
    }
    if (/^export\s+default\b(?!\s+(async\s+)?(function|class)\s+[\w$])/m.test(src)) add("default", "default");
  } else if (ext === ".py") {
    for (const m of text.matchAll(/^(def|class|async def)\s+([A-Za-z]\w*)/gm)) if (!m[2].startsWith("_")) add(m[2], m[1] === "class" ? "class" : "function");
  } else if (ext === ".go") {
    for (const m of text.matchAll(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)|^type\s+([A-Z]\w*)/gm)) add(m[1] || m[2], m[1] ? "function" : "type");
  }
  return [...out.entries()].slice(0, 40);
}
