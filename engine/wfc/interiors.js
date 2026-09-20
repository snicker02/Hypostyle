// engine/wfc/interiors.js
// Phase two, the part that turns a skeleton into a building you can walk
// through. The skeleton stays exactly as authored; this only ever writes air.
//
// THE COARSE GRID AND WHY IT IS OFFSET. Modules are 3x3x3, so the wave runs on
// a grid of 3x3x3 cells. Laying that grid naively from the build's minimum
// corner is wrong in a way that is invisible until you look at a cross section:
// the skeleton's floor is usually one block thick, so the bottom coarse layer
// contains one solid layer and two air ones, is therefore not empty, is
// therefore excluded - and the first layer the wave can use starts three blocks
// up. Everything it places then hangs in the air above the real floor.
//
// So the grid is offset. All 27 alignments are tried and the one that yields
// the most entirely-empty cells wins. That is not a heuristic dressed up as a
// rule: the alignment with the most empty cells is the one whose layers sit
// flush on the floors and flush under the roofs, because those are the planes
// that cut cells in half.
//
// PRE-COLLAPSED SKELETON. A coarse cell takes part only if all 27 of its blocks
// are air. Anything else - wall, column, a cell clipped by the box - is not in
// the wave, and enters instead as a boundary condition read off its actual
// block content. The skeleton is not translated into modules; it is simply what
// the modules at the edge have to agree with.
//
// REGIONS. Participating cells are split into 6-connected components and each
// is solved alone. One failure does not spoil the rest, and a restart after a
// contradiction restarts only the region that hit it.
//
// BANDS. The lowest coarse layer of a region is the floor band, the highest the
// ceiling band, the rest interior. Bands are per region and not per column, so
// every cell in a layer offers the same face vocabulary sideways - a ragged
// room never asks a floor to meet a ceiling edge on.
//
// Deliberately absent: symmetry. Interiors are asymmetric on purpose. The
// contrast between an exactly periodic shell and an interior that never repeats
// is the entire point of combining the two layers.

import { findVoids } from '../voids.js';
import { buildVariants, idx, AIR, DIRS } from './modules.js';
import { MODULE_LIBRARY } from './library.js';
import { buildAdjacency, boundaryAllows, worldFaceProfile } from './adjacency.js';
import { solve } from './collapse.js';

export const DEFAULTS = Object.freeze({
  minRegionCells: 1,
  maxRegionCells: 40000,
  retries: 8,
  seed: 1,
  density: 0.5,
  align: true,
});

let cached = null;
/** Variants and adjacency for a library. Built once and reused. */
export function moduleSet(defs = MODULE_LIBRARY) {
  if (cached && cached.defs === defs) return cached;
  const { variants, byName, families } = buildVariants(defs);
  const built = buildAdjacency(variants);
  cached = { defs, variants, byName, families, ...built };
  return cached;
}

/**
 * Weights for one run. Emptiness is scaled against everything else so the same
 * library can furnish a room lightly or heavily without re-authoring it.
 * density 0 leaves rooms bare, 1 packs them.
 */
export function weightsFor(set, density = 0.5) {
  const d = Math.min(1, Math.max(0, density));
  const emptyScale = Math.pow(8, 0.5 - d);      // 2.83 at 0, 1 at 0.5, 0.35 at 1
  const w = new Float64Array(set.variants.length);
  for (let i = 0; i < w.length; i++) {
    const v = set.variants[i];
    w[i] = v.solid === 0 ? v.weight * emptyScale : v.weight;
  }
  return w;
}

/**
 * Fill the interiors of a skeleton.
 * @param {import('../blockcore/index.js').VoxelGrid} grid
 * @param {object} opts seed, retries, density, align, minRegionCells,
 *                      maxRegionCells, modules
 * @returns {object} grid (a new one), regions, placed, connectivity
 */
