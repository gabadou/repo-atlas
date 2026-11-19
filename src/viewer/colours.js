// Colours, read from Studio G's tokens for the current theme, and what each building is coloured by.
import * as THREE from "three";
import { extOf, hash } from "./util.js";

// Folders and file types are categories, so they take the tag colours, in Studio G's fixed order.
const TAGS = ["sun", "mint", "sky", "rose", "lilac", "vermilion"];
const TYPE_TAG = {
  ".ts": "sky", ".mts": "sky", ".cts": "sky", ".tsx": "mint", ".js": "sun", ".mjs": "sun", ".cjs": "sun", ".jsx": "sun",
  ".astro": "vermilion", ".vue": "mint", ".svelte": "vermilion", ".mdx": "lilac", ".css": "rose", ".scss": "rose", ".less": "rose",
  ".sass": "rose", ".py": "mint", ".go": "sky", ".rs": "vermilion", ".rb": "rose", ".java": "sun", ".kt": "lilac", ".swift": "vermilion",
  ".php": "lilac", ".cs": "mint", ".sql": "lilac",
};

export const isDark = () => {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

export function readColours() {
  const style = getComputedStyle(document.documentElement);
  const col = (name) => new THREE.Color(style.getPropertyValue(name).trim() || "#888");
  const dark = isDark();
  const ink = col("--ink");
  const surface2 = col("--surface-2");
  return {
    dark,
    ink,
    // Buildings: the pastel tag tints by day (an architect's model), the light tag inks After hours.
    tag: Object.fromEntries(TAGS.map((t) => [t, col(dark ? `--tag-${t}-ink` : `--tag-${t}`)])),
    canvas: col("--canvas"),
    muted: col("--ink-muted"),
    line: col("--line"),
    sig: col("--sig"),
    uses: col("--uses"),
    usedBy: col("--used-by"),
    other: surface2.clone().lerp(ink, dark ? 0.35 : 0.08),
    // Plates: surface-2, one step darker (or lighter After hours) per folder level.
    plate: (depth) => surface2.clone().lerp(ink, (dark ? 0.035 : 0.05) + Math.min(depth, 6) * (dark ? 0.03 : 0.035)),
    pkg: surface2.clone().lerp(ink, dark ? 0.3 : 0.22),
  };
}

// The selected building keeps its colour, made more saturated: deeper by day, brighter After hours.
export function emphasize(c, C) {
  const hsl = {};
  c.getHSL(hsl);
  return C.dark
    ? new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.25 + 0.1), Math.min(0.84, hsl.l + 0.12))
    : new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.6 + 0.25), Math.max(0.42, hsl.l - 0.3));
}

// Out of focus: towards the canvas After hours, towards a plain grey by day (the tints are already pale).
export const dim = (c, C) => (C.dark ? c.clone().lerp(C.canvas, 0.8) : c.clone().lerp(C.plate(1), 0.8));

export function createPalette(app) {
  const { data, G, tree, city } = app;

  // Areas get a colour each, in order of size. When one folder holds most of the repo
  // (src/), its sub-folders are the areas instead.
  const areas = [];
  for (let node = tree; ;) {
    const kids = [...node.dirs.values()];
    const main = kids.find((k) => k.count > 0.65 * node.count && k.dirs.size > 1);
    for (const k of kids) if (k !== main) areas.push(k);
    if (!main) break;
    node = main;
  }
  areas.sort((a, b) => b.lines - a.lines);
  const areaIndex = new Map(areas.map((a, i) => [a.path, i]));

  const areaOf = (path) => areas.find((a) => path === a.path || path.startsWith(a.path + "/")) || null;
  const areaColor = (a) => (a ? app.C.tag[TAGS[areaIndex.get(a.path) % TAGS.length]] : app.C.other);
  const typeColor = (ext) => (TYPE_TAG[ext] ? app.C.tag[TYPE_TAG[ext]] : app.C.other);
  const maxFanIn = Math.max(1, ...G.usedBy.map((u) => u.length));
  const heat = (t) => app.C.line.clone().lerp(app.C.sig, 0.1 + 0.9 * t);

  const fileColor = (i, mode) => {
    const p = data.files[i].path;
    if (mode === "type") return typeColor(extOf(p)).clone();
    if (mode === "used") return heat(Math.log1p(G.usedBy[i].length) / Math.log1p(maxFanIn));
    const c = areaColor(areaOf(p)).clone();
    // Slightly lighter or darker per sub-folder so neighbours read apart.
    const shade = ((hash(city.buildings[i].district.path) % 7) - 3) * (app.C.dark ? 0.03 : 0.015);
    return c.offsetHSL(0, 0, shade);
  };

  return { areas, areaOf, areaColor, typeColor, maxFanIn, fileColor };
}
