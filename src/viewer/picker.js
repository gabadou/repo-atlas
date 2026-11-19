// The project picker: only when `atlas serve` serves the page (window.ATLAS_SERVER). It lists the folders
// of the server's root folder, most recently changed first; picking one loads its map.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function initPicker() {
  const server = window.ATLAS_SERVER;
  const btn = $("picker-btn");
  if (!server) return { open() {} };
  btn.disabled = false;
  btn.title = "Map another project";

  const pop = $("picker");
  const search = $("picker-search");
  const list = $("picker-list");
  const browse = $("picker-browse");
  browse.hidden = !server.browse;
  let projects = null;
  let shown = [];
  let active = 0;

  const ago = (t) => {
    const d = Math.floor((Date.now() / 1000 - t) / 86400);
    if (d < 1) return "today";
    if (d < 2) return "yesterday";
    if (d < 30) return `${d} days ago`;
    if (d < 365) return `${Math.floor(d / 30)} mo ago`;
    return `${Math.floor(d / 365)} y ago`;
  };

  const render = () => {
    if (!projects) { list.innerHTML = `<li class="muted">Looking…</li>`; return; }
    const q = search.value.trim().toLowerCase();
    shown = projects.filter((p) => !q || p.name.toLowerCase().includes(q));
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length
      ? shown.map((p, i) => `<li><button type="button" data-i="${i}" class="${p.path === server.current ? "current" : ""}${i === active ? " active" : ""}">` +
          `<i></i><span class="name">${esc(p.name)}</span><span class="n">${p.git ? ago(p.last) : "not a git repo"}</span></button></li>`).join("")
      : `<li class="muted">No project matches</li>`;
  };

  const go = (path, name) => {
    if (!path) return;
    close();
    const o = $("opening");
    o.querySelector("b").textContent = name || path.split("/").filter(Boolean).pop();
    o.hidden = false;
    location.href = `/map?path=${encodeURIComponent(path)}`;
  };

  function open() {
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, r.left - 8)}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    search.value = "";
    active = 0;
    render();
    search.focus();
    fetch("/api/projects").then((r) => r.json()).then((j) => { projects = j.projects; render(); })
      .catch(() => { list.innerHTML = `<li class="muted">The server isn't answering. Is atlas serve still running?</li>`; });
  }
  function close() {
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (ev) => { ev.stopPropagation(); pop.hidden ? open() : close(); });
  search.addEventListener("input", () => { active = 0; render(); });
  search.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      active = (active + (ev.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      render();
    } else if (ev.key === "Enter" && shown[active]) {
      go(shown[active].path, shown[active].name);
    } else if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
      btn.focus();
    }
  });
  list.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (b) go(shown[+b.dataset.i].path, shown[+b.dataset.i].name);
  });
  browse.addEventListener("click", async () => {
    browse.disabled = true;
    try {
      const j = await (await fetch("/api/browse")).json();
      if (j.path) go(j.path);
    } finally {
      browse.disabled = false;
    }
  });
  $("picker-path").addEventListener("submit", (ev) => {
    ev.preventDefault();
    go(ev.target.elements.path.value.trim());
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!pop.hidden && !pop.contains(ev.target) && !btn.contains(ev.target)) close();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !pop.hidden) close();
  });
  // Coming back with the browser's back button: hide the "Mapping…" card.
  addEventListener("pageshow", () => { $("opening").hidden = true; });
  return { open };
}
