// engine/wfc/collapse.js
// Wave function collapse over a coarse grid of 3x3x3 cells.
//
// Standard shape: every cell starts holding every variant its band allows, the
// skeleton's boundary conditions are applied before anything is chosen, the
// lowest-entropy cell is collapsed to one variant by weight, and the
// consequences are propagated until the wave is stable again. Repeat until
// nothing is left undecided.
//
// Entropy is maintained incrementally - sum of weights and sum of w log w per
// cell, updated as variants are struck out - because recomputing it over the
// whole wave on every step is what turns a second into a minute.
//
// Propagation is arc consistency in six directions. For a cell that changed,
// the union of everything its remaining variants permit in direction d is
// intersected into the neighbour there. The union is built with an early exit:
// once it admits everything, the neighbour cannot lose anything, so the whole
// edge is skipped. That exit is what keeps large open rooms cheap, since an
// open room is mostly cells that still allow nearly everything.
//
// A contradiction - some cell left with no variant at all - is thrown, caught
// by solve(), and answered by restarting THIS REGION with a fresh seed, up to a
// cap. It never restarts the whole build and it never loops forever: past the
// cap the region is reported as failed and the rest of the build carries on.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Contradiction extends Error {
  constructor(cell) {
    super(`contradiction at cell ${cell}`);
    this.name = 'Contradiction';
    this.cell = cell;
  }
}

/**
 * One attempt.
 * @param {object} opts
 *   dims       [nx, ny, nz] of the coarse grid
 *   active     Uint8Array(n), 1 where the wave is allowed to place something
 *   allowed    Uint8Array(n * m), the starting domains (band and boundary
 *              already applied)
 *   weights    Float64Array(m)
 *   adj        adj[d][variant] -> Uint8Array(m)
 *   rng        () => [0,1)
 * @returns {{result:Int32Array, steps:number, propagations:number}}
 */
export function runWave(opts) {
  const [nx, ny, nz] = opts.dims;
  const n = nx * ny * nz;
  const m = opts.weights.length;
  const { active, adj, weights, rng } = opts;
  const dom = Uint8Array.from(opts.allowed);

  const count = new Int32Array(n);
  const sumW = new Float64Array(n);
  const sumWLog = new Float64Array(n);
  const wLog = new Float64Array(m);
  for (let k = 0; k < m; k++) wLog[k] = weights[k] * Math.log(weights[k]);

  for (let i = 0; i < n; i++) {
    if (!active[i]) continue;
    let c = 0, s = 0, sl = 0;
    const base = i * m;
    for (let k = 0; k < m; k++) {
      if (dom[base + k]) { c++; s += weights[k]; sl += wLog[k]; }
    }
    if (c === 0) throw new Contradiction(i);
    count[i] = c; sumW[i] = s; sumWLog[i] = sl;
  }

  const result = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const queued = new Uint8Array(n);
  let qHead = 0, qTail = 0, qLen = 0;
  let propagations = 0;

  const push = (i) => {
    if (queued[i]) return;
    queued[i] = 1;
    queue[qTail] = i;
    qTail = (qTail + 1) % n;
    qLen++;
  };

  const remove = (i, k) => {
    const at = i * m + k;
    if (!dom[at]) return false;
    dom[at] = 0;
    count[i]--;
    sumW[i] -= weights[k];
    sumWLog[i] -= wLog[k];
    if (count[i] === 0) throw new Contradiction(i);
    return true;
  };

  const union = new Uint8Array(m);

  function propagate() {
    while (qLen > 0) {
      const i = queue[qHead];
      qHead = (qHead + 1) % n;
      qLen--;
      queued[i] = 0;
      propagations++;

      const z = i % nz;
      const rest = (i - z) / nz;
      const y = rest % ny;
      const x = (rest - y) / ny;

      for (let d = 0; d < 6; d++) {
        const jx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const jy = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
        const jz = z + (d === 4 ? 1 : d === 5 ? -1 : 0);
        if (jx < 0 || jy < 0 || jz < 0 || jx >= nx || jy >= ny || jz >= nz) continue;
        const j = (jx * ny + jy) * nz + jz;
        if (!active[j]) continue;

        // Union of what cell i permits in direction d, with an early exit.
        union.fill(0);
        let ones = 0;
        const table = adj[d];
        const base = i * m;
        for (let k = 0; k < m && ones < m; k++) {
          if (!dom[base + k]) continue;
          const row = table[k];
          for (let t = 0; t < m; t++) {
            if (row[t] && !union[t]) { union[t] = 1; ones++; }
          }
        }
        if (ones >= m) continue;              // neighbour cannot lose anything

        const jb = j * m;
        let changed = false;
        for (let t = 0; t < m; t++) {
          if (dom[jb + t] && !union[t]) changed = remove(j, t) || changed;
        }
        if (changed) push(j);
      }
    }
  }

  // Seed the queue with every active cell so the boundary conditions spread.
  for (let i = 0; i < n; i++) if (active[i]) push(i);
  propagate();

  let steps = 0;
  for (;;) {
    // Lowest entropy, ties broken by noise so the build is not combed in a
    // raster order.
    let best = -1, bestE = Infinity;
    for (let i = 0; i < n; i++) {
      if (!active[i] || count[i] <= 1) continue;
      const e = Math.log(sumW[i]) - sumWLog[i] / sumW[i] + rng() * 1e-6;
      if (e < bestE) { bestE = e; best = i; }
    }
    if (best < 0) break;

    let r = rng() * sumW[best];
    let chosen = -1;
    const base = best * m;
    for (let k = 0; k < m; k++) {
      if (!dom[base + k]) continue;
      r -= weights[k];
      if (r <= 0) { chosen = k; break; }
      chosen = k;
    }
    for (let k = 0; k < m; k++) if (k !== chosen) remove(best, k);
    push(best);
    steps++;
    propagate();
  }

  for (let i = 0; i < n; i++) {
    if (!active[i]) continue;
    const base = i * m;
    for (let k = 0; k < m; k++) if (dom[base + k]) { result[i] = k; break; }
  }
  return { result, steps, propagations };
}

/**
 * Run a region, retrying on contradiction with a fresh seed each time.
 * @returns {{ok:boolean, result:?Int32Array, attempts:number, steps:number,
 *            failure:?string}}
 */
export function solve(opts) {
  const retries = opts.retries === undefined ? 8 : opts.retries;
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const rng = mulberry32((opts.seed >>> 0) + attempt * 0x9e3779b9);
      const out = runWave({ ...opts, rng });
      return { ok: true, result: out.result, attempts: attempt + 1, steps: out.steps, failure: null };
    } catch (err) {
      if (!(err instanceof Contradiction)) throw err;
      last = err;
    }
  }
  return {
    ok: false, result: null, attempts: retries + 1, steps: 0,
    failure: `no consistent fill after ${retries + 1} attempts (last contradiction at cell ${last.cell})`,
  };
}
