import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { analyse } from "./graph.js";
import { buildTree, layout, PLATE } from "./city.js";
import { initPicker } from "./picker.js";
import { PROVIDERS, cachedSummary, clearAI, fingerprint, keepSummary, loadAI, promptFor, saveAI, summarize } from "./ai.js";

const data = JSON.parse(document.getElementById("atlas-data").textContent);
const G = analyse(data);
const tree = buildTree(data.files);
const city = layout(data, tree);
const N = data.files.length;

// ---------- Colours: read from Studio G's tokens, for the current theme -----

const extOf = (p) => {
  const b = p.slice(p.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
};
// Folders and file types are categories, so they take the tag colours, in Studio G's fixed order.
const TAGS = ["sun", "mint", "sky", "rose", "lilac", "vermilion"];
const TYPE_TAG = {
  ".ts": "sky", ".mts": "sky", ".cts": "sky", ".tsx": "mint", ".js": "sun", ".mjs": "sun", ".cjs": "sun", ".jsx": "sun",
  ".astro": "vermilion", ".vue": "mint", ".svelte": "vermilion", ".mdx": "lilac", ".css": "rose", ".scss": "rose", ".less": "rose",
  ".sass": "rose", ".py": "mint", ".go": "sky", ".rs": "vermilion", ".rb": "rose", ".java": "sun", ".kt": "lilac", ".swift": "vermilion",
  ".php": "lilac", ".cs": "mint", ".sql": "lilac",
};
const isDark = () => {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
let C;
function readTheme() {
  const style = getComputedStyle(document.documentElement);
  const col = (name) => new THREE.Color(style.getPropertyValue(name).trim() || "#888");
  const dark = isDark();
  const ink = col("--ink");
  const surface2 = col("--surface-2");
  // Buildings: the pastel tag tints by day (an architect's model), the light tag inks After hours.
  const tag = Object.fromEntries(TAGS.map((t) => [t, col(dark ? `--tag-${t}-ink` : `--tag-${t}`)]));
  C = {
    dark, ink, tag,
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
readTheme();

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
const areaOf = (path) => {
  for (const a of areas) if (path === a.path || path.startsWith(a.path + "/")) return a;
  return null;
};
const areaColor = (a) => (a ? C.tag[TAGS[areaIndex.get(a.path) % TAGS.length]] : C.other);
const typeColor = (ext) => (TYPE_TAG[ext] ? C.tag[TYPE_TAG[ext]] : C.other);
const maxFanIn = Math.max(1, ...G.usedBy.map((u) => u.length));
const heat = (t) => C.line.clone().lerp(C.sig, 0.1 + 0.9 * t);

const fileColor = (i, mode) => {
  const p = data.files[i].path;
  if (mode === "type") return typeColor(extOf(p)).clone();
  if (mode === "used") return heat(Math.log1p(G.usedBy[i].length) / Math.log1p(maxFanIn));
  const c = areaColor(areaOf(p)).clone();
  // Slightly lighter or darker per sub-folder so neighbours read apart.
  const sub = city.buildings[i].district;
  const shade = ((hash(sub.path) % 7) - 3) * (C.dark ? 0.03 : 0.015);
  return c.offsetHSL(0, 0, shade);
};

// ---------- Scene ------------------------------------------------------

const canvas = document.getElementById("scene");
// Transparent: the page's dotted canvas shows through.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const size = Math.max(city.bounds.w, city.bounds.d) + (city.packages ? city.packages.w : 0);
scene.fog = new THREE.Fog(C.canvas, size * 1.8, size * 4.5);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, size * 20);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 3;
controls.maxDistance = size * 4;

const hemi = new THREE.HemisphereLight("#ffffff", "#808080", 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight("#ffffff", 1.6);
sun.position.set(-0.6, 1, 0.45);
scene.add(sun);
const light = () => {
  hemi.intensity = C.dark ? 1.5 : 1.75;
  sun.intensity = C.dark ? 1.5 : 1.25;
  hemi.groundColor.set(C.dark ? "#3a3a3a" : "#9a9a9a");
};
light();

const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const m4 = new THREE.Matrix4();

// Districts.
const plates = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), city.districts.length + (city.packages ? 1 : 0));
city.districts.forEach((d, k) => {
  m4.makeScale(d.w, PLATE, d.d).setPosition(d.x + d.w / 2, d.y, d.z + d.d / 2);
  plates.setMatrixAt(k, m4);
});
if (city.packages) {
  const p = city.packages;
  m4.makeScale(p.w, PLATE, p.d).setPosition(p.x + p.w / 2, 0, p.z + p.d / 2);
  plates.setMatrixAt(city.districts.length, m4);
}
scene.add(plates);

// Buildings.
const towers = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), N);
city.buildings.forEach((b, i) => {
  m4.makeScale(b.w, b.h, b.d).setPosition(b.x + b.w / 2, b.y, b.z + b.d / 2);
  towers.setMatrixAt(i, m4);
});
scene.add(towers);

