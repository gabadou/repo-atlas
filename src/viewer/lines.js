// Import lines: arcs from the importer (orange end) to the imported file (blue end). All of them, faint,
// when nothing is selected; the selection's own lines, bright, when something is.
import * as THREE from "three";

const SEG = 18;

// A quadratic arc from a to b, rising with the distance, as line segments coloured from ca to cb.
function arc(a, b, pos, col, ca, cb) {
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
}

export function createLines(app) {
  const { scene } = app.view;
  const mesh = (opacity) => {
    const l = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false }),
    );
    l.frustumCulled = false;
    scene.add(l);
    return l;
  };
  const all = mesh(0.3);
  const focus = mesh(0.95);

  // list: [from, to, colour at from, colour at to]
  const set = (lines, list) => {
    const pos = [];
    const col = [];
    for (const [a, b, ca, cb] of list) arc(a, b, pos, col, ca, cb);
    lines.geometry.dispose();
    lines.geometry = new THREE.BufferGeometry();
    lines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    lines.geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  };

  // Every import, redone when the theme changes.
  const paintAll = () => {
    const { top } = app.city3d;
    all.material.opacity = app.C.dark ? 0.22 : 0.32;
    set(all, app.data.edges.map(([a, b]) => [top(a), top(b), app.C.usedBy, app.C.uses]));
  };

  return { all, focus, set, paintAll };
}