export function fillInteriors(grid, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const set = moduleSet(opts.modules || MODULE_LIBRARY);
  const weights = weightsFor(set, o.density);
  const m = set.variants.length;

  const b = grid.bounds(true);
  if (b.empty) return emptyReport('the build is empty');
  if (b.size.some((v) => v < 3)) {
    return emptyReport(`the build is ${b.size.join('x')}, smaller than one 3x3x3 module`);
  }

  // Solidity of the whole bounding box, once. Everything below reads this.
  const [bx, by, bz] = b.size;
  const solid = new Uint8Array(bx * by * bz);
  const sAt = (x, y, z) => (x * by + y) * bz + z;
  grid.forEach((x, y, z) => { solid[sAt(x - b.min[0], y - b.min[1], z - b.min[2])] = 1; });
  const isSolidWorld = (x, y, z) => {
    const lx = x - b.min[0], ly = y - b.min[1], lz = z - b.min[2];
    if (lx < 0 || ly < 0 || lz < 0 || lx >= bx || ly >= by || lz >= bz) return false;
    return solid[sAt(lx, ly, lz)] === 1;
  };

  const chosen = chooseAlignment(solid, b.size, o.align);
  if (chosen.cn.some((v) => v < 1)) {
    return emptyReport(`no whole 3x3x3 cell fits in a ${b.size.join('x')} build`);
  }
  const off = chosen.offset;
  const cn = chosen.cn;
  const origin = [0, 1, 2].map((a) => b.min[a] + off[a]);
  const open = chosen.open;
  const total = cn[0] * cn[1] * cn[2];
  const cIndex = (x, y, z) => (x * cn[1] + y) * cn[2] + z;

  // 6-connected components of empty coarse cells.
  const comp = new Int32Array(total).fill(-1);
  const regions = [];
  const stack = new Int32Array(total);
  for (let seed = 0; seed < total; seed++) {
    if (!open[seed] || comp[seed] >= 0) continue;
    const id = regions.length;
    const cells = [];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let top = 0;
    stack[top++] = seed;
    comp[seed] = id;
    while (top > 0) {
      const i = stack[--top];
      cells.push(i);
      const cz = i % cn[2];
      const rest = (i - cz) / cn[2];
      const cy = rest % cn[1];
      const cx = (rest - cy) / cn[1];
      const p = [cx, cy, cz];
      for (let a = 0; a < 3; a++) {
        if (p[a] < min[a]) min[a] = p[a];
        if (p[a] > max[a]) max[a] = p[a];
      }
      for (const dir of DIRS) {
        const q = [cx + dir[0], cy + dir[1], cz + dir[2]];
        if (q.some((v, a) => v < 0 || v >= cn[a])) continue;
        const j = cIndex(q[0], q[1], q[2]);
        if (!open[j] || comp[j] >= 0) continue;
        comp[j] = id;
        stack[top++] = j;
      }
    }
    regions.push({ id, cells, min, max, size: cells.length });
  }
  regions.sort((a, c) => c.size - a.size);

  const out = grid.clone();
  const before = findVoids(grid);
  const reports = [];
  const byFamily = new Map();
  let placed = 0, solvedRegions = 0, failedRegions = 0, skipped = 0;

  for (const region of regions) {
    if (region.size < o.minRegionCells) { skipped++; continue; }
    if (region.size > o.maxRegionCells) {
      reports.push({
        ...describe(region, origin), ok: false,
        failure: `${region.size.toLocaleString()} module cells, over the `
               + `${o.maxRegionCells.toLocaleString()} limit for one region`,
      });
      failedRegions++;
      continue;
    }
    const r = solveRegion({
      out, region, origin, cn, comp, open, set, weights, m, isSolidWorld,
      seed: (o.seed >>> 0) + region.id * 7919, retries: o.retries,
    });
    reports.push({ ...describe(region, origin), ...r.report });
    if (r.report.ok) {
      solvedRegions++;
      placed += r.placed;
      for (const [name, n] of r.byFamily) byFamily.set(name, (byFamily.get(name) || 0) + n);
    } else {
      failedRegions++;
    }
  }

  const after = findVoids(out);
  return {
    ok: true,
    grid: out,
    coarse: cn,
    offset: off,
    origin,
    alignedCells: chosen.count,
    supportedCells: chosen.supported,
    regions: reports,
    regionCount: regions.length,
    solvedRegions,
    failedRegions,
    skipped,
    placed,
    byFamily,
    variants: m,
    families: set.families,
    density: o.density,
    seed: o.seed,
    connectivity: connectivity(before, after),
  };
}