// Packages.
const pkgGroup = new THREE.Group();
const pkgLabels = new THREE.Group();
let pkgMesh = null;
if (city.packages) {
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 24).translate(0, 0.5, 0);
  pkgMesh = new THREE.InstancedMesh(cyl, new THREE.MeshLambertMaterial(), data.packages.length);
  const maxUse = Math.max(1, ...G.pkgUsedBy.map((u) => u.length));
  city.packages.items.forEach((it) => {
    it.h = 0.4 + (Math.log1p(G.pkgUsedBy[it.i].length) / Math.log1p(maxUse)) * 5;
    m4.makeScale(it.r, it.h, it.r).setPosition(it.x, PLATE, it.z);
    pkgMesh.setMatrixAt(it.i, m4);
  });
  pkgGroup.add(pkgMesh, pkgLabels);
  scene.add(pkgGroup);
}

// Labels painted on the plates; the top-level areas also get a label that floats on screen.
const labelGroup = new THREE.Group();
scene.add(labelGroup);
const areaPaths = new Set(areas.map((a) => a.path));
const floating = city.districts.filter((d) => areaPaths.has(d.path)).map((d) => {
  const el = document.createElement("div");
  el.className = "area";
  el.innerHTML = `<button data-dir="${esc(d.path)}">${esc(d.name)}</button>`;
  document.getElementById("areas").append(el);
  return { el, at: new THREE.Vector3(d.x + d.pad, d.top, d.z + d.d - d.pad * 0.5) };
});
const v3 = new THREE.Vector3();
const placeFloating = () => {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const f of floating) {
    v3.copy(f.at).project(camera);
    const off = v3.z > 1 || !state.labels;
    f.el.hidden = off;
    if (!off) f.el.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px)`;
  }
};
const paint = (text, sub, x, z, w, h, y, big, group = labelGroup) => {
  const pxPerUnit = 96;
  const cw = Math.min(2048, Math.max(64, Math.round(w * pxPerUnit)));
  const ch = Math.max(24, Math.round(h * pxPerUnit));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d");
  let fs = ch * (big ? 0.6 : 0.5);
  const font = (s, weight = 600) => `${weight} ${s}px Inter, system-ui, sans-serif`;
  g.font = font(fs);
  if ("letterSpacing" in g) g.letterSpacing = `${(fs * 0.08).toFixed(1)}px`;
  const main = text.toUpperCase();
  const subW = sub ? g.measureText("   " + sub).width * 0.7 : 0;
  while (fs > 8 && g.measureText(main).width + subW > cw * 0.96) {
    fs *= 0.9;
    g.font = font(fs);
    if ("letterSpacing" in g) g.letterSpacing = `${(fs * 0.08).toFixed(1)}px`;
  }
  g.fillStyle = "#" + C.ink.getHexString();
  g.textBaseline = "middle";
  g.fillText(main, cw * 0.01, ch * 0.52);
  if (sub) {
    const mw = g.measureText(main).width;
    g.font = font(fs * 0.7, 500);
    if ("letterSpacing" in g) g.letterSpacing = "0px";
    g.fillStyle = "#" + C.muted.getHexString();
    if (mw + g.measureText("   " + sub).width < cw * 0.98) g.fillText("   " + sub, cw * 0.01 + mw, ch * 0.54);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(cw / pxPerUnit, ch / pxPerUnit),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x + cw / pxPerUnit / 2, y + 0.012, z + ch / pxPerUnit / 2);
  group.add(mesh);
};
const clear = (group) => {
  for (const m of [...group.children]) {
    m.geometry.dispose();
    m.material.map?.dispose();
    m.material.dispose();
    group.remove(m);
  }
};
function paintLabels() {
  clear(labelGroup);
  clear(pkgLabels);
  for (const d of city.districts) {
    if (!d.label) continue;
    const sub = `${d.node.count} files · ${fmt(d.node.lines)} lines`;
    paint(d.depth === 0 ? data.name : d.name, sub, d.x + d.pad, d.z + d.d - d.pad - d.label, d.w - d.pad * 2, d.label, d.top, d.depth === 0);
  }
  if (city.packages) {
    const p = city.packages;
    paint("packages", `${data.packages.length} used`, p.x + 0.8, p.z + p.d - 0.8 - p.label, p.w - 1.6, p.label, PLATE, false, pkgLabels);
    if (data.packages.length <= 120) {
      for (const it of p.items) paint(it.name, null, it.x - p.cell / 2 + 0.08, it.z + it.r + 0.08, p.cell - 0.16, p.cell * 0.17, PLATE, false, pkgLabels);
    }
  }
}
paintLabels();
// Repaint once Inter has loaded (the first paint may have used the fallback).
document.fonts?.ready.then(paintLabels);

// ---------- Import lines -----------------------------------------------

const top = (i) => {
  const b = city.buildings[i];
  return new THREE.Vector3(b.x + b.w / 2, b.y + b.h, b.z + b.d / 2);
};
const pkgTop = (p) => {
  const it = city.packages.items[p];
  return new THREE.Vector3(it.x, PLATE + it.h, it.z);
};
const SEG = 18;
const arc = (a, b, pos, col, ca, cb) => {
  const dist = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y = Math.max(a.y, b.y) + 1.5 + dist * 0.28;
  let prev = a;
  const c = new THREE.Color();
  for (let s = 1; s <= SEG; s++) {
    const t = s / SEG;
    const p = new THREE.Vector3(
      (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mid.x + t * t * b.x,
      (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * mid.y + t * t * b.y,
      (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * mid.z + t * t * b.z,
    );
    pos.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
    c.copy(ca).lerp(cb, (s - 1) / SEG);
    col.push(c.r, c.g, c.b);
    c.copy(ca).lerp(cb, t);
    col.push(c.r, c.g, c.b);
    prev = p;
  }
};
const lineMesh = (opacity) => {
  const geo = new THREE.BufferGeometry();
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false });
  const l = new THREE.LineSegments(geo, mat);
  l.frustumCulled = false;
  scene.add(l);
  return l;
};
const allLines = lineMesh(C.dark ? 0.22 : 0.32);

// The selected building keeps its colour: an ink outline around it and a pixel in the signature colour above it
// (Studio G marks state with small square pixels).
const outline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  new THREE.LineBasicMaterial({ color: C.ink, fog: false }),
);
const pixel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: C.sig, fog: false }));
outline.visible = pixel.visible = false;
scene.add(outline, pixel);
function markSelection(sel) {
  outline.material.color.copy(C.ink);
  pixel.material.color.copy(C.sig);
  let box = null;
  if (sel?.kind === "file") {
    const b = city.buildings[sel.i];
    box = { x: b.x + b.w / 2, z: b.z + b.d / 2, w: b.w, d: b.d, y: b.y, h: b.h };
  } else if (sel?.kind === "package" && city.packages) {
    const it = city.packages.items[sel.i];
    box = { x: it.x, z: it.z, w: it.r * 2, d: it.r * 2, y: PLATE, h: it.h };
  }
  outline.visible = pixel.visible = !!box;
  if (!box) return;
  const pad = Math.max(0.06, Math.min(box.w, box.d) * 0.05);
  outline.scale.set(box.w + pad * 2, box.h + pad, box.d + pad * 2);
  outline.position.set(box.x, box.y, box.z);
  const s = Math.min(1.1, Math.max(0.35, Math.min(box.w, box.d) * 0.3));
  pixel.scale.setScalar(s);
  pixel.position.set(box.x, box.y + box.h + s * 0.5 + Math.max(0.6, s * 1.4), box.z);
}
const focusLines = lineMesh(0.95);
const setLines = (mesh, list) => {
  const pos = [];
  const col = [];
  for (const [a, b, ca, cb] of list) arc(a, b, pos, col, ca, cb);
  mesh.geometry.dispose();
  mesh.geometry = new THREE.BufferGeometry();
  mesh.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  mesh.geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
};
const paintAllLines = () => setLines(allLines, data.edges.map(([a, b]) => [top(a), top(b), C.usedBy, C.uses]));
paintAllLines();

// ---------- State and paint --------------------------------------------

const state = { mode: "area", selected: null, lines: true, packages: true, labels: true };
const baseColors = [];
const recolour = () => {
  for (let i = 0; i < N; i++) baseColors[i] = fileColor(i, state.mode);
};
recolour();

// Out of focus: towards the canvas After hours, towards a plain grey by day (the tints are already pale).
const dim = (c) => (C.dark ? c.clone().lerp(C.canvas, 0.8) : c.clone().lerp(C.plate(1), 0.8));
const paintScene = () => {
  const sel = state.selected;
  let focus = null; // set of files to keep bright
  let lines = [];
  let pkgFocus = null;
  if (sel?.kind === "file") {
    const i = sel.i;
    focus = new Set([i, ...G.uses[i], ...G.usedBy[i]]);
    pkgFocus = new Set(G.pkgUses[i]);
    for (const t of G.uses[i]) lines.push([top(i), top(t), C.uses, C.uses]);
    for (const s of G.usedBy[i]) lines.push([top(s), top(i), C.usedBy, C.usedBy]);
    if (state.packages) for (const p of G.pkgUses[i]) lines.push([top(i), pkgTop(p), C.uses, C.uses]);
  } else if (sel?.kind === "dir") {
    const inside = (k) => data.files[k].path.startsWith(sel.path + "/");
    focus = new Set();
    pkgFocus = new Set();
    for (const [a, b] of data.edges) {
      const ia = inside(a), ib = inside(b);
      if (ia) focus.add(a);
      if (ib) focus.add(b);
      if (ia && !ib) { focus.add(b); lines.push([top(a), top(b), C.uses, C.uses]); }
      if (!ia && ib) { focus.add(a); lines.push([top(a), top(b), C.usedBy, C.usedBy]); }
    }
    for (let k = 0; k < N; k++) if (inside(k)) focus.add(k);
    for (const [a, p] of data.packageEdges) if (inside(a)) pkgFocus.add(p);
  } else if (sel?.kind === "package") {
    focus = new Set(G.pkgUsedBy[sel.i]);
    pkgFocus = new Set([sel.i]);
    for (const a of G.pkgUsedBy[sel.i]) lines.push([top(a), pkgTop(sel.i), C.usedBy, C.usedBy]);
  }

  for (let i = 0; i < N; i++) {
    let c = baseColors[i];
    if (focus && !focus.has(i)) c = dim(c);
    towers.setColorAt(i, c);
  }
  towers.instanceColor.needsUpdate = true;

  city.districts.forEach((d, k) => {
    let c = C.plate(d.depth);
    if (sel?.kind === "dir" && (d.path === sel.path || d.path.startsWith(sel.path + "/"))) c = c.clone().lerp(C.sig, 0.18);
    plates.setColorAt(k, c);
  });
  if (city.packages) plates.setColorAt(city.districts.length, C.plate(0));
  plates.instanceColor.needsUpdate = true;

  if (pkgMesh) {
    data.packages.forEach((_, p) => {
      let c = C.pkg;
      if (pkgFocus && !pkgFocus.has(p)) c = dim(c, 0.75);
      pkgMesh.setColorAt(p, c);
    });
    pkgMesh.instanceColor.needsUpdate = true;
  }

  setLines(focusLines, lines);
  markSelection(sel);
  allLines.visible = state.lines && !sel;
  focusLines.visible = !!sel;
  pkgGroup.visible = state.packages;
  labelGroup.visible = state.labels;
};

// ---------- Camera -----------------------------------------------------

let flight = null;
const flyTo = (target, dist, now = false) => {
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0.8, 1);
  dir.normalize();
  if (dir.y < 0.6) { dir.y = 0.6; dir.normalize(); }
  const to = target.clone().add(dir.multiplyScalar(dist));
  if (now || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    controls.target.copy(target);
    camera.position.copy(to);
    return;
  }
  flight = { t0: performance.now(), fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target, toP: to };
};
const home = (now) => {
  const b = city.bounds;
  const extra = city.packages && state.packages ? city.packages.w + 4 : 0;
  const c = new THREE.Vector3(b.x + (b.w + extra) / 2, 0, 0);
  const r = Math.hypot(b.w + extra, b.d) / 2;
  const aspect = Math.min(1, camera.aspect);
  const dist = (r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.9 / aspect;
  const p = c.clone().add(new THREE.Vector3(-0.12, 0.62, 0.78).normalize().multiplyScalar(dist));
  if (now || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    controls.target.copy(c);
    camera.position.copy(p);
  } else {
    flight = { t0: performance.now(), fromT: controls.target.clone(), fromP: camera.position.clone(), toT: c, toP: p };
  }
};
// Frames a file with everything it uses and everything that uses it.
const frameFile = (i) => {
  const box3 = new THREE.Box3();
  for (const k of [i, ...G.uses[i], ...G.usedBy[i]]) {
    const b = city.buildings[k];
    box3.expandByPoint(new THREE.Vector3(b.x, b.y, b.z));
    box3.expandByPoint(new THREE.Vector3(b.x + b.w, b.y + b.h, b.z + b.d));
  }
  const b = city.buildings[i];
  const c = box3.getCenter(new THREE.Vector3());
  const r = box3.getSize(new THREE.Vector3()).length() / 2;
  // Lean towards the file itself so it stays in the middle of the picture.
  c.lerp(new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2), 0.35);
  flyTo(c, Math.max(24, (r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.85));
};
const frameDir = (d) => {
  const r = Math.hypot(d.w, d.d) / 2;
  flyTo(new THREE.Vector3(d.x + d.w / 2, d.top + 2, d.z + d.d / 2), Math.max(30, (r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.7));
};

// ---------- Interaction ------------------------------------------------

const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tip = document.getElementById("tip");
let hover = null;
let pending = null;

const hit = (ev) => {
  const r = canvas.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const targets = [towers, plates];
  if (pkgMesh && state.packages) targets.push(pkgMesh);
  const h = ray.intersectObjects(targets, false)[0];
  if (!h) return null;
  if (h.object === towers) return { kind: "file", i: h.instanceId };
  if (h.object === pkgMesh) return { kind: "package", i: h.instanceId };
  if (h.instanceId < city.districts.length) {
    const d = city.districts[h.instanceId];
    return d.depth === 0 ? null : { kind: "dir", path: d.path, d };
  }
  return null;
};

canvas.addEventListener("pointermove", (ev) => { pending = ev; });
canvas.addEventListener("pointerleave", () => { pending = null; hover = null; tip.hidden = true; });
let down = null;
canvas.addEventListener("pointerdown", (ev) => { down = [ev.clientX, ev.clientY]; });
canvas.addEventListener("pointerup", (ev) => {
  if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5 || ev.button !== 0) return;
  const h = hit(ev);
  select(h, true);
});

const updateHover = () => {
  if (!pending) return;
  const ev = pending;
  pending = null;
  hover = hit(ev);
  if (!hover) { tip.hidden = true; canvas.style.cursor = ""; return; }
  canvas.style.cursor = "pointer";
  let html = "";
  if (hover.kind === "file") {
    const f = data.files[hover.i];
    const what = [f.role, f.route].filter(Boolean).join(" ");
    html = `<b>${esc(f.path)}</b>${what ? `<span class="role">${esc(what)}</span>` : ""}<span>${fmt(f.lines)} lines · uses ${G.uses[hover.i].length} · used by ${G.usedBy[hover.i].length}</span>`;
  } else if (hover.kind === "dir") {
    html = `<b>${esc(hover.path)}/</b><span>${hover.d.node.count} files · ${fmt(hover.d.node.lines)} lines</span>`;
  } else {
    html = `<b>${esc(data.packages[hover.i])}</b><span>package · used by ${G.pkgUsedBy[hover.i].length} files</span>`;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8);
  tip.style.transform = `translate(${x}px, ${y}px)`;
};

// ---------- Panels -----------------------------------------------------

const $ = (id) => document.getElementById(id);
const detail = $("detail");

function select(sel, fly) {
  if (sel && state.selected && sel.kind === state.selected.kind && sel.i === state.selected.i && sel.path === state.selected.path) {
    if (fly) (sel.kind === "file" ? frameFile(sel.i) : sel.kind === "dir" ? frameDir(sel.d) : null);
    return;
  }
  state.selected = sel;
  paintScene();
  renderDetail();
  if (fly && sel?.kind === "file") frameFile(sel.i);
  if (fly && sel?.kind === "dir") frameDir(sel.d);
}
const selectFile = (i) => select({ kind: "file", i }, true);
const selectDir = (path) => {
  const d = city.districts.find((x) => x.path === path);
  if (d) select({ kind: "dir", path, d }, true);
};

const fileLink = (i, extra = "") => {
  const p = data.files[i].path;
  const k = p.lastIndexOf("/");
  return `<li><button data-file="${i}"><span class="dir">${esc(p.slice(0, k + 1))}&lrm;</span>${esc(p.slice(k + 1))}${extra}</button></li>`;
};
const list = (title, items, colour, empty = "None") =>
  `<section><h3>${colour ? `<i style="background:${colour}"></i>` : ""}${title} <span class="n">${items.length}</span></h3>` +
  (items.length ? `<ul class="files">${items.join("")}</ul>` : `<p class="muted">${empty}</p>`) +
  `</section>`;
// A list of files that folds after the first eight.
const fileList = (title, ids, colour) => {
  if (!ids.length) return ""; // the Connections line already says so
  if (ids.length <= 10) return list(title, ids.map((x) => fileLink(x)), colour);
  return `<section><h3><i style="background:${colour}"></i>${title} <span class="n">${ids.length}</span></h3>` +
    `<ul class="files">${ids.slice(0, 8).map((x) => fileLink(x)).join("")}</ul>` +
    `<details><summary>${ids.length - 8} more</summary><ul class="files">${ids.slice(8).map((x) => fileLink(x)).join("")}</ul></details></section>`;
};
const dirOf = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
const plural = (n, one, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;
const connections = (f, uses, usedBy, folders) => {
  const a = uses ? `Uses ${plural(uses, "file")} in the repo` : "Uses no other file in the repo";
  let b = usedBy ? `used by ${plural(usedBy, "file")}${usedBy > 1 ? ` in ${plural(folders, "folder")}` : ""}` : "nothing imports it";
  // Entry points aren't imported: say what runs them instead.
  if (!usedBy && f.route) b += `: the framework opens it at <code>${esc(f.route)}</code>`;
  else if (!usedBy && f.role === "Test") b += ": the test runner runs it";
  else if (!usedBy && f.role === "Database migration") b += ": it runs once on the database";
  else if (!usedBy && f.role === "Server entry") b += ": the server starts here";
  else if (!usedBy && ["Script", "Eval"].includes(f.role)) b += ": you run it from the command line";
  else if (!usedBy && f.role === "Config") b += ": the tools read it";
  else if (!usedBy && !ENTRY.has(f.role) && CODE_EXT.test(f.path)) b += ": an entry point, or unused";
  return `${a}; ${b}.`;
};

// Files whose role means nothing needs to import them.
const ENTRY = new Set(["Page", "Layout", "API route", "Screen", "Navigation layout", "Special screen", "Test", "Database migration",
  "Database query", "Script", "Config", "Eval", "Server entry", "Endpoint", "Sitemap", "robots.txt", "Not found page",
  "Loading screen", "Error screen", "Styles", "Generated file"]);
const CODE_EXT = /\.(ts|tsx|mts|js|jsx|mjs|cjs|astro|vue|svelte|py|go)$/;

// Hotspots: large files that change often (the top tenth by lines × changes in 90 days).
const hotspots = (() => {
  const scored = data.files.map((f, i) => [i, f.git ? f.lines * f.git.n90 : 0]).filter(([i, s]) => s && data.files[i].lines >= 150 && data.files[i].git.n90 >= 4);
  scored.sort((a, b) => b[1] - a[1]);
  return new Set(scored.slice(0, Math.max(1, Math.ceil(N * 0.05))).map(([i]) => i));
})();

// ---------- Summary (optional AI) --------------------------------------

let aiState = {};
function summarySection(i) {
  const f = data.files[i];
  const cfg = loadAI();
  const hasSource = typeof f.source === "string";
  const saved = hasSource ? cachedSummary(data.name, f.path, fingerprint(f.source)) : null;
  let body;
  if (aiState.busy === i) {
    body = `<p class="summary muted">Writing a summary…</p>`;
  } else if (saved) {
    body = `<p class="summary">${esc(saved.text)}</p><p class="by">Written by ${esc(PROVIDERS[saved.provider]?.name || "AI")} from the code` +
      (cfg ? ` <button class="link" type="button" data-ai-write="${i}">Rewrite</button>` : "") + `</p>`;
  } else if (!hasSource) {
    body = `<p class="muted">Summaries need the code, and this map was made without it.</p>`;
  } else if (cfg) {
    body = `<p class="muted">No summary yet.</p><div class="summary-actions"><button class="btn primary" type="button" data-ai-write="${i}">Write a summary</button></div>`;
  } else {
    body = `<p class="line">Add your own Claude or OpenAI key to get a few sentences on what each file does and why it's there.</p>` +
      `<p class="note">Your key stays in this browser. It isn't shared with anyone, not even with us.</p>` +
      `<div class="summary-actions"><button class="btn ghost" type="button" data-ai-setup>Add your key</button></div>`;
  }
  if (aiState.errorFor === i) body += `<p class="error">${esc(aiState.error)}</p>`;
  return `<section><h3>Summary</h3>${body}</section>`;
}

