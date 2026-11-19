// Colours the city for the current state: the colour mode, the selection (what it uses and what uses it
// stay bright, the rest fades), and what's shown.
import { dim, emphasize } from "./colours.js";

export function createPainter(app) {
  const { data, G, city, N, state } = app;
  let base = [];

  // The buildings' own colours, for the current mode and theme.
  const recolour = () => {
    base = Array.from({ length: N }, (_, i) => app.palette.fileColor(i, state.mode));
  };

  const paint = () => {
    const { towers, plates, pkgMesh, pkgGroup, labelGroup, top, pkgTop } = app.city3d;
    const C = app.C;
    const sel = state.selected;
    let focus = null; // files that stay bright
    let pkgFocus = null;
    const lines = [];

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
        const ia = inside(a);
        const ib = inside(b);
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
      let c = base[i];
      if (focus && !focus.has(i)) c = dim(c, C);
      if (sel?.kind === "file" && sel.i === i) c = emphasize(c, C);
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
        if (pkgFocus && !pkgFocus.has(p)) c = dim(c, C);
        if (sel?.kind === "package" && sel.i === p) c = emphasize(C.sig, C);
        pkgMesh.setColorAt(p, c);
      });
      pkgMesh.instanceColor.needsUpdate = true;
    }

    app.lines.set(app.lines.focus, lines);
    app.lines.all.visible = state.lines && !sel;
    app.lines.focus.visible = !!sel;
    pkgGroup.visible = state.packages;
    labelGroup.visible = state.labels;
  };

  return { recolour, paint };
}
