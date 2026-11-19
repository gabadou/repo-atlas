// What the import graph says: who uses whom, hubs, cycles.
export function analyse(data) {
  const n = data.files.length;
  const uses = Array.from({ length: n }, () => []);
  const usedBy = Array.from({ length: n }, () => []);
  for (const [a, b] of data.edges) {
    uses[a].push(b);
    usedBy[b].push(a);
  }
  const pkgUses = Array.from({ length: n }, () => []);
  const pkgUsedBy = data.packages.map(() => []);
  for (const [a, p] of data.packageEdges) {
    pkgUses[a].push(p);
    pkgUsedBy[p].push(a);
  }

  const cycles = stronglyConnected(n, uses).filter((c) => c.length > 1);
  cycles.sort((a, b) => b.length - a.length);
  const cycleOf = new Int32Array(n).fill(-1);
  cycles.forEach((c, i) => c.forEach((f) => (cycleOf[f] = i)));

  return { uses, usedBy, pkgUses, pkgUsedBy, cycles, cycleOf };
}

// Tarjan, iterative (deep repos overflow the recursive one).
function stronglyConnected(n, adj) {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack = [];
  const out = [];
  let counter = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work = [[s, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      if (i === 0) {
        index[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = 1;
      }
      if (i < adj[v].length) {
        frame[1]++;
        const w = adj[v][i];
        if (index[w] === -1) work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) {
        const u = work[work.length - 1][0];
        low[u] = Math.min(low[u], low[v]);
      }
      if (low[v] === index[v]) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          onStack[w] = 0;
          comp.push(w);
        } while (w !== v);
        out.push(comp);
      }
    }
  }
  return out;
}