async function writeSummary(i) {
  const cfg = loadAI();
  if (!cfg) return openAI();
  const f = data.files[i];
  aiState = { busy: i };
  renderIf(i);
  try {
    const out = await summarize(cfg, promptFor(data.name, f, {
      uses: G.uses[i].map((x) => data.files[x].path),
      usedBy: G.usedBy[i].map((x) => data.files[x].path),
    }));
    if (!out.text) throw new Error("The model sent back no text. Try again, or another model.");
    keepSummary(data.name, f.path, { hash: fingerprint(f.source), text: out.text, provider: cfg.provider, model: out.model, at: Date.now() });
    aiState = {};
  } catch (e) {
    const msg = e instanceof TypeError ? `Couldn't reach ${PROVIDERS[cfg.provider].name}. Check your connection.` : e.message;
    aiState = { error: msg, errorFor: i };
  }
  renderIf(i);
}
const renderIf = (i) => { if (state.selected?.kind === "file" && state.selected.i === i) renderDetail(); };

const dlg = document.getElementById("ai-dialog");
const form = document.getElementById("ai-form");
function openAI() {
  const cfg = loadAI();
  form.elements.provider.value = cfg?.provider || "claude";
  form.elements.key.value = cfg?.key || "";
  form.elements.model.value = cfg?.model || PROVIDERS[form.elements.provider.value].model;
  document.getElementById("ai-remove").hidden = !cfg;
  document.getElementById("ai-error").hidden = true;
  dlg.showModal();
  form.elements.key.focus();
}
form.addEventListener("change", (ev) => {
  if (ev.target.name !== "provider") return;
  const model = form.elements.model;
  if (!model.value || Object.values(PROVIDERS).some((p) => p.model === model.value)) model.value = PROVIDERS[ev.target.value].model;
});
form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const key = form.elements.key.value.trim();
  if (!key) {
    const err = document.getElementById("ai-error");
    err.textContent = "Paste a key first.";
    err.hidden = false;
    return;
  }
  const provider = form.elements.provider.value;
  saveAI({ provider, key, model: form.elements.model.value.trim() || PROVIDERS[provider].model });
  dlg.close();
  afterAIChange();
});
document.getElementById("ai-cancel").addEventListener("click", () => dlg.close());
document.getElementById("ai-remove").addEventListener("click", () => { clearAI(); dlg.close(); afterAIChange(); });
function afterAIChange() {
  aiState = {};
  renderAIState();
  if (state.selected?.kind === "file") renderDetail();
}
function renderAIState() {
  const cfg = loadAI();
  const hasSource = data.files.some((f) => typeof f.source === "string");
  const btn = document.getElementById("ai-change");
  if (!hasSource) {
    document.getElementById("ai-state").textContent = "Off: this map was made without the code";
    btn.hidden = true;
  } else {
    document.getElementById("ai-state").textContent = cfg ? `${PROVIDERS[cfg.provider].name} · ${cfg.model}` : "Off";
    btn.textContent = cfg ? "Change" : "Add a key";
  }
}

