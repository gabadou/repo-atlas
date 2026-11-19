// Optional AI summaries, with the reader's own key. The key stays in this browser (localStorage); a summary
// request goes from the browser straight to the provider. Summaries are kept per file and content.

const KEY = "atlas-ai";

export const PROVIDERS = {
  claude: { name: "Claude", model: "claude-haiku-5-5" },
  openai: { name: "OpenAI", model: "gpt-6-luna" },
};

export function loadAI() {
  try {
    const cfg = JSON.parse(localStorage.getItem(KEY) || "null");
    return cfg && PROVIDERS[cfg.provider] && cfg.key ? cfg : null;
  } catch {
    return null;
  }
}
export function saveAI(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {}
}
export function clearAI() {
  try { localStorage.removeItem(KEY); } catch {}
}

const cacheKey = (repo, path) => `atlas-summary:${repo}:${path}`;
export function cachedSummary(repo, path, hash) {
  try {
    const s = JSON.parse(localStorage.getItem(cacheKey(repo, path)) || "null");
    return s && s.hash === hash ? s : null;
  } catch {
    return null;
  }
}
export function keepSummary(repo, path, entry) {
  try { localStorage.setItem(cacheKey(repo, path), JSON.stringify(entry)); } catch {}
}

const SYSTEM =
  "You explain a codebase to product managers and developers who are new to it. Given one file and its context, " +
  "write two or three short sentences in plain English: what the file does, and why it is there in the product. " +
  "Name the feature or part of the product it serves when the code makes it clear. " +
  "No markdown, no lists, no code, no preamble, and nothing the code doesn't show.";

export function promptFor(repo, f, ctx) {
  const parts = [`Repository: ${repo}`, `File: ${f.path}`];
  if (f.role) parts.push(`Role: ${f.role}${f.route ? ` at ${f.route}` : ""}`);
  if (f.about) parts.push(`Its opening comment: ${f.about}`);
  if (f.docs?.length) parts.push("What the repo's docs say about it:\n" + f.docs.map((d) => `- (${d.doc}) ${d.text}`).join("\n"));
  if (ctx.uses.length) parts.push("It uses: " + ctx.uses.slice(0, 20).join(", "));
  if (ctx.usedBy.length) parts.push("It is used by: " + ctx.usedBy.slice(0, 20).join(", "));
  if (f.exports?.length) parts.push("It exports: " + f.exports.map(([n]) => n).join(", "));
  parts.push("The code" + (f.cut ? " (start of the file)" : "") + ":\n```\n" + f.source + "\n```");
  return parts.join("\n\n");
}

export async function summarize(cfg, prompt) {
  const model = cfg.model || PROVIDERS[cfg.provider].model;
  if (cfg.provider === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(problem("Claude", res.status, json.error?.message));
    return { text: (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim(), model };
  }
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model, instructions: SYSTEM, input: prompt, max_output_tokens: 1200 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(problem("OpenAI", res.status, json.error?.message));
  const text = json.output_text ||
    (json.output || []).flatMap((o) => o.content || []).filter((c) => c.type === "output_text").map((c) => c.text).join("");
  return { text: (text || "").trim(), model };
}

// What went wrong, in a sentence the reader can act on.
function problem(name, status, detail) {
  if (status === 401 || status === 403) return `${name} refused the key. Check it with Change, under AI summaries.`;
  if (status === 404) return `${name} doesn't know this model. Pick another with Change, under AI summaries.`;
  if (status === 429) return `${name} is limiting requests on this key. Try again in a moment.`;
  return `${name} couldn't write it${detail ? `: ${detail}` : ` (error ${status})`}.`;
}

// A short, stable fingerprint of a file's code, so a summary is redone when the file changes.
export function fingerprint(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ":" + s.length;
}
