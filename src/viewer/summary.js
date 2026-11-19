// A file's Summary (optional AI, with the reader's own key), the key dialog, and the "AI summaries" line
// in the left panel. A map made without the code (--no-source, --public) shows none of it.
import { PROVIDERS, cachedSummary, clearAI, fingerprint, keepSummary, loadAI, promptFor, saveAI, summarize } from "./ai.js";
import { $, esc } from "./util.js";

export function createSummary(app) {
  const { data, G, state } = app;
  const hasSource = data.files.some((f) => typeof f.source === "string");
  let status = {}; // { busy: i } or { error, errorFor: i }

  const rerender = (i) => {
    if (state.selected?.kind === "file" && (i === undefined || state.selected.i === i)) app.panel.render();
  };

  const section = (i) => {
    const f = data.files[i];
    if (typeof f.source !== "string") return "";
    const cfg = loadAI();
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
        `<p class="note">Your key stays in this browser. It isn't shared with anyone.</p>` +
        `<div class="summary-actions"><button class="btn ghost" type="button" data-ai-setup>Add your key</button></div>`;
    }
    if (status.errorFor === i) body += `<p class="error">${esc(status.error)}</p>`;
    return `<section><h3>Summary</h3>${body}</section>`;
  };

  const write = async (i) => {
    const cfg = loadAI();
    if (!cfg) return open();
    const f = data.files[i];
    status = { busy: i };
    rerender(i);
    try {
      const out = await summarize(cfg, promptFor(data.name, f, {
        uses: G.uses[i].map((x) => data.files[x].path),
        usedBy: G.usedBy[i].map((x) => data.files[x].path),
      }));
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
  const open = () => {
    const cfg = loadAI();
    form.elements.provider.value = cfg?.provider || "claude";
    form.elements.key.value = cfg?.key || "";
    form.elements.model.value = cfg?.model || PROVIDERS[form.elements.provider.value].model;
    $("ai-remove").hidden = !cfg;
    $("ai-error").hidden = true;
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
  });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const key = form.elements.key.value.trim();
    if (!key) {
      $("ai-error").textContent = "Paste a key first.";
      $("ai-error").hidden = false;
      return;
    }
    const provider = form.elements.provider.value;
    saveAI({ provider, key, model: form.elements.model.value.trim() || PROVIDERS[provider].model });
    dialog.close();
    changed();
  });
  $("ai-cancel").addEventListener("click", () => dialog.close());
  $("ai-remove").addEventListener("click", () => { clearAI(); dialog.close(); changed(); });

  // "AI summaries: Claude · model / Off", in the left panel.
  const renderState = () => {
    $("ai-row").hidden = !hasSource;
    if (!hasSource) return;
    const cfg = loadAI();
    $("ai-state").textContent = cfg ? `${PROVIDERS[cfg.provider].name} · ${cfg.model}` : "Off";
    $("ai-change").textContent = cfg ? "Change" : "Add a key";
  };
  renderState();

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.aiWrite !== undefined) write(+b.dataset.aiWrite);
    else if (b.hasAttribute("data-ai-setup")) open();
  });

  return { section, open };
}