// `code` and plain text from a comment or a doc.
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const day = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
function ago(t) {
  const d = Math.floor((Date.now() / 1000 - t) / 86400);
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return day(t);
}

function renderDetail() {
  const sel = state.selected;
  if (!sel) { detail.hidden = true; resize(); return; }
  let html = "";
  if (sel.kind === "file") {
    const i = sel.i;
    const f = data.files[i];
    const k = f.path.lastIndexOf("/");
    const byLines = (a, b) => data.files[b].lines - data.files[a].lines;
    const meta = [f.role ? esc(f.role) : null, f.route ? `<span class="route">${esc(f.route)}</span>` : null, `${fmt(f.lines)} lines`].filter(Boolean).join(" · ");
    html += `<header><p class="kicker">${esc(f.path.slice(0, k + 1) || "/")}</p><h2>${esc(f.path.slice(k + 1))}</h2>` +
      `<p class="meta">${meta}</p></header>`;

    html += summarySection(i);

    // Connections in words; an import cycle is said here.
    const ub = G.usedBy[i];
    const folders = new Set(ub.map((x) => dirOf(data.files[x].path))).size;
    let conn = `<p class="line">${connections(f, G.uses[i].length, ub.length, folders)}</p>`;
    if (G.cycleOf[i] >= 0) {
      const c = G.cycles[G.cycleOf[i]].filter((x) => x !== i);
      conn += `<p class="note warn">In an import cycle with ${plural(c.length, "file")}: changing one can break the others.</p>` +
        `<ul class="files">${c.slice(0, 6).map((x) => fileLink(x)).join("")}</ul>`;
    }
    html += `<section><h3>Connections</h3>${conn}</section>`;
    html += fileList("Uses", [...G.uses[i]].sort(byLines), "var(--uses)");
    html += fileList("Is used by", [...ub].sort(byLines), "var(--used-by)");

    if (f.git) {
      const g = f.git;
      html += `<section><h3>History</h3><dl class="facts">` +
        `<dt>Created</dt><dd>${day(g.first)}</dd>` +
        `<dt>Last changed</dt><dd>${ago(g.last)}<span class="msg">${esc(g.msg || "")}</span></dd>` +
        `<dt>Changes</dt><dd>${plural(g.n, "commit")}, ${g.n90 === g.n && g.n > 1 ? "all" : g.n90} in the last 90 days</dd>` +
        `<dt>People</dt><dd>${g.people}</dd></dl>` +
        (hotspots.has(i) ? `<p class="note warn">A hotspot: large and changing often.</p>` : f.lines > 600 ? `<p class="note">Long: a candidate to split.</p>` : "") +
        `</section>`;
    } else if (f.lines > 600) {
      html += `<section><h3>Size</h3><p class="note">Long: ${fmt(f.lines)} lines, a candidate to split.</p></section>`;
    }

    if (f.exports?.length) {
      html += `<section><h3>Exports <span class="n">${f.exports.length}</span></h3><p class="chips">` +
        f.exports.map(([name, kind]) => `<span title="${kind}"><i class="k-${kind}"></i>${esc(name)}</span>`).join("") + `</p></section>`;
    }
    if (G.pkgUses[i].length) {
      html += `<section><h3>Packages <span class="n">${G.pkgUses[i].length}</span></h3><p class="chips">${G.pkgUses[i].map((p) => `<button data-pkg="${p}">${esc(data.packages[p])}</button>`).join("")}</p></section>`;
    }
  } else if (sel.kind === "dir") {
    const d = sel.d;
    const inside = (k) => data.files[k].path.startsWith(sel.path + "/");
    const outTo = new Map();
    const inFrom = new Map();
    let internal = 0;
    const folder = (k) => {
      const p = data.files[k].path;
      return p.slice(0, p.lastIndexOf("/")) || "/";
    };
    for (const [a, b] of data.edges) {
      const ia = inside(a), ib = inside(b);
      if (ia && ib) internal++;
      else if (ia) outTo.set(folder(b), (outTo.get(folder(b)) || 0) + 1);
      else if (ib) inFrom.set(folder(a), (inFrom.get(folder(a)) || 0) + 1);
    }
    const rows = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([p, n]) => `<li><button data-dir="${esc(p)}"><span class="dir">${esc(p)}/&lrm;</span><span class="n">${n}</span></button></li>`);
    html += `<header><p class="kicker">Folder</p><h2>${esc(sel.path)}/</h2>` +
      `<p class="meta">${d.node.count} files · ${fmt(d.node.lines)} lines · ${internal} imports inside</p></header>`;
    html += list("Reaches out to", rows(outTo), "#4fb3ff", "Nothing outside this folder");
    html += list("Reached from", rows(inFrom), "#ff7a45", "Nothing outside this folder imports it");
    const biggest = [];
    for (let k = 0; k < N; k++) if (inside(k)) biggest.push(k);
    biggest.sort((a, b) => G.usedBy[b].length - G.usedBy[a].length || data.files[b].lines - data.files[a].lines);
    html += list("Most used here", biggest.slice(0, 8).map((x) => fileLink(x, `<span class="n">${G.usedBy[x].length}</span>`)));
  } else {
    const p = sel.i;
    html += `<header><p class="kicker">Package</p><h2>${esc(data.packages[p])}</h2><p class="meta">used by ${G.pkgUsedBy[p].length} files</p></header>`;
    html += list("Used by", G.pkgUsedBy[p].map((x) => fileLink(x)), "#ff7a45");
  }
  detail.querySelector(".body").innerHTML = html;
  detail.hidden = false;
  detail.querySelector(".body").scrollTop = 0;
  resize();
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.aiWrite !== undefined) writeSummary(+b.dataset.aiWrite);
  else if (b.hasAttribute("data-ai-setup")) openAI();
  else if (b.dataset.file) selectFile(+b.dataset.file);
  else if (b.dataset.dir) selectDir(b.dataset.dir);
  else if (b.dataset.pkg) select({ kind: "package", i: +b.dataset.pkg }, false);
});
$("close").addEventListener("click", () => select(null));

