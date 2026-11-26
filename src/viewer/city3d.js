// The city in 3D: folder plates, file buildings, package towers, and the folder names painted on the plates
// (plus a floating label for each area).
import * as THREE from "three";
import { PLATE } from "./city.js";
import { esc, fmt } from "./util.js";

export function createCity3d(app) {
  const { data, G, city, N } = app;
  const { scene, camera, canvas } = app.view;
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const m4 = new THREE.Matrix4();

  // Folders: one plate per level.
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

  // Files: one building each.
  const towers = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), N);
  city.buildings.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d).setPosition(b.x + b.w / 2, b.y, b.z + b.d / 2);
    towers.setMatrixAt(i, m4);
  });
  scene.add(towers);

  // Packages: round towers, taller when more files use them.
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

  // Where import lines start and end: the top of a building or a package.
  const top = (i) => {
    const b = city.buildings[i];
    return new THREE.Vector3(b.x + b.w / 2, b.y + b.h, b.z + b.d / 2);
  };
  const pkgTop = (p) => {
    const it = city.packages.items[p];
    return new THREE.Vector3(it.x, PLATE + it.h, it.z);
  };

  // The areas' names float on screen, above the city.
  const labelGroup = new THREE.Group();
  scene.add(labelGroup);
  const areaPaths = new Set(app.palette.areas.map((a) => a.path));
  // Biggest folders first: when two names would overlap, the smaller folder's name is left out until there's room.
  const order = new Map(app.palette.areas.map((a, i) => [a.path, i]));
  const floating = city.districts.filter((d) => areaPaths.has(d.path)).sort((a, b) => order.get(a.path) - order.get(b.path)).map((d) => {
    const el = document.createElement("div");
    el.className = "area";
    el.innerHTML = `<button data-dir="${esc(d.path)}" title="${esc(d.path)}">${esc(d.name)}</button>`;
    document.getElementById("areas").append(el);
    return { el, at: new THREE.Vector3(d.x + d.pad, d.top, d.z + d.d - d.pad * 0.5), size: null };
  });
  // Each name's size, measured once (again when the screen or the font changes).
  const measure = () => { for (const f of floating) f.size = null; };
  addEventListener("resize", measure);
  document.fonts?.ready.then(measure);
  const v3 = new THREE.Vector3();
  const placeFloating = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const taken = [];
    for (const f of floating) {
      v3.copy(f.at).project(camera);
      let off = v3.z > 1 || !app.state.labels;
      if (!off) {
        const x = ((v3.x + 1) / 2) * w;
        const y = ((1 - v3.y) / 2) * h;
        if (!f.size) {
          f.el.hidden = false;
          const b = f.el.firstElementChild;
          f.size = [b.offsetWidth, b.offsetHeight];
        }
        const r = [x - 2, y + 6, x - 2 + f.size[0], y + 6 + f.size[1]]; // where the button sits (its CSS nudge)
        off = taken.some((t) => r[0] < t[2] + 4 && r[2] + 4 > t[0] && r[1] < t[3] + 2 && r[3] + 2 > t[1]);
        if (!off) {
          taken.push(r);
          f.el.style.transform = `translate(${x}px, ${y}px)`;
        }
      }
      f.el.hidden = off;
    }
  };

  // Every folder's name, painted flat on its plate (redone when the theme changes).
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
    const track = (s) => { if ("letterSpacing" in g) g.letterSpacing = `${(s * 0.08).toFixed(1)}px`; };
    g.font = font(fs);
    track(fs);
    const main = text.toUpperCase();
    const subW = sub ? g.measureText("   " + sub).width * 0.7 : 0;
    while (fs > 8 && g.measureText(main).width + subW > cw * 0.96) {
      fs *= 0.9;
      g.font = font(fs);
      track(fs);
    }
    g.fillStyle = "#" + app.C.ink.getHexString();
    g.textBaseline = "middle";
    g.fillText(main, cw * 0.01, ch * 0.52);
    if (sub) {
      const mw = g.measureText(main).width;
      g.font = font(fs * 0.7, 500);
      if ("letterSpacing" in g) g.letterSpacing = "0px";
      g.fillStyle = "#" + app.C.muted.getHexString();
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
  const paintLabels = () => {
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
  };
  paintLabels();
  // Repaint once Inter has loaded (the first paint may have used the fallback font).
  document.fonts?.ready.then(paintLabels);

  return { plates, towers, pkgMesh, pkgGroup, labelGroup, top, pkgTop, paintLabels, placeFloating };
}