/**
 * Try every 3x3x3 alignment of the coarse grid and keep the best.
 *
 * "Best" is not simply the most empty cells. Counting only emptiness picked an
 * alignment for the arcade that floated two blocks clear of the floor: the
 * layer was empty, which is what was being scored, but nothing in it had
 * anything underneath, so the boundary rule forbade every module that stands on
 * the ground and the whole floor band came out void. So the score counts
 * SUPPORTED empty cells first - cells with solid directly beneath them - and
 * uses the plain empty count only to break ties. The alignment that rests on
 * the most floors is the one that can be furnished.
 */
export function chooseAlignment(solid, size, align = true) {
  const [bx, by, bz] = size;
  const sAt = (x, y, z) => (x * by + y) * bz + z;
  let best = null;
  const range = align ? [0, 1, 2] : [0];
  for (const ox of range) {
    for (const oy of range) {
      for (const oz of range) {
        const cn = [
          Math.floor((bx - ox) / 3), Math.floor((by - oy) / 3), Math.floor((bz - oz) / 3),
        ];
        if (cn.some((v) => v < 1)) continue;
        const open = new Uint8Array(cn[0] * cn[1] * cn[2]);
        let count = 0, supported = 0;
        for (let cx = 0; cx < cn[0]; cx++) {
          for (let cy = 0; cy < cn[1]; cy++) {
            for (let cz = 0; cz < cn[2]; cz++) {
              let empty = 1;
              const x0 = ox + cx * 3, y0 = oy + cy * 3, z0 = oz + cz * 3;
              outer:
              for (let x = 0; x < 3; x++) {
                for (let y = 0; y < 3; y++) {
                  for (let z = 0; z < 3; z++) {
                    if (solid[sAt(x0 + x, y0 + y, z0 + z)]) { empty = 0; break outer; }
                  }
                }
              }
              if (empty) {
                open[(cx * cn[1] + cy) * cn[2] + cz] = 1;
                count++;
                if (z0 > 0) {
                  for (let x = 0; x < 3; x++) {
                    for (let y = 0; y < 3; y++) {
                      if (solid[sAt(x0 + x, y0 + y, z0 - 1)]) { supported++; x = 3; break; }
                    }
                  }
                }
              }
            }
          }
        }
        if (!best || supported > best.supported
            || (supported === best.supported && count > best.count)) {
          best = { offset: [ox, oy, oz], cn, open, count, supported };
        }
      }
    }
  }
  return best
    || { offset: [0, 0, 0], cn: [0, 0, 0], open: new Uint8Array(0), count: 0, supported: 0 };
}

function emptyReport(message) {
  return {
    ok: false, message, grid: null, regions: [], regionCount: 0, solvedRegions: 0,
    failedRegions: 0, skipped: 0, placed: 0, byFamily: new Map(), connectivity: null,
  };
}

function describe(region, origin) {
  return {
    id: region.id,
    cells: region.size,
    min: [0, 1, 2].map((a) => origin[a] + region.min[a] * 3),
    size: [0, 1, 2].map((a) => (region.max[a] - region.min[a] + 1) * 3),
  };
}