// Header, stats, insights.
const totalLines = data.files.reduce((s, f) => s + f.lines, 0);
$("repo").textContent = data.name;
$("meta").textContent = data.history
  ? `${plural(data.history.commits, "commit")} · ${plural(data.history.people, "person", "people")} · since ${new Date(data.history.first * 1000).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`
  : [data.commit, new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })].filter(Boolean).join(" · ");
$("stats").innerHTML = [
  [fmt(N), "files"], [fmt(totalLines), "lines"], [fmt(data.edges.length), "imports"], [fmt(data.packages.length), "packages"],
].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");

const renderInsights = () => {
  const ids = [...Array(N).keys()];
  const hubs = ids.filter((i) => G.usedBy[i].length).sort((a, b) => G.usedBy[b].length - G.usedBy[a].length).slice(0, 6);
  const big = [...ids].sort((a, b) => data.files[b].lines - data.files[a].lines).slice(0, 5);
  let html = list("Most used", hubs.map((i) => fileLink(i, `<span class="n">${G.usedBy[i].length}</span>`)), null, "No imports found");
  html += list("Largest", big.map((i) => fileLink(i, `<span class="n">${fmt(data.files[i].lines)}</span>`)));
  const moving = ids.filter((i) => data.files[i].git?.n90).sort((a, b) => data.files[b].git.n90 - data.files[a].git.n90).slice(0, 5);
  if (moving.length) html += list("Changed most in 90 days", moving.map((i) => fileLink(i, `<span class="n">${data.files[i].git.n90}</span>`)));
  html += `<section class="${G.cycles.length ? "warn" : ""}"><h3>Import cycles <span class="n">${G.cycles.length}</span></h3>` +
    (G.cycles.length
      ? `<ul class="files">${G.cycles.slice(0, 6).map((c) => fileLink(c[0], `<span class="n">${c.length} files</span>`)).join("")}</ul>`
      : `<p class="muted">None</p>`) + `</section>`;
  $("insights").innerHTML = html;
};
renderInsights();

