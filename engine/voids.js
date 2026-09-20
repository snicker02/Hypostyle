// engine/voids.js
// The skeleton is only architecture if it makes rooms. This finds them.
//
// Air inside the build's bounding box is split into 6-connected components.
// Each one is reported with its size, its extent, and whether it touches a face
// of the bounding box.
//
// Touching the boundary is not a failure. A periodic building with doors in it
// always has openings cut by the edge of the excerpt, so the interior of a
// cloister reads as "open at the boundary" even though it is unmistakably
// indoors. Sealed components are the stricter signal: air the shell closes off
// completely, with no route out at all.
//
// Either way these components are what phase two hands to WFC as its domain,
// with the skeleton's own blocks entering as pre-collapsed cells.
//
// 6-connected, because a block diagonal is not a doorway.

const SOLID = 0xffff;

/**
 * @param {import('./blockcore/index.js').VoxelGrid} grid
 * @param {object} opts  maxVolume (default 24m cells), minReport (default 8)
 * @returns {{ok:boolean, regions:Array, sealed:number, open:number,
 *            air:number, sealedAir:number, volume:number, boxSize:number[],
 *            message?:string}}
 */
export function findVoids(grid, opts = {}) {
  const maxVolume = opts.maxVolume || 24000000;
  const b = grid.bounds(true);
  if (b.empty) {
    return { ok: true, regions: [], sealed: 0, open: 0, air: 0, sealedAir: 0, volume: 0, boxSize: [0, 0, 0] };
  }

  const [sx, sy, sz] = b.size;
  const volume = sx * sy * sz;
  if (volume > maxVolume) {
    return {
      ok: false, regions: [], sealed: 0, open: 0, air: 0, sealedAir: 0, volume, boxSize: b.size,
      message: `bounding box is ${b.size.join('x')} = ${volume.toLocaleString()} cells, over the `
             + `${maxVolume.toLocaleString()} analysis limit`,
    };
  }

  const min = b.min;
  const label = new Uint16Array(volume);       // 0 = unvisited air, SOLID, else region+1
  const at = (x, y, z) => (x * sy + y) * sz + z;

  grid.forEach((x, y, z) => { label[at(x - min[0], y - min[1], z - min[2])] = SOLID; });

  const regions = [];
  const stack = new Int32Array(Math.min(volume, 1 << 22));
  let air = 0;

  for (let seed = 0; seed < volume; seed++) {
    if (label[seed] !== 0) continue;
    const id = regions.length + 1;
    if (id >= SOLID) break;                    // absurd fragmentation; stop labelling
    const region = {
      id, size: 0, touchesBoundary: false,
      min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
    };
    let top = 0;
    stack[top++] = seed;
    label[seed] = id;
    while (top > 0) {
      const i = stack[--top];
      const z = i % sz;
      const rest = (i - z) / sz;
      const y = rest % sy;
      const x = (rest - y) / sy;

      region.size++;
      const w = [x + min[0], y + min[1], z + min[2]];
      for (let a = 0; a < 3; a++) {
        if (w[a] < region.min[a]) region.min[a] = w[a];
        if (w[a] > region.max[a]) region.max[a] = w[a];
      }
      if (x === 0 || y === 0 || z === 0 || x === sx - 1 || y === sy - 1 || z === sz - 1) {
        region.touchesBoundary = true;
      }

      if (x > 0) push(at(x - 1, y, z));
      if (x < sx - 1) push(at(x + 1, y, z));
      if (y > 0) push(at(x, y - 1, z));
      if (y < sy - 1) push(at(x, y + 1, z));
      if (z > 0) push(at(x, y, z - 1));
      if (z < sz - 1) push(at(x, y, z + 1));

      function push(j) {
        if (label[j] !== 0) return;
        label[j] = id;
        if (top < stack.length) stack[top++] = j;
        else { /* stack full: re-seeded on a later sweep */ label[j] = 0; }
      }
    }
    air += region.size;
    region.size3 = [0, 1, 2].map((a) => region.max[a] - region.min[a] + 1);
    regions.push(region);
  }

  regions.sort((a, c) => c.size - a.size);
  const sealedRegions = regions.filter((r) => !r.touchesBoundary);

  return {
    ok: true,
    regions,
    sealed: sealedRegions.length,
    open: regions.length - sealedRegions.length,
    air,
    sealedAir: sealedRegions.reduce((n, r) => n + r.size, 0),
    volume,
    boxSize: b.size,
    solid: grid.size,
  };
}

/** One-line summary for the status strip. */
export function describeVoids(result) {
  if (!result.ok) return result.message;
  if (result.regions.length === 0) return 'solid: no air inside the bounding box';
  const biggest = result.regions[0];
  const parts = [];
  parts.push(`${result.regions.length} air region${result.regions.length === 1 ? '' : 's'}`);
  parts.push(`${result.air.toLocaleString()} cells`);
  parts.push(`largest ${biggest.size.toLocaleString()} (${biggest.size3.join('x')})`);
  if (result.sealed) {
    parts.push(`${result.sealed} sealed, ${result.sealedAir.toLocaleString()} cells with no way out`);
  } else {
    parts.push('none fully sealed - openings reach the edge of the excerpt');
  }
  return parts.join(', ');
}
