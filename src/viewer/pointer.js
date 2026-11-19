// What's under the pointer: a tooltip on hover, a selection on click (a click is a press that didn't move).
import * as THREE from "three";
import { esc, fmt } from "./util.js";

export function createPointer(app) {
  const { data, G, city, state } = app;
  const { canvas, camera } = app.view;
  const tip = document.getElementById("tip");
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pending = null;

  const hit = (ev) => {
    const { towers, plates, pkgMesh } = app.city3d;
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
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

  let down = null;
  canvas.addEventListener("pointermove", (ev) => { pending = ev; });
  canvas.addEventListener("pointerleave", () => { pending = null; tip.hidden = true; });
  canvas.addEventListener("pointerdown", (ev) => { down = [ev.clientX, ev.clientY]; });
  canvas.addEventListener("pointerup", (ev) => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5 || ev.button !== 0) return;
    app.panel.select(hit(ev), true);
  });

  // Called every frame: one raycast at most, for the last pointer move.
  const update = () => {
    if (!pending) return;
    const ev = pending;
    pending = null;
    const hover = hit(ev);
    if (!hover) {
      tip.hidden = true;
      canvas.style.cursor = "";
      return;
    }
    canvas.style.cursor = "pointer";
    if (hover.kind === "file") {
      const f = data.files[hover.i];
      const what = [f.role, f.route].filter(Boolean).join(" ");
      tip.innerHTML = `<b>${esc(f.path)}</b>${what ? `<span class="role">${esc(what)}</span>` : ""}` +
        `<span>${fmt(f.lines)} lines · uses ${G.uses[hover.i].length} · used by ${G.usedBy[hover.i].length}</span>`;
    } else if (hover.kind === "dir") {
      tip.innerHTML = `<b>${esc(hover.path)}/</b><span>${hover.d.node.count} files · ${fmt(hover.d.node.lines)} lines</span>`;
    } else {
      tip.innerHTML = `<b>${esc(data.packages[hover.i])}</b><span>package · used by ${G.pkgUsedBy[hover.i].length} files</span>`;
    }
    tip.hidden = false;
    const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
    const y = Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  };

  return { update };
}