// Areas legend / colour legend.
const renderLegend = () => {
  let items = [];
  if (state.mode === "area") {
    items = areas.slice(0, 10).map((a) => `<li><button data-dir="${esc(a.path)}"><i style="background:#${areaColor(a).getHexString()}"></i>${esc(a.name)}</button></li>`);
    if (data.files.some((f) => !areaOf(f.path))) items.push(`<li><span><i style="background:#${C.other.getHexString()}"></i>other files</span></li>`);
  } else if (state.mode === "type") {
    const seen = new Map();
    data.files.forEach((f) => { const e = extOf(f.path); seen.set(e, (seen.get(e) || 0) + 1); });
    items = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([e, n]) => `<li><span><i style="background:#${typeColor(e).getHexString()}"></i>${esc(e || "other")} <span class="n">${n}</span></span></li>`);
  } else {
    items = [`<li class="ramp"><span>0</span><i></i><span>${maxFanIn} files import it</span></li>`];
  }
  $("legend").innerHTML = items.join("");
};
renderLegend();

document.querySelectorAll("#colour button").forEach((b) => b.addEventListener("click", () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll("#colour button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  recolour();
  renderLegend();
  paintScene();
}));
for (const key of ["lines", "packages", "labels"]) {
  $(`show-${key}`).addEventListener("change", (ev) => { state[key] = ev.target.checked; paintScene(); });
}
$("home").addEventListener("click", () => { select(null); home(); });

