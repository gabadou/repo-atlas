// The right panel: what's selected (a file, a folder or a package), and the selection itself.
import { $, ago, day, dirOf, esc, fmt, plural } from "./util.js";

// Files whose role means nothing needs to import them.
const ENTRY = new Set(["Page", "Layout", "API route", "Screen", "Navigation layout", "Special screen", "Test", "Database migration",
  "Database query", "Script", "Config", "Eval", "Server entry", "Endpoint", "Sitemap", "robots.txt", "Not found page",
  "Loading screen", "Error screen", "Styles", "Generated file"]);
const CODE_EXT = /\.(ts|tsx|mts|js|jsx|mjs|cjs|astro|vue|svelte|py|go)$/;

export function createPanel(app) {
  const { data, G, city, N, state, lists } = app;
  const { fileLink, list, fileList } = lists;
  const detail = $("detail");
  const body = detail.querySelector(".body");

  // Hotspots: large files that change often (the top twentieth by lines × changes in 90 days).
  const hotspots = (() => {
    const scored = data.files
      .map((f, i) => [i, f.git ? f.lines * f.git.n90 : 0])
      .filter(([i, s]) => s && data.files[i].lines >= 150 && data.files[i].git.n90 >= 4)
      .sort((a, b) => b[1] - a[1]);
    return new Set(scored.slice(0, Math.max(1, Math.ceil(N * 0.05))).map(([i]) => i));
  })();

  // "Uses 3 files in the repo; used by 27 files in 9 folders." Entry points say what runs them instead.
  const connections = (f, uses, usedBy, folders) => {
    const a = uses ? `Uses ${plural(uses, "file")} in the repo` : "Uses no other file in the repo";
    let b = usedBy ? `used by ${plural(usedBy, "file")}${usedBy > 1 ? ` in ${plural(folders, "folder")}` : ""}` : "nothing imports it";
    if (!usedBy && f.route) b += `: the framework opens it at <code>${esc(f.route)}</code>`;
    else if (!usedBy && f.role === "Test") b += ": the test runner runs it";
    else if (!usedBy && f.role === "Database migration") b += ": it runs once on the database";
    else if (!usedBy && f.role === "Server entry") b += ": the server starts here";
    else if (!usedBy && ["Script", "Eval"].includes(f.role)) b += ": you run it from the command line";
    else if (!usedBy && f.role === "Config") b += ": the tools read it";
    else if (!usedBy && !ENTRY.has(f.role) && CODE_EXT.test(f.path)) b += ": an entry point, or unused";
    return `${a}; ${b}.`;
  };

  const fileHtml = (i) => {
    const f = data.files[i];
    const k = f.path.lastIndexOf("/");
    const byLines = (a, b) => data.files[b].lines - data.files[a].lines;
    const meta = [f.role ? esc(f.role) : null, f.route ? `<span class="route">${esc(f.route)}</span>` : null, `${fmt(f.lines)} lines`]
      .filter(Boolean).join(" · ");
    let html = `<header><p class="kicker">${esc(f.path.slice(0, k + 1) || "/")}</p><h2>${esc(f.path.slice(k + 1))}</h2>` +
      `<p class="meta">${meta}</p></header>`;

    html += app.summary.section(i);

    const ub = G.usedBy[i];
    let conn = `<p class="line">${connections(f, G.uses[i].length, ub.length, new Set(ub.map((x) => dirOf(data.files[x].path))).size)}</p>`;
    if (G.cycleOf[i] >= 0) {
      const c = G.cycles[G.cycleOf[i]].filter((x) => x !== i);
      conn += `<p class="note warn">In an import cycle with ${plural(c.length, "file")}: changing one can break the others.</p>` +
        `<ul class="files">${c.slice(0, 6).map((x) => fileLink(x)).join("")}</ul>`;
    }
    html += `<section><h3>Connections</h3>${conn}</section>`;
    html += fileList("Uses", [...G.uses[i]].sort(byLines), "var(--uses)");
    html += fileList("Is used by", [...ub].sort(byLines), "var(--used-by)");

    const size = hotspots.has(i) ? `<p class="note warn">A hotspot: large and changing often.</p>`
      : f.lines > 600 ? `<p class="note">Long: a candidate to split.</p>` : "";
    if (f.git) {
      const g = f.git;
      html += `<section><h3>History</h3><dl class="facts">` +
        `<dt>Created</dt><dd>${day(g.first)}</dd>` +
        `<dt>Last changed</dt><dd>${ago(g.last)}<span class="msg">${esc(g.msg || "")}</span></dd>` +
        `<dt>Changes</dt><dd>${plural(g.n, "commit")}, ${g.n90 === g.n && g.n > 1 ? "all" : g.n90} in the last 90 days</dd>` +
        `<dt>People</dt><dd>${g.people}</dd></dl>${size}</section>`;
    } else if (size) {
      html += `<section><h3>Size</h3>${size}</section>`;
    }

    if (f.exports?.length) {
      html += `<section><h3>Exports <span class="n">${f.exports.length}</span></h3><p class="chips">` +
        f.exports.map(([name, kind]) => `<span title="${kind}"><i class="k-${kind}"></i>${esc(name)}</span>`).join("") + `</p></section>`;
    }
    if (G.pkgUses[i].length) {
      html += `<section><h3>Packages <span class="n">${G.pkgUses[i].length}</span></h3><p class="chips">` +
        G.pkgUses[i].map((p) => `<button data-pkg="${p}">${esc(data.packages[p])}</button>`).join("") + `</p></section>`;
    }
    return html;
  };

  const dirHtml = (sel) => {
    const inside = (k) => data.files[k].path.startsWith(sel.path + "/");
    const outTo = new Map();
    const inFrom = new Map();
    let internal = 0;
    for (const [a, b] of data.edges) {
      const ia = inside(a);
      const ib = inside(b);
      if (ia && ib) internal++;
      else if (ia) outTo.set(dirOf(data.files[b].path), (outTo.get(dirOf(data.files[b].path)) || 0) + 1);
      else if (ib) inFrom.set(dirOf(data.files[a].path), (inFrom.get(dirOf(data.files[a].path)) || 0) + 1);
    }
    const rows = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([p, n]) => `<li><button data-dir="${esc(p)}"><span class="dir">${esc(p)}/&lrm;</span><span class="n">${n}</span></button></li>`);
    const mostUsed = [];
    for (let k = 0; k < N; k++) if (inside(k)) mostUsed.push(k);
    mostUsed.sort((a, b) => G.usedBy[b].length - G.usedBy[a].length || data.files[b].lines - data.files[a].lines);
    return `<header><p class="kicker">Folder</p><h2>${esc(sel.path)}/</h2>` +
      `<p class="meta">${sel.d.node.count} files · ${fmt(sel.d.node.lines)} lines · ${internal} imports inside</p></header>` +
      list("Reaches out to", rows(outTo), "var(--uses)", "Nothing outside this folder") +
      list("Reached from", rows(inFrom), "var(--used-by)", "Nothing outside this folder imports it") +
      list("Most used here", mostUsed.slice(0, 8).map((x) => fileLink(x, `<span class="n">${G.usedBy[x].length}</span>`)));
  };

  const packageHtml = (p) =>
    `<header><p class="kicker">Package</p><h2>${esc(data.packages[p])}</h2><p class="meta">used by ${G.pkgUsedBy[p].length} files</p></header>` +
    list("Used by", G.pkgUsedBy[p].map((x) => fileLink(x)), "var(--used-by)");

  const render = () => {
    const sel = state.selected;
    if (!sel) {
      detail.hidden = true;
    } else {
      body.innerHTML = sel.kind === "file" ? fileHtml(sel.i) : sel.kind === "dir" ? dirHtml(sel) : packageHtml(sel.i);
      detail.hidden = false;
      body.scrollTop = 0;
      detail.scrollTop = 0;
    }
    app.sheets?.detail(!!sel);
    app.view.resize();
  };

  const same = (a, b) => a && b && a.kind === b.kind && a.i === b.i && a.path === b.path;
  const select = (sel, fly) => {
    if (same(sel, state.selected)) {
      if (fly && sel.kind === "file") app.nav.frameFile(sel.i);
      if (fly && sel.kind === "dir") app.nav.frameDir(sel.d);
      return;
    }
    state.selected = sel;
    app.painter.paint();
    render();
    if (fly && sel?.kind === "file") app.nav.frameFile(sel.i);
    if (fly && sel?.kind === "dir") app.nav.frameDir(sel.d);
  };
  const selectFile = (i) => select({ kind: "file", i }, true);
  const selectDir = (path) => {
    const d = city.districts.find((x) => x.path === path);
    if (d) select({ kind: "dir", path, d }, true);
  };

  $("close").addEventListener("click", () => select(null));
  // Every file, folder and package link in either panel.
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.file) selectFile(+b.dataset.file);
    else if (b.dataset.dir) selectDir(b.dataset.dir);
    else if (b.dataset.pkg) select({ kind: "package", i: +b.dataset.pkg }, false);
  });

  return { select, selectFile, selectDir, render };
}
