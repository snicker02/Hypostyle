// engine/expander.js
// Two steps, kept separate because they fail in different ways.
//
//   expandUnit  applies the group's operations inside one cell. Cost is
//               authored blocks x group order. Collisions here mean the author
//               put two different materials on the same orbit.
//   tileCells   repeats the finished cell along the lattice. Cost is cell
//               content x repeats. This is where a cell budget gets spent.

import { VoxelGrid, valueMaterial, BudgetExceeded } from './blockcore/index.js';
import { applyOp, cellIndex } from './symmetry.js';

/**
 * Expand the authored blocks through the group into one full cell.
 * @param {import('./unit.js').UnitCell} unit
 * @param {object} opts  budget
 * @returns {{grid:VoxelGrid, stats:object}}
 */
export function expandUnit(unit, opts = {}) {
  const { group, dims } = unit;
  const grid = new VoxelGrid({ budget: opts.budget || 4000000 });
  const owner = new Map();          // cell index -> source cell index
  const q = [0, 0, 0];

  let images = 0, collisions = 0, special = 0;
  const multiplicities = new Map();

  unit.blocks.forEach((x, y, z, value) => {
    const material = valueMaterial(value);
    const source = cellIndex([x, y, z], dims);
    const seen = new Set();
    for (let i = 0; i < group.order; i++) {
      applyOp(group, i, dims, [x, y, z], q);
      const target = cellIndex(q, dims);
      if (seen.has(target)) continue;
      seen.add(target);
      images++;
      const existing = owner.get(target);
      if (existing === undefined) {
        owner.set(target, source);
        grid.set(q[0], q[1], q[2], material);
      } else if (grid.material(q[0], q[1], q[2]) !== material) {
        collisions++;                 // first write wins, by design
      }
    }
    const m = seen.size;
    multiplicities.set(m, (multiplicities.get(m) || 0) + 1);
    if (m < group.order) special++;
  });

  return {
    grid,
    stats: {
      authored: unit.blocks.size,
      cellCells: grid.size,
      images,
      collisions,
      specialSites: special,
      order: group.order,
      multiplicities: [...multiplicities.entries()].sort((a, b) => a[0] - b[0]),
      fill: grid.size / (dims[0] * dims[1] * dims[2]),
    },
  };
}

/**
 * Repeat one cell along the lattice.
 * @param {VoxelGrid} cellGrid
 * @param {number[]} dims
 * @param {number[]} repeats
 * @param {object} opts  budget
 * @returns {{grid:VoxelGrid, stats:object}}
 */
export function tileCells(cellGrid, dims, repeats, opts = {}) {
  const budget = opts.budget || 4000000;
  const n = repeats.map((r) => Math.max(1, r | 0));
  const projected = cellGrid.size * n[0] * n[1] * n[2];
  const grid = new VoxelGrid({ budget });

  if (projected > budget) {
    return {
      grid,
      stats: {
        ok: false, projected, budget, repeats: n, cells: 0,
        message: `${projected.toLocaleString()} blocks would exceed the ${budget.toLocaleString()} cell budget`,
      },
    };
  }

  try {
    for (let ix = 0; ix < n[0]; ix++) {
      for (let iy = 0; iy < n[1]; iy++) {
        for (let iz = 0; iz < n[2]; iz++) {
          const off = [ix * dims[0], iy * dims[1], iz * dims[2]];
          cellGrid.forEach((x, y, z, value) => {
            grid.set(x + off[0], y + off[1], z + off[2], valueMaterial(value));
          });
        }
      }
    }
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      return { grid, stats: { ok: false, projected, budget, repeats: n, cells: grid.size, message: err.message } };
    }
    throw err;
  }

  const b = grid.bounds(true);
  return {
    grid,
    stats: {
      ok: true, projected, budget, repeats: n,
      cells: grid.size,
      size: b.size,
      cellsPerUnitCell: cellGrid.size,
    },
  };
}

/**
 * Whole skeleton in one call.
 * @returns {{grid:VoxelGrid, cellGrid:VoxelGrid, expand:object, tile:object}}
 */
export function buildSkeleton(unit, repeats = [1, 1, 1], opts = {}) {
  const expanded = expandUnit(unit, opts);
  const tiled = tileCells(expanded.grid, unit.dims, repeats, opts);
  return {
    grid: tiled.grid,
    cellGrid: expanded.grid,
    expand: expanded.stats,
    tile: tiled.stats,
  };
}
