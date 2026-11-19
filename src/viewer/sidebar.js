// The left panel: the repo's name and figures, search, colour mode, what's shown, insights; plus the
// bottom bar's Reset view, the theme switch, the link back (--back) and the keyboard shortcuts.
import { isDark } from "./colours.js";
import { $, esc, extOf, fmt, plural, typing } from "./util.js";

export function createSidebar(app) {
  const { data, G, N, state, lists, palette } = app;
  const { fileLink, list } = lists;

  // A way back to the page that linked here (Studio G's "Look inside").
  if (data.back?.href) {
    const back = $("back");
    back.href = data.back.href;
    back.textContent = `${data.back.label || "Back"} →`;
    back.hidden = false;
  }

  // Name and figures.
  $("repo").textContent = data.name;
  $("meta").textContent = data.history
    ? `${plural(data.history.commits, "commit")} · ${plural(data.history.people, "person", "people")} · since ` +
      new Date(data.history.first * 1000).toLocaleDateString("en-GB", { month: "short", year: "numeric" })
    : [data.commit, new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })].filter(Boolean).join(" · ");
  const totalLines = data.files.reduce((s, f) => s + f.lines, 0);
  $("stats").innerHTML = [[fmt(N), "files"], [fmt(totalLines), "lines"], [fmt(data.edges.length), "imports"], [fmt(data.packages.length), "packages"]]
    .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");

  // Insights: most used, largest, changing most, cycles.
  const ids = [...Array(N).keys()];
  const hubs = ids.filter((i) => G.usedBy[i].length).sort((a, b) => G.usedBy[b].length - G.usedBy[a].length).slice(0, 6);
  const big = [...ids].sort((a, b) => data.files[b].lines - data.files[a].lines).slice(0, 5);
  const moving = ids.filter((i) => data.files[i].git?.n90).sort((a, b) => data.files[b].git.n90 - data.files[a].git.n90).slice(0, 5);
  $("insights").innerHTML =
    list("Most used", hubs.map((i) => fileLink(i, `<span class="n">${G.usedBy[i].length}</span>`)), null, "No imports found") +
    list("Largest", big.map((i) => fileLink(i, `<span class="n">${fmt(data.files[i].lines)}</span>`))) +
    (moving.length ? list("Changed most in 90 days", moving.map((i) => fileLink(i, `<span class="n">${data.files[i].git.n90}</span>`))) : "") +
    `<section class="${G.cycles.length ? "warn" : ""}"><h3>Import cycles <span class="n">${G.cycles.length}</span></h3>` +
    (G.cycles.length
      ? `<ul class="files">${G.cycles.slice(0, 6).map((c) => fileLink(c[0], `<span class="n">${c.length} files</span>`)).join("")}</ul>`
      : `<p class="muted">None</p>`) + `</section>`;

  // The legend for the colour mode.
  const renderLegend = () => {
    let items = [];
    if (state.mode === "area") {
      items = palette.areas.slice(0, 10).map((a) =>
        `<li><button data-dir="${esc(a.path)}"><i style="background:#${palette.areaColor(a).getHexString()}"></i>${esc(a.name)}</button></li>`);
      if (data.files.some((f) => !palette.areaOf(f.path))) items.push(`<li><span><i style="background:#${app.C.other.getHexString()}"></i>other files</span></li>`);
    } else if (state.mode === "type") {
      const seen = new Map();
      data.files.forEach((f) => seen.set(extOf(f.path), (seen.get(extOf(f.path)) || 0) + 1));
      items = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([e, n]) => `<li><span><i style="background:#${palette.typeColor(e).getHexString()}"></i>${esc(e || "other")} <span class="n">${n}</span></span></li>`);
    } else {
      items = [`<li class="ramp"><span>0</span><i></i><span>${palette.maxFanIn} files import it</span></li>`];
    }
    $("legend").innerHTML = items.join("");
  };
  renderLegend();

  document.querySelectorAll("#colour button").forEach((b) => b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll("#colour button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    app.painter.recolour();
    renderLegend();
    app.painter.paint();
  }));
  for (const key of ["lines", "packages", "labels"]) {
    $(`show-${key}`).addEventListener("change", (ev) => { state[key] = ev.target.checked; app.painter.paint(); });
  }
  $("home").addEventListener("click", () => { app.panel.select(null); app.nav.home(); });

  // Light / After hours: the Eclipse switch overrides the system and is remembered (same key as Studio G's sites).
  $("theme").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("sg-theme", next); } catch {}
    app.applyTheme();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.getAttribute("data-theme")) app.applyTheme();
  });

  // Search by path: every word must appear; names that start with the first word come first.
  const search = $("search");
  const results = $("results");
  const runSearch = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.innerHTML = ""; return; }
    const words = q.split(/\s+/);
    const scored = [];
    data.files.forEach((f, i) => {
      const p = f.path.toLowerCase();
      if (!words.every((w) => p.includes(w))) return;
      const name = p.slice(p.lastIndexOf("/") + 1);
      scored.push([i, (name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2) * 1000 + p.length]);
    });
    scored.sort((a, b) => a[1] - b[1]);
    results.innerHTML = scored.slice(0, 8).map(([i]) => fileLink(i)).join("") || `<li class="muted">No file matches</li>`;
  };
  search.addEventListener("input", runSearch);
  search.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const first = results.querySelector("button[data-file]");
      if (first) app.panel.selectFile(+first.dataset.file);
    }
    if (ev.key === "Escape") { search.value = ""; runSearch(); search.blur(); }
  });

  addEventListener("keydown", (ev) => {
    if (typing(ev) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "/") { ev.preventDefault(); search.focus(); }
    if (ev.key === "p" && window.ATLAS_SERVER) { ev.preventDefault(); app.picker.open(); }
    if (ev.key === "Escape") app.panel.select(null);
    if (ev.key === "h") { app.panel.select(null); app.nav.home(); }
  });

  return { renderLegend };
}
