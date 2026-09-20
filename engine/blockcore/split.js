// blockcore/split.js
// Oversized builds are split into aligned chunks, each exported as its own
// .mcstructure, with a text guide listing the offset each piece is placed at.
// No world bounds anywhere; the only limit is the cell budget.
//
// Alignment is to the structure's own minimum corner, so chunk seams always
// land in the same place for a given build and re-exports stay comparable.

import { VoxelGrid, valueMaterial, valueShade } from './voxels.js';

export const DEFAULT_CHUNK = [64, 64, 64];
// Bedrock's structure block tops out at 64 on a side, so 64 is also the
// largest piece a player can place by hand without commands.
export const MAX_STRUCTURE_EDGE = 64;

/**
 * @param {VoxelGrid} grid
 * @param {object} opts  chunk:[x,y,z] (default 64^3), align:[x,y,z] override
 * @returns {{chunks:Array, grid:VoxelGrid, chunkSize:number[], origin:number[],
 *            counts:{x:number,y:number,z:number}, totalCells:number}}
 */
export function splitGrid(grid, opts = {}) {
  const chunk = (opts.chunk || DEFAULT_CHUNK).map((n) => Math.max(1, n | 0));
  const b = grid.bounds(true);
  if (b.empty) {
    return { chunks: [], grid, chunkSize: chunk, origin: [0, 0, 0], counts: { x: 0, y: 0, z: 0 }, totalCells: 0 };
  }
  const origin = opts.align || b.min;

  const counts = [0, 1, 2].map((a) =>
    Math.floor((b.max[a] - origin[a]) / chunk[a]) - Math.floor((b.min[a] - origin[a]) / chunk[a]) + 1);
  const first = [0, 1, 2].map((a) => Math.floor((b.min[a] - origin[a]) / chunk[a]));

  const map = new Map();
  const p = [0, 0, 0];
  grid.forEach((x, y, z, value) => {
    p[0] = x; p[1] = y; p[2] = z;
    const c = [0, 1, 2].map((a) => Math.floor((p[a] - origin[a]) / chunk[a]));
    const key = `${c[0]},${c[1]},${c[2]}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        cell: c,
        offset: [0, 1, 2].map((a) => origin[a] + c[a] * chunk[a]),
        grid: new VoxelGrid({ budget: grid.budget }),
      };
      map.set(key, entry);
    }
    entry.grid.set(p[0] - entry.offset[0], p[1] - entry.offset[1], p[2] - entry.offset[2],
                   valueMaterial(value), valueShade(value));
  });

  const chunks = [...map.values()].sort((a, b2) =>
    (a.cell[1] - b2.cell[1]) || (a.cell[0] - b2.cell[0]) || (a.cell[2] - b2.cell[2]));
  chunks.forEach((c, i) => {
    c.index = i;
    c.cells = c.grid.size;
    c.size = c.grid.bounds(true).size;
  });

  return {
    chunks,
    grid,
    chunkSize: chunk,
    origin,
    firstCell: first,
    counts: { x: counts[0], y: counts[1], z: counts[2] },
    totalCells: grid.size,
  };
}

/** True when the grid fits in one structure of the given edge limit. */
export function needsSplit(grid, edge = MAX_STRUCTURE_EDGE) {
  const b = grid.bounds(true);
  return !b.empty && (b.size[0] > edge || b.size[1] > edge || b.size[2] > edge);
}

/**
 * Human-readable placement guide.
 * Offsets are relative to the build's own minimum corner, so the player picks
 * one spot for piece 000 and every other offset is measured from it.
 */
export function placementGuide(split, opts = {}) {
  const baseName = opts.baseName || 'structure';
  const title = opts.title || baseName;
  const lines = [];
  lines.push(`${title} - placement guide`);
  lines.push('='.repeat(Math.max(24, title.length + 19)));
  lines.push('');
  if (split.chunks.length === 0) {
    lines.push('Nothing to place: the build is empty.');
    return lines.join('\n');
  }
  lines.push(`pieces      : ${split.chunks.length}`);
  lines.push(`chunk size  : ${split.chunkSize.join(' x ')} blocks`);
  lines.push(`grid        : ${split.counts.x} x ${split.counts.y} x ${split.counts.z} pieces (x, y, z)`);
  lines.push(`total cells : ${split.totalCells.toLocaleString()}`);
  lines.push('');
  lines.push('Place piece 000 wherever you want the build to start. That spot is the');
  lines.push('origin; every offset below is measured from it, in blocks, as');
  lines.push('(east +x, up +y, south +z).');
  lines.push('');
  lines.push('  piece  structure name                       offset from origin        cells');
  lines.push('  -----  ----------------------------------  ------------------------  --------');

  const base = split.chunks[0].offset;
  for (const c of split.chunks) {
    const rel = [0, 1, 2].map((a) => c.offset[a] - base[a]);
    const name = `${baseName}_${String(c.index).padStart(3, '0')}`;
    lines.push(`  ${String(c.index).padStart(5, '0')}  ${name.padEnd(34)}  ${
      `${fmt(rel[0])}, ${fmt(rel[1])}, ${fmt(rel[2])}`.padEnd(24)}  ${String(c.cells).padStart(8)}`);
  }
  lines.push('');
  lines.push('With a structure block: set it to Load, type the structure name, set the');
  lines.push('relative offset to the values above, then Load. Or stand at the origin and');
  lines.push('use /structure load <name> ~x ~y ~z with the same numbers.');
  return lines.join('\n');
}

function fmt(n) { return (n >= 0 ? '+' : '') + n; }