function solveRegion({
  out, region, origin, cn, comp, open, set, weights, m, isSolidWorld, seed, retries,
}) {
  const lo = region.min;
  const dims = [0, 1, 2].map((a) => region.max[a] - lo[a] + 1);
  const n = dims[0] * dims[1] * dims[2];
  const lIndex = (x, y, z) => (x * dims[1] + y) * dims[2] + z;

  const active = new Uint8Array(n);
  const allowed = new Uint8Array(n * m);

  const zLow = lo[2], zHigh = region.max[2];
  const bandFor = (cz) => (cz === zLow ? 'floor' : cz === zHigh ? 'ceiling' : 'interior');

  const coords = (gi) => {
    const cz = gi % cn[2];
    const rest = (gi - cz) / cn[2];
    const cy = rest % cn[1];
    return [(rest - cy) / cn[1], cy, cz];
  };

  for (const gi of region.cells) {
    const [cx, cy, cz] = coords(gi);
    const li = lIndex(cx - lo[0], cy - lo[1], cz - lo[2]);
    active[li] = 1;
    const mask = set.bandMasks.get(bandFor(cz));
    const base = li * m;
    for (let k = 0; k < m; k++) allowed[base + k] = mask[k];

    for (let d = 0; d < 6; d++) {
      const dir = DIRS[d];
      const q = [cx + dir[0], cy + dir[1], cz + dir[2]];
      const onGrid = !q.some((v, a) => v < 0 || v >= cn[a]);
      if (onGrid) {
        const j = (q[0] * cn[1] + q[1]) * cn[2] + q[2];
        if (open[j] && comp[j] === region.id) continue;        // in the wave
      }
      // Off the coarse grid is still somewhere: read the world there rather
      // than treating it as permission. Skipping it is what let a beam hang
      // from open sky at the top of the excerpt.
      const nOrigin = [0, 1, 2].map((a) => origin[a] + q[a] * 3);
      const profile = worldFaceProfile(isSolidWorld, nOrigin, d);
      for (let k = 0; k < m; k++) {
        if (allowed[base + k] && !boundaryAllows(set.variants[k], d, profile)) {
          allowed[base + k] = 0;
        }
      }
    }
  }

  // A consistent fill is not necessarily a fill you can walk through. A
  // partition runs floor to ceiling by construction, so a wave that is perfectly
  // legal can still cut a room in half and leave one side with no way out. So
  // connectivity is checked on each candidate, inside the retry loop, and an
  // answer that orphans air is treated like a contradiction: try again with a
  // fresh seed. If every attempt orphans something, the least bad one is kept
  // and the count is reported rather than hidden.
  let best = null;
  let attempts = 0;
  let contradictions = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    attempts++;
    const res = solve({
      dims, active, allowed, weights, adj: set.adj,
      seed: (seed >>> 0) + attempt * 0x9e3779b9, retries: 0,
    });
    if (!res.ok) { contradictions++; continue; }
    const orphans = countOrphans({
      result: res.result, region, origin, cn, set, coords, lIndex, lo,
    });
    if (!best || orphans < best.orphans) best = { result: res.result, steps: res.steps, orphans };
    if (orphans === 0) break;
  }

  if (!best) {
    return {
      placed: 0, byFamily: new Map(),
      report: {
        ok: false, attempts,
        failure: `no consistent fill after ${attempts} attempt${attempts === 1 ? '' : 's'}`,
      },
    };
  }

  let placed = 0;
  const byFamily = new Map();
  for (const gi of region.cells) {
    const [cx, cy, cz] = coords(gi);
    const k = best.result[lIndex(cx - lo[0], cy - lo[1], cz - lo[2])];
    if (k < 0) continue;
    const v = set.variants[k];
    byFamily.set(v.name, (byFamily.get(v.name) || 0) + 1);
    if (v.solid === 0) continue;
    const x0 = origin[0] + cx * 3, y0 = origin[1] + cy * 3, z0 = origin[2] + cz * 3;
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        for (let z = 0; z < 3; z++) {
          const mat = v.cells[idx(x, y, z)];
          if (mat !== AIR && out.setIfEmpty(x0 + x, y0 + y, z0 + z, mat)) placed++;
        }
      }
    }
  }
  return {
    placed,
    byFamily,
    report: {
      ok: true, attempts, contradictions, steps: best.steps,
      orphans: best.orphans, placed,
    },
  };
}

/**
 * How much of this room the fill cut off from the rest of it.
 *
 * Measured inside the region's own cells only: before the fill every block in
 * them is air and the region is connected by construction, so afterwards the
 * air should still be one piece. Anything that is not part of the largest
 * remaining piece has been walled away.
 *
 * Total air is deliberately NOT the measure. An earlier version flooded from
 * the surface of the region's box, which in a sealed room is solid wall, so
 * nothing seeded, so the score came out as "all the air" - and minimising THAT
 * rewards filling the room with as many blocks as possible. It made the problem
 * worse and it looked like a solver bug. Fragmentation is the thing to count,
 * because adding blocks lowers the air and the largest piece together and only
 * splitting the room moves them apart.
 */
