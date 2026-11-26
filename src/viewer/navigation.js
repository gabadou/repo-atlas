// Moving around, like Studio G's office: scroll moves across the city, pinch (or Ctrl/⌘ + scroll) zooms
// at the pointer, drag turns the view. Right-drag also moves (for a mouse), arrow keys move, + and − zoom.
// Plus the camera flights: home, and framing a file or a folder.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { reducedMotion, typing } from "./util.js";

const UP = new THREE.Vector3(0, 1, 0);
const GROUND = new THREE.Plane(UP, 0);

export function createNavigation(app) {
  const { camera, canvas, size } = app.view;
  const fog = app.view.scene.fog;
  const { city } = app;

  // Drag turns (left button, one finger); right-drag and two fingers move across the ground.
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 3;
  controls.maxDistance = size * 4;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true; // a touch pinch, which OrbitControls still handles

  let flight = null;
  const stop = () => { flight = null; };
  canvas.addEventListener("pointerdown", stop);

  const distance = () => camera.position.distanceTo(controls.target);

  // Moves camera and target together across the ground, by screen pixels.
  const panBy = (dx, dy) => {
    const perPixel = (2 * distance() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvas.clientHeight;
    const forward = controls.target.clone().sub(camera.position).setY(0);
    if (forward.lengthSq() < 1e-9) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
    const move = right.multiplyScalar(dx * perPixel).addScaledVector(forward, -dy * perPixel);
    // Don't drift off into the void: the target stays near the city.
    const b = city.bounds;
    const margin = size * 0.6;
    const next = controls.target.clone().add(move);
    next.x = THREE.MathUtils.clamp(next.x, b.x - margin, b.x + b.w + margin + (city.packages ? city.packages.w : 0));
    next.z = THREE.MathUtils.clamp(next.z, b.z - margin, b.z + b.d + margin);
    move.subVectors(next, controls.target);
    controls.target.add(move);
    camera.position.add(move);
  };

  // Zooms by factor (< 1 closer), keeping the ground point under (x, y) where it is on screen.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const zoomAt = (clientX, clientY, factor) => {
    const d = distance();
    const next = THREE.MathUtils.clamp(d * factor, controls.minDistance, controls.maxDistance);
    factor = next / d;
    if (Math.abs(factor - 1) < 1e-4) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const pivot = ray.ray.intersectPlane(GROUND, new THREE.Vector3()) || controls.target.clone();
    camera.position.sub(pivot).multiplyScalar(factor).add(pivot);
    controls.target.sub(pivot).multiplyScalar(factor).add(pivot);
  };

  // Trackpads send a pinch as a wheel event with ctrlKey set (Chrome, Firefox, Edge); Safari sends gesture events.
  // Ours runs first (capture, on the window) so OrbitControls never sees the wheel.
  addEventListener("wheel", (ev) => {
    if (ev.target !== canvas) return;
    ev.preventDefault();
    ev.stopPropagation();
    stop();
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? canvas.clientHeight : 1;
    const dx = ev.deltaX * unit;
    const dy = ev.deltaY * unit;
    if (ev.ctrlKey || ev.metaKey) zoomAt(ev.clientX, ev.clientY, Math.exp(dy * 0.01));
    else panBy(dx, dy);
  }, { passive: false, capture: true });

  let gesture = 1;
  canvas.addEventListener("gesturestart", (ev) => { ev.preventDefault(); stop(); gesture = 1; });
  canvas.addEventListener("gesturechange", (ev) => {
    ev.preventDefault();
    zoomAt(ev.clientX, ev.clientY, gesture / ev.scale);
    gesture = ev.scale;
  });
  canvas.addEventListener("gestureend", (ev) => ev.preventDefault());

  addEventListener("keydown", (ev) => {
    if (typing(ev) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const step = 80;
    const centre = () => {
      const r = canvas.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    };
    const keys = {
      ArrowLeft: () => panBy(-step, 0),
      ArrowRight: () => panBy(step, 0),
      ArrowUp: () => panBy(0, -step),
      ArrowDown: () => panBy(0, step),
      "+": () => zoomAt(...centre(), 0.8),
      "=": () => zoomAt(...centre(), 0.8),
      "-": () => zoomAt(...centre(), 1.25),
      _: () => zoomAt(...centre(), 1.25),
    };
    if (keys[ev.key]) {
      ev.preventDefault();
      stop();
      keys[ev.key]();
    }
  });

  // ---------- Flights ----------

  const fly = (toT, toP, now) => {
    if (now || reducedMotion()) {
      controls.target.copy(toT);
      camera.position.copy(toP);
      flight = null;
    } else {
      flight = { t0: performance.now(), fromT: controls.target.clone(), fromP: camera.position.clone(), toT, toP };
    }
  };
  const fitDistance = (r) => r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // To a target, from the current direction (never lower than a third of the way up).
  const flyTo = (target, dist, now = false) => {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.8, 1);
    dir.normalize();
    if (dir.y < 0.6) { dir.y = 0.6; dir.normalize(); }
    fly(target, target.clone().add(dir.multiplyScalar(dist)), now);
  };

  // The whole city, seen from the front, a little to the left.
  const home = (now) => {
    const b = city.bounds;
    const extra = city.packages && app.state.packages ? city.packages.w + 4 : 0;
    if (portrait()) return homePortrait(now, b);
    const c = new THREE.Vector3(b.x + (b.w + extra) / 2, 0, 0);
    const dist = (fitDistance(Math.hypot(b.w + extra, b.d) / 2) * 0.9) / Math.min(1, camera.aspect);
    fly(c, c.clone().add(new THREE.Vector3(-0.12, 0.62, 0.78).normalize().multiplyScalar(dist)), now);
  };
  // On a tall, narrow screen (a phone): from higher up, so the city's depth fills the height, and as close as it
  // can be with every corner of the city (packages included) still in the picture.
  const portrait = () => camera.aspect < 0.8;
  const homePortrait = (now, b) => {
    const tall = city.buildings.reduce((m, k) => Math.max(m, k.y + k.h), 0);
    // The packages' district may run off to the right: the city itself is what has to fit.
    const x0 = b.x, x1 = b.x + b.w, z0 = b.z, z1 = b.z + b.d;
    const corners = [];
    for (const x of [x0, x1]) for (const y of [0, tall]) for (const z of [z0, z1]) corners.push(new THREE.Vector3(x, y, z));
    const c = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const dir = new THREE.Vector3(-0.12, 0.86, 0.5).normalize();
    const was = { p: camera.position.clone(), q: camera.quaternion.clone() };
    const fits = (dist) => {
      camera.position.copy(c).addScaledVector(dir, dist);
      camera.lookAt(c);
      camera.updateMatrixWorld();
      return corners.every((k) => { const v = k.clone().project(camera); return Math.abs(v.x) <= 0.96 && Math.abs(v.y) <= 0.9 && v.z < 1; });
    };
    let lo = controls.minDistance, hi = size * 6;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    camera.position.copy(was.p);
    camera.quaternion.copy(was.q);
    camera.updateMatrixWorld();
    fly(c, c.clone().addScaledVector(dir, hi), now);
  };

  // A file with everything it uses and everything that uses it, leaning towards the file itself.
  const frameFile = (i) => {
    const { G } = app;
    const box = new THREE.Box3();
    for (const k of [i, ...G.uses[i], ...G.usedBy[i]]) {
      const b = city.buildings[k];
      box.expandByPoint(new THREE.Vector3(b.x, b.y, b.z));
      box.expandByPoint(new THREE.Vector3(b.x + b.w, b.y + b.h, b.z + b.d));
    }
    const b = city.buildings[i];
    const c = box.getCenter(new THREE.Vector3()).lerp(new THREE.Vector3(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2), 0.35);
    flyTo(c, Math.max(24, fitDistance(box.getSize(new THREE.Vector3()).length() / 2) * 0.85) / Math.min(1, camera.aspect * 1.6));
  };

  const frameDir = (d) => {
    flyTo(new THREE.Vector3(d.x + d.w / 2, d.top + 2, d.z + d.d / 2), Math.max(30, fitDistance(Math.hypot(d.w, d.d) / 2) * 1.7) / Math.min(1, camera.aspect * 1.6));
  };

  // Called every frame.
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const update = (now) => {
    if (flight) {
      const t = Math.min(1, (now - flight.t0) / 700);
      controls.target.lerpVectors(flight.fromT, flight.toT, ease(t));
      camera.position.lerpVectors(flight.fromP, flight.toP, ease(t));
      if (t === 1) flight = null;
    }
    controls.update();
    const d = distance();
    fog.near = Math.max(size * 1.8, d * 1.1);
    fog.far = Math.max(size * 4.5, d * 2.8);
  };

  return { controls, update, home, frameFile, frameDir };
}
