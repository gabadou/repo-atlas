// Small helpers shared by the viewer's modules.

export const $ = (id) => document.getElementById(id);

export const fmt = (n) => n.toLocaleString("en");

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// `code` in a comment or a doc, as <code>.
export const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

export const plural = (n, one, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;

export const extOf = (p) => {
  const b = p.slice(p.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
};

export const dirOf = (p) => p.slice(0, p.lastIndexOf("/")) || "/";

export const day = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function ago(t) {
  const d = Math.floor((Date.now() / 1000 - t) / 86400);
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return day(t);
}

export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// True when the keyboard belongs to a field or a dialog, not to the map.
export const typing = (ev) => !!ev.target.closest?.("input, textarea, select") || !!document.querySelector("dialog[open]");