function countOrphans({ result, region, origin, cn, set, coords, lIndex, lo }) {
  const min = [0, 1, 2].map((a) => origin[a] + region.min[a] * 3);
  const size = [0, 1, 2].map((a) => (region.max[a] - region.min[a] + 1) * 3);
  const [sx, sy, sz] = size;
  const total = sx * sy * sz;
  const at = (x, y, z) => (x * sy + y) * sz + z;

  // 0 outside the region, 1 air inside it, 2 filled by the wave.
  const cell = new Uint8Array(total);
  for (const gi of region.cells) {
    const [cx, cy, cz] = coords(gi);
    const x0 = origin[0] + cx * 3 - min[0];
    const y0 = origin[1] + cy * 3 - min[1];
    const z0 = origin[2] + cz * 3 - min[2];
    const k = result[lIndex(cx - lo[0], cy - lo[1], cz - lo[2])];
    const v = k >= 0 ? set.variants[k] : null;
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        for (let z = 0; z < 3; z++) {
          const filled = v && v.cells[idx(x, y, z)] !== AIR;
          cell[at(x0 + x, y0 + y, z0 + z)] = filled ? 2 : 1;
        }
      }
    }
  }

  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  let air = 0, largest = 0;
  for (let i = 0; i < total; i++) if (cell[i] === 1) air++;

  for (let seed = 0; seed < total; seed++) {
    if (cell[seed] !== 1 || seen[seed]) continue;
    let top = 0, count = 0;
    seen[seed] = 1;
    stack[top++] = seed;
    while (top > 0) {
      const i = stack[--top];
      count++;
      const z = i % sz;
      const rest = (i - z) / sz;
      const y = rest % sy;
      const x = (rest - y) / sy;
      const push = (px, py, pz) => {
        const j = at(px, py, pz);
        if (cell[j] !== 1 || seen[j]) return;
        seen[j] = 1;
        stack[top++] = j;
      };
      if (x > 0) push(x - 1, y, z);
      if (x < sx - 1) push(x + 1, y, z);
      if (y > 0) push(x, y - 1, z);
      if (y < sy - 1) push(x, y + 1, z);
      if (z > 0) push(x, y, z - 1);
      if (z < sz - 1) push(x, y, z + 1);
    }
    if (count > largest) largest = count;
  }
  return air - largest;
}

/** Air with no route out of the bounding box. */
function orphanAir(v) {
  if (!v.ok || v.regions.length === 0) return 0;
  const reachable = v.regions.filter((r) => r.touchesBoundary);
  if (reachable.length === 0) return v.air - v.regions[0].size;
  return v.air - reachable.reduce((n, r) => n + r.size, 0);
}

function connectivity(before, after) {
  const b = orphanAir(before), a = orphanAir(after);
  return {
    airBefore: before.ok ? before.air : 0,
    airAfter: after.ok ? after.air : 0,
    orphanBefore: b,
    orphanAfter: a,
    cutOff: Math.max(0, a - b),
    regionsBefore: before.ok ? before.regions.length : 0,
    regionsAfter: after.ok ? after.regions.length : 0,
  };
}

/** One line for the status strip. */
export function describeInteriors(r) {
  if (!r.ok) return r.message;
  const total = r.solvedRegions + r.failedRegions;
  const parts = [
    `${r.placed.toLocaleString()} blocks placed`,
    `${r.solvedRegions} of ${total} room${total === 1 ? '' : 's'} filled`,
  ];
  if (r.failedRegions) parts.push(`${r.failedRegions} failed`);
  if (r.connectivity) {
    parts.push(r.connectivity.cutOff === 0
      ? 'nothing sealed off'
      : `${r.connectivity.cutOff.toLocaleString()} air cells newly orphaned`);
  }
  return parts.join(', ');
}
