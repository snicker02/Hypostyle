// blockcore/pick.js
// Amanatides-Woo DDA traversal over the sparse grid, plus a plane intersection
// for placing the first block when nothing has been built yet.

/**
 * March a ray through the grid until it enters a filled cell.
 * @param {import('./voxels.js').VoxelGrid} grid
 * @param {number[]} origin  ray origin in block units
 * @param {number[]} dir     ray direction, need not be normalised
 * @param {number} maxDist
 * @returns {{hit:boolean, cell?:number[], normal?:number[], adjacent?:number[], t?:number}}
 */
export function raycastGrid(grid, origin, dir, maxDist = 512) {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!isFinite(len) || len === 0) return { hit: false };
  const d = [dir[0] / len, dir[1] / len, dir[2] / len];

  const cell = [Math.floor(origin[0]), Math.floor(origin[1]), Math.floor(origin[2])];
  const step = [0, 0, 0], tMax = [0, 0, 0], tDelta = [0, 0, 0];

  for (let a = 0; a < 3; a++) {
    if (d[a] > 0) {
      step[a] = 1;
      tMax[a] = (cell[a] + 1 - origin[a]) / d[a];
      tDelta[a] = 1 / d[a];
    } else if (d[a] < 0) {
      step[a] = -1;
      tMax[a] = (cell[a] - origin[a]) / d[a];
      tDelta[a] = -1 / d[a];
    } else {
      step[a] = 0;
      tMax[a] = Infinity;
      tDelta[a] = Infinity;
    }
  }

  if (grid.has(cell[0], cell[1], cell[2])) {
    return { hit: true, cell: cell.slice(), normal: [0, 0, 0], adjacent: cell.slice(), t: 0 };
  }

  let t = 0;
  let axis = -1;
  for (let guard = 0; guard < 4096; guard++) {
    axis = (tMax[0] < tMax[1]) ? ((tMax[0] < tMax[2]) ? 0 : 2) : ((tMax[1] < tMax[2]) ? 1 : 2);
    t = tMax[axis];
    if (t > maxDist) return { hit: false };
    cell[axis] += step[axis];
    tMax[axis] += tDelta[axis];
    if (grid.has(cell[0], cell[1], cell[2])) {
      const normal = [0, 0, 0];
      normal[axis] = -step[axis];
      return {
        hit: true,
        cell: cell.slice(),
        normal,
        adjacent: [cell[0] + normal[0], cell[1] + normal[1], cell[2] + normal[2]],
        t,
      };
    }
  }
  return { hit: false };
}

/**
 * Intersect a ray with the horizontal plane y = level (the top face of the
 * blocks at level - 1), returning the cell the ray lands in.
 */
export function raycastPlane(origin, dir, level = 0) {
  if (Math.abs(dir[1]) < 1e-9) return { hit: false };
  const t = (level - origin[1]) / dir[1];
  if (t < 0) return { hit: false };
  const x = origin[0] + dir[0] * t;
  const z = origin[2] + dir[2] * t;
  return { hit: true, t, point: [x, level, z], cell: [Math.floor(x), level, Math.floor(z)] };
}

/**
 * Build a world-space ray from normalised device coordinates and an inverse
 * view-projection matrix (column-major, 16 floats).
 */
export function rayFromNDC(invViewProj, ndcX, ndcY) {
  const near = unproject(invViewProj, ndcX, ndcY, -1);
  const far = unproject(invViewProj, ndcX, ndcY, 1);
  return {
    origin: near,
    dir: [far[0] - near[0], far[1] - near[1], far[2] - near[2]],
  };
}

function unproject(m, x, y, z) {
  const v = [x, y, z, 1];
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    out[i] = m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3];
  }
  const w = out[3] || 1;
  return [out[0] / w, out[1] / w, out[2] / w];
}
