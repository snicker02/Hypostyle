// blockcore/mesher.js
// Face culling plus greedy merging, per face direction and per material.
// Output is a non-indexed triangle soup with position, normal and colour, ready
// for a WebGL1 draw call with no extensions.

import { valueMaterial, valueShade } from './voxels.js';
import { Palette } from './palette.js';

const DIRS = [
  { n: [1, 0, 0],  axis: 0, sign: 1 },
  { n: [-1, 0, 0], axis: 0, sign: -1 },
  { n: [0, 1, 0],  axis: 1, sign: 1 },
  { n: [0, -1, 0], axis: 1, sign: -1 },
  { n: [0, 0, 1],  axis: 2, sign: 1 },
  { n: [0, 0, -1], axis: 2, sign: -1 },
];

// Flat shading weight per direction: top brightest, bottom darkest.
const FACE_LIGHT = [0.80, 0.62, 1.00, 0.48, 0.90, 0.70];

/** Number of block faces that touch empty space. The unmerged upper bound. */
export function countExposedFaces(grid) {
  let n = 0;
  const p = [0, 0, 0];
  grid.forEach((x, y, z) => {
    p[0] = x; p[1] = y; p[2] = z;
    for (const d of DIRS) {
      const q = [x, y, z];
      q[d.axis] += d.sign;
      if (!grid.has(q[0], q[1], q[2])) n++;
    }
  });
  return n;
}

/**
 * Greedy-mesh a grid.
 * @param {import('./voxels.js').VoxelGrid} grid
 * @param {object} opts  palette, origin (subtracted from every coordinate)
 * @returns {{positions:Float32Array, normals:Float32Array, colors:Float32Array,
 *            quadCount:number, triangleCount:number, bounds:object}}
 */
export function meshGrid(grid, opts = {}) {
  const palette = opts.palette || new Palette();
  const bounds = grid.bounds(true);
  const positions = [], normals = [], colors = [];
  if (bounds.empty) {
    return {
      positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0),
      quadCount: 0, triangleCount: 0, bounds,
    };
  }

  const origin = opts.origin || [0, 0, 0];
  const [minX, minY, minZ] = bounds.min;
  const [sx, sy, sz] = bounds.size;
  const dims = [sx, sy, sz];
  const base = [minX, minY, minZ];

  let quadCount = 0;

  for (let di = 0; di < DIRS.length; di++) {
    const dir = DIRS[di];
    const a = dir.axis;             // slice axis
    const u = (a + 1) % 3;          // in-plane axes
    const v = (a + 2) % 3;
    const light = FACE_LIGHT[di];

    const du = dims[u], dv = dims[v];
    const mask = new Int32Array(du * dv);

    for (let slice = 0; slice < dims[a]; slice++) {
      mask.fill(-1);
      let any = false;
      const cell = [0, 0, 0], neighbour = [0, 0, 0];
      for (let j = 0; j < dv; j++) {
        for (let i = 0; i < du; i++) {
          cell[a] = base[a] + slice;
          cell[u] = base[u] + i;
          cell[v] = base[v] + j;
          const value = grid.get(cell[0], cell[1], cell[2]);
          if (value < 0) continue;
          neighbour[0] = cell[0]; neighbour[1] = cell[1]; neighbour[2] = cell[2];
          neighbour[a] += dir.sign;
          if (grid.has(neighbour[0], neighbour[1], neighbour[2])) continue;
          mask[j * du + i] = value;
          any = true;
        }
      }
      if (!any) continue;

      // Greedy merge equal-value runs into rectangles.
      for (let j = 0; j < dv; j++) {
        for (let i = 0; i < du;) {
          const value = mask[j * du + i];
          if (value < 0) { i++; continue; }

          let w = 1;
          while (i + w < du && mask[j * du + i + w] === value) w++;

          let h = 1;
          grow: while (j + h < dv) {
            for (let k = 0; k < w; k++) {
              if (mask[(j + h) * du + i + k] !== value) break grow;
            }
            h++;
          }

          for (let jj = 0; jj < h; jj++) {
            for (let ii = 0; ii < w; ii++) mask[(j + jj) * du + i + ii] = -1;
          }

          emitQuad(positions, normals, colors, {
            dir, axis: a, u, v, slice, i, j, w, h, base, origin,
            value, palette, light,
          });
          quadCount++;
          i += w;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    quadCount,
    triangleCount: quadCount * 2,
    bounds,
  };
}

function emitQuad(positions, normals, colors, q) {
  const { dir, axis, u, v, slice, i, j, w, h, base, origin, value, palette, light } = q;

  // Face plane: the +side of the cell for sign +1, the -side for sign -1.
  const planeOffset = dir.sign > 0 ? 1 : 0;

  const corner = [0, 0, 0];
  corner[axis] = base[axis] + slice + planeOffset - origin[axis];
  corner[u] = base[u] + i - origin[u];
  corner[v] = base[v] + j - origin[v];

  const du = [0, 0, 0]; du[u] = w;
  const dv = [0, 0, 0]; dv[v] = h;

  // Wind so the normal points along dir.n.
  const p0 = corner;
  const p1 = [corner[0] + du[0], corner[1] + du[1], corner[2] + du[2]];
  const p2 = [corner[0] + du[0] + dv[0], corner[1] + du[1] + dv[1], corner[2] + du[2] + dv[2]];
  const p3 = [corner[0] + dv[0], corner[1] + dv[1], corner[2] + dv[2]];

  const cross = crossOf(sub(p1, p0), sub(p3, p0));
  const flip = dot(cross, dir.n) < 0;
  const tri = flip ? [p0, p3, p2, p0, p2, p1] : [p0, p1, p2, p0, p2, p3];

  const material = valueMaterial(value);
  const shade = valueShade(value);
  const rgb = palette.rgbFor(material);
  const k = light * (1 - shade / 1024);   // shade nudges, never dominates

  for (const p of tri) {
    positions.push(p[0], p[1], p[2]);
    normals.push(dir.n[0], dir.n[1], dir.n[2]);
    colors.push(rgb[0] * k, rgb[1] * k, rgb[2] * k);
  }
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function crossOf(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
