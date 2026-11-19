// The renderer, the camera and the lights. The canvas is transparent: the page's dotted canvas shows through.
import * as THREE from "three";

const LEFT_PANEL = 324;
const RIGHT_PANEL = 352;

export function createScene(app) {
  const { city } = app;
  const canvas = document.getElementById("scene");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const size = Math.max(city.bounds.w, city.bounds.d) + (city.packages ? city.packages.w : 0);
  scene.fog = new THREE.Fog(app.C.canvas, size * 1.8, size * 4.5);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, size * 20);

  const hemi = new THREE.HemisphereLight("#ffffff", "#808080", 1.6);
  const sun = new THREE.DirectionalLight("#ffffff", 1.6);
  sun.position.set(-0.6, 1, 0.45);
  scene.add(hemi, sun);

  // Light and fog follow the theme.
  const applyTheme = () => {
    hemi.intensity = app.C.dark ? 1.5 : 1.75;
    sun.intensity = app.C.dark ? 1.5 : 1.25;
    hemi.groundColor.set(app.C.dark ? "#3a3a3a" : "#9a9a9a");
    scene.fog.color.copy(app.C.canvas);
  };
  applyTheme();

  // Keeps the picture centred in the space between the panels.
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    const rightOpen = !document.getElementById("detail").hidden;
    const shift = w > 760 ? (LEFT_PANEL - (rightOpen ? RIGHT_PANEL : 0)) / 2 : 0;
    const full = w + Math.abs(shift) * 2;
    if (shift) camera.setViewOffset(full, h, shift < 0 ? -shift * 2 : 0, 0, w, h);
    else camera.clearViewOffset();
    camera.aspect = full / h;
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", resize);

  return { canvas, renderer, scene, camera, size, resize, applyTheme };
}