// Light / After hours: the Eclipse switch overrides the system and is remembered (same key as Studio G's sites).
function applyTheme() {
  readTheme();
  light();
  scene.fog.color.copy(C.canvas);
  allLines.material.opacity = C.dark ? 0.22 : 0.32;
  paintAllLines();
  recolour();
  paintLabels();
  renderLegend();
  paintScene();
}
$("theme").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("sg-theme", next); } catch {}
  applyTheme();
});
const picker = initPicker();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!document.documentElement.getAttribute("data-theme")) applyTheme();
});
renderAIState();

// Search.
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
    if (first) selectFile(+first.dataset.file);
  }
  if (ev.key === "Escape") { search.value = ""; runSearch(); search.blur(); }
});
document.addEventListener("keydown", (ev) => {
  if (ev.target.closest("input") || dlg.open) return;
  if (ev.key === "/") { ev.preventDefault(); search.focus(); }
  if (ev.key === "p" && window.ATLAS_SERVER) { ev.preventDefault(); picker.open(); }
  if (ev.key === "Escape") select(null);
  if (ev.key === "h") { select(null); home(); }
});

// ---------- Loop -------------------------------------------------------

// Keeps the picture centred in the space between the panels.
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  const wide = w > 760;
  const shift = wide ? (324 - (detail.hidden ? 0 : 352)) / 2 : 0;
  const full = w + Math.abs(shift) * 2;
  if (shift) camera.setViewOffset(full, h, shift < 0 ? -shift * 2 : 0, 0, w, h);
  else camera.clearViewOffset();
  camera.aspect = full / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
paintScene();
home(true);

const ease = (t) => 1 - Math.pow(1 - t, 3);
renderer.setAnimationLoop((now) => {
  if (flight) {
    const t = Math.min(1, (now - flight.t0) / 700);
    const e = ease(t);
    controls.target.lerpVectors(flight.fromT, flight.toT, e);
    camera.position.lerpVectors(flight.fromP, flight.toP, e);
    if (t === 1) flight = null;
  }
  controls.update();
  updateHover();
  renderer.render(scene, camera);
  placeFloating();
});
window.__atlas = { select, selectFile, selectDir, state, camera, controls, home };

// ---------- Helpers ----------------------------------------------------

function fmt(n) {
  return n.toLocaleString("en");
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
