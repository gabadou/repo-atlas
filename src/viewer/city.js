// Lays the repo out as a city: folders are districts (raised plates, nested),
// files are buildings (footprint and height grow with lines of code).

export const PLATE = 0.35; // thickness of one folder level

export const fileWeight = (lines) => 1 + Math.sqrt(Math.min(lines, 4000)) / 3;
// Past 1,500 lines a building only grows a little more, so one vendored file doesn't dwarf the city.
export const fileHeight = (lines) =>
  0.4 + Math.pow(Math.min(lines, 1500), 0.6) * 0.25 + (lines > 1500 ? Math.log2(lines / 1500) * 2.5 : 0);

export function buildTree(files) {
  const root = { name: "", path: "", dirs: new Map(), files: [] };
  files.forEach((f, i) => {
    const parts = f.path.split("/");
    let node = root;
    for (const p of parts.slice(0, -1)) {
      if (!node.dirs.has(p)) {
        node.dirs.set(p, { name: p, path: node.path ? `${node.path}/${p}` : p, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(p);
    }
    node.files.push(i);
  });
  // A folder holding only one folder becomes "a/b".
  const collapse = (node) => {
    for (const [key, child] of [...node.dirs]) {
      let c = child;
      while (!c.files.length && c.dirs.size === 1) {
        const only = [...c.dirs.values()][0];
        c = { ...only, name: `${c.name}/${only.name}` };
      }
      node.dirs.delete(key);
      node.dirs.set(c.name, c);
      collapse(c);
    }
  };
  collapse(root);
  const weigh = (node) => {
    let w = 0;
    let lines = 0;
    let count = 0;
    for (const i of node.files) {
      w += fileWeight(files[i].lines);
      lines += files[i].lines;
      count++;
    }
    for (const d of node.dirs.values()) {
      weigh(d);
      w += d.weight;
      lines += d.lines;
      count += d.count;
    }
    node.weight = w * 1.18 + 3;
    node.lines = lines;
    node.count = count;
  };
  weigh(root);
  return root;
}

export function layout(data, root) {
  const districts = [];
  const buildings = new Array(data.files.length);
  const side = Math.sqrt(root.weight) * 1.45;
  const W = side * 1.2;
  const D = side / 1.2;

  const place = (node, x, z, w, d, depth, top) => {
    const min = Math.min(w, d);
    const pad = Math.min(0.9, Math.max(0.15, min * 0.035));
    const label = depth <= 4 && w > 3 && d > 2.6 ? Math.min(depth <= 1 ? 3.4 : 2.2, Math.max(0.75, min * (depth <= 1 ? 0.1 : 0.08))) : 0;
    const district = {
      node, path: node.path, name: node.name || data.name, depth, x, z, w, d,
      y: depth * PLATE, top: (depth + 1) * PLATE, label, pad, top0: top,
    };
    districts.push(district);

    const ix = x + pad;
    const iz = z + pad;
    const iw = Math.max(0.01, w - pad * 2);
    const id = Math.max(0.01, d - pad * 2 - label);
    const items = [
      ...[...node.dirs.values()].map((dir) => ({ dir, weight: dir.weight })),
      ...node.files.map((i) => ({ file: i, weight: fileWeight(data.files[i].lines) })),
    ];
    for (const r of squarify(items, ix, iz, iw, id)) {
      if (r.item.dir) {
        place(r.item.dir, r.x, r.z, r.w, r.d, depth + 1, top);
      } else {
        const i = r.item.file;
        const gap = Math.min(0.35, Math.min(r.w, r.d) * 0.16);
        const h = fileHeight(data.files[i].lines);
        buildings[i] = {
          x: r.x + gap, z: r.z + gap, w: Math.max(0.05, r.w - gap * 2), d: Math.max(0.05, r.d - gap * 2),
          y: (depth + 1) * PLATE, h, district,
        };
      }
    }
  };
  place(root, -W / 2, -D / 2, W, D, 0);

  // Packages: a district of round towers beside the city, sized by how many files use them.
  const pk = data.packages.length;
  let packages = null;
  if (pk) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(pk * (D / Math.max(8, W * 0.35)))));
    const rows = Math.ceil(pk / cols);
    const cell = Math.min(3.2, Math.max(1.6, (D * 0.8) / Math.max(rows, 1)));
    const pw = cols * cell + 1.6;
    const pd = rows * cell + 1.6 + 1.6;
    const px = W / 2 + Math.max(4, W * 0.06);
    const pz = D / 2 - pd;
    packages = { x: px, z: pz, w: pw, d: pd, y: 0, top: PLATE, label: 1.4, cell, items: [] };
    data.packages.forEach((name, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      packages.items.push({ i, name, x: px + 0.8 + c * cell + cell / 2, z: pz + 0.8 + r * cell + cell / 2, r: cell * 0.26 });
    });
  }

  return { districts, buildings, packages, bounds: { x: -W / 2, z: -D / 2, w: W, d: D } };
}

// Squarified treemap (Bruls, Huizing, van Wijk).
export function squarify(items, x, z, w, d) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  if (!total || w <= 0 || d <= 0) return [];
  const scale = (w * d) / total;
  const nodes = items.map((item) => ({ item, a: item.weight * scale })).sort((p, q) => q.a - p.a);
  const out = [];
  let row = [];
  let rx = x, rz = z, rw = w, rd = d;

  const worst = (r, s) => {
    let sum = 0, max = 0, min = Infinity;
    for (const n of r) {
      sum += n.a;
      if (n.a > max) max = n.a;
      if (n.a < min) min = n.a;
    }
    const s2 = s * s, sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  };
  const flush = () => {
    const sum = row.reduce((s, n) => s + n.a, 0);
    if (rw >= rd) {
      const cw = sum / rd;
      let cz = rz;
      for (const n of row) {
        const h = n.a / cw;
        out.push({ item: n.item, x: rx, z: cz, w: cw, d: h });
        cz += h;
      }
      rx += cw;
      rw -= cw;
    } else {
      const ch = sum / rw;
      let cx = rx;
      for (const n of row) {
        const ww = n.a / ch;
        out.push({ item: n.item, x: cx, z: rz, w: ww, d: ch });
        cx += ww;
      }
      rz += ch;
      rd -= ch;
    }
    row = [];
  };

  let i = 0;
  while (i < nodes.length) {
    const s = Math.min(rw, rd);
    if (!row.length || worst([...row, nodes[i]], s) <= worst(row, s)) {
      row.push(nodes[i]);
      i++;
    } else flush();
  }
  if (row.length) flush();
  return out;
}
