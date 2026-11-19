// A file's Summary (optional AI, with the reader's own key), the key dialog, and the "AI summaries" line
// in the left panel. A map made without the code (--no-source, --public) shows none of it.
//
// Where the key lives:
//  - served by `atlas serve`: on the computer, once for every project (the Mac keychain, or ~/.config/repo-atlas),
//    or ANTHROPIC_API_KEY / OPENAI_API_KEY. The page never sees it: the server makes the request.
//  - a map file: in this browser (localStorage), and the request goes from the browser to the provider.
import { PROVIDERS, cachedSummary, clearAI, fingerprint, keepSummary, loadAI, promptFor, saveAI, summarize } from "./ai.js";
import { $, esc } from "./util.js";

const server = !!window.ATLAS_SERVER;

const api = async (path, method = "GET", payload) => {
  const r = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-atlas": "1" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `The server answered ${r.status}.`);
  return j;
};

export function createSummary(app) {
  const { data, G, state } = app;
  const hasSource = data.files.some((f) => typeof f.source === "string");
  let status = {}; // { busy: i } or { error, errorFor: i }
  // { provider, model } when there's a key; on the server also { source, env, where }.
  let cfg = server ? null : loadAI();
  let info = null; // the server's answer, with or without a key

  const rerender = (i) => {
    if (state.selected?.kind === "file" && (i === undefined || state.selected.i === i)) app.panel.render();
  };
  const refresh = (s) => {
    info = s;
    cfg = s.hasKey ? s : null;
    renderState();
    rerender();
  };
  if (server && hasSource) api("/api/ai").then(refresh).catch(() => {});

  const privacy = () => (server
    ? (info?.where === "keychain" ? "Your key is saved in your Mac's keychain, on this computer only." : "Your key is saved on this computer only.") +
      " It isn't shared with anyone."
    : "Your key stays in this browser. It isn't shared with anyone.");

  const section = (i) => {
    const f = data.files[i];
    if (typeof f.source !== "string") return "";
    const saved = cachedSummary(data.name, f.path, fingerprint(f.source));
    let body;
    if (status.busy === i) {
      body = `<p class="summary muted">Writing a summary…</p>`;
    } else if (saved) {
      body = `<p class="summary">${esc(saved.text)}</p><p class="by">Written by ${esc(PROVIDERS[saved.provider]?.name || "AI")} from the code` +
        (cfg ? ` <button class="link" type="button" data-ai-write="${i}">Rewrite</button>` : "") + `</p>`;
    } else if (cfg) {
      body = `<p class="muted">No summary yet.</p><div class="summary-actions"><button class="btn primary" type="button" data-ai-write="${i}">Write a summary</button></div>`;
    } else {
      body = `<p class="line">Add your own Claude or OpenAI key to get a few sentences on what each file does and why it's there.</p>` +
        `<p class="note">${privacy()}</p>` +
        `<div class="summary-actions"><button class="btn ghost" type="button" data-ai-setup>Add your key</button></div>`;
    }
    if (status.errorFor === i) body += `<p class="error">${esc(status.error)}</p>`;
    return `<section><h3>Summary</h3>${body}</section>`;
  };

  const write = async (i) => {
    if (!cfg) return open();
    const f = data.files[i];
    status = { busy: i };
    rerender(i);
    const prompt = promptFor(data.name, f, {
      uses: G.uses[i].map((x) => data.files[x].path),
      usedBy: G.usedBy[i].map((x) => data.files[x].path),
    });
    try {
      const out = server ? await api("/api/summarize", "POST", { prompt }) : await summarize(cfg, prompt);
      if (!out.text) throw new Error("The model sent back no text. Try again, or another model.");
      keepSummary(data.name, f.path, { hash: fingerprint(f.source), text: out.text, provider: cfg.provider, model: out.model, at: Date.now() });
      status = {};
    } catch (e) {
      status = { errorFor: i, error: e instanceof TypeError ? `Couldn't reach ${PROVIDERS[cfg.provider].name}. Check your connection.` : e.message };
    }
    rerender(i);
  };

  // The key dialog.
  const dialog = $("ai-dialog");
  const form = $("ai-form");
  const error = (text) => {
    $("ai-error").textContent = text;
    $("ai-error").hidden = !text;
  };
  const describeKey = () => {
    const key = form.elements.key;
    key.value = server ? "" : cfg?.key || "";
    key.placeholder = !server || !info?.hasKey || info.provider !== form.elements.provider.value
      ? "Paste your key"
      : info.source === "env" ? `Using ${info.env} · paste a key to save one` : "Saved · paste a new one to replace it";
  };
  const open = () => {
    form.elements.provider.value = cfg?.provider || info?.provider || "claude";
    form.elements.model.value = cfg?.model || PROVIDERS[form.elements.provider.value].model;
    describeKey();
    $("ai-remove").hidden = !cfg || cfg.source === "env";
    $("ai-privacy").textContent = privacy() +
      " When you ask for a summary, the file's code goes " + (server ? "from this computer" : "from your browser") +
      " straight to Claude or OpenAI, billed to your key.";
    error("");
    dialog.showModal();
    form.elements.key.focus();
  };
  const changed = () => {
    status = {};
    renderState();
    rerender();
  };
  form.addEventListener("change", (ev) => {
    if (ev.target.name !== "provider") return;
    const model = form.elements.model;
    if (!model.value || Object.values(PROVIDERS).some((p) => p.model === model.value)) model.value = PROVIDERS[ev.target.value].model;
    describeKey();
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const provider = form.elements.provider.value;
    const model = form.elements.model.value.trim() || PROVIDERS[provider].model;
    const key = form.elements.key.value.trim();
    if (server) {
      try {
        refresh(await api("/api/ai", "POST", { provider, model, key }));
      } catch (e) {
        return error(e.message);
      }
    } else {
      if (!key) return error("Paste a key first.");
      saveAI({ provider, key, model });
      cfg = loadAI();
    }
    dialog.close();
    changed();
  });
  $("ai-cancel").addEventListener("click", () => dialog.close());
  $("ai-remove").addEventListener("click", async () => {
    if (server) refresh(await api("/api/ai", "DELETE").catch(() => info));
    else {
      clearAI();
      cfg = null;
    }
    dialog.close();
    changed();
  });

  // "AI summaries: Claude · model / Off", in the left panel.
  function renderState() {
    $("ai-row").hidden = !hasSource;
    if (!hasSource) return;
    $("ai-state").textContent = cfg ? `${PROVIDERS[cfg.provider].name} · ${cfg.model}` : "Off";
    $("ai-change").textContent = cfg ? "Change" : "Add a key";
  }
  renderState();

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.aiWrite !== undefined) write(+b.dataset.aiWrite);
    else if (b.hasAttribute("data-ai-setup")) open();
  });

  return { section, open };
}
