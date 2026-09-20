// engine/symmetry.js
// Space group operations acting on whole blocks.
//
// The one idea this file exists for:
//
//   A block is not a point. Block i occupies the interval [i, i+1), so its
//   centre is at i + 1/2. An operation is applied to the CENTRE and the result
//   converted back to an index:
//
//       p'_k = sum_j R_kj * (p_j + 1/2) - 1/2 + t_k * c_k / 12
//
//   R is a signed permutation, so sum_j R_kj (p_j + 1/2) is always a
//   half-integer and subtracting 1/2 lands exactly on an integer. Cell edges
//   are multiples of 12 and translations are twelfths, so t_k * c_k / 12 is an
//   integer too. Every operation therefore maps blocks onto blocks - never onto
//   a half-block straddling two.
//
//   Doing this the naive way (rotating the index rather than the centre) puts
//   mirror planes one block off and makes every even-order rotation lose a row
//   of blocks at the axis. That bug is the whole reason for the +1/2.
//
// A rotation with R_kj != 0 for k != j carries edge j onto edge k, so those two
// cell edges must be equal. checkDims enforces exactly that, derived from the
// group's own matrices rather than from its crystal system name.

import { TWELFTHS } from './spacegroups.js';

export const EDGE_MULTIPLE = 12;

/**
 * Apply operation i of a group to block index p.
 * @param {import('./spacegroups.js').SpaceGroup} group
 * @param {number} i
 * @param {number[]} dims cell edges in blocks, each a multiple of 12
 * @param {number[]} p
 * @param {number[]} out
 * @returns {number[]} out, wrapped into [0, dims)
 */
export function applyOp(group, i, dims, p, out = [0, 0, 0]) {
  const r = group.rot(i);
  const code = group.ops[i] % 1728;
  const t = [(code / 144) | 0, ((code / 12) | 0) % 12, code % 12];
  for (let k = 0; k < 3; k++) {
    let s = 0;
    for (let j = 0; j < 3; j++) {
      const rk = r[k * 3 + j];
      if (rk) s += rk * (2 * p[j] + 1);      // 2*(p+1/2), kept in halves
    }
    // s is in halves; (s - 1) / 2 is the integer index before translation.
    let v = (s - 1) / 2 + (t[k] * dims[k]) / TWELFTHS;
    v %= dims[k];
    if (v < 0) v += dims[k];
    out[k] = v;
  }
  return out;
}

/** Cell edges the group's rotations force to be equal, as index triples. */
export function edgeConstraint(group) { return group.edgeGroups(); }

/**
 * Check a cell shape against a group.
 * @returns {{ok:boolean, problems:string[], fixed:number[]}}
 *   fixed is the nearest legal cell, for the UI to snap to.
 */
export function checkDims(group, dims) {
  const problems = [];
  const d = dims.map((n) => Math.max(EDGE_MULTIPLE, Math.round(n)));
  for (let a = 0; a < 3; a++) {
    if (d[a] % EDGE_MULTIPLE !== 0) {
      problems.push(`edge ${'xyz'[a]} is ${d[a]}, not a multiple of ${EDGE_MULTIPLE}`);
    }
  }
  const fixed = d.map((n) => Math.max(EDGE_MULTIPLE, Math.round(n / EDGE_MULTIPLE) * EDGE_MULTIPLE));

  const groups = group.edgeGroups();
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      if (groups[a] === groups[b] && fixed[a] !== fixed[b]) {
        problems.push(`${group.hm} carries ${'xyz'[a]} onto ${'xyz'[b]}, so those edges must match`);
      }
    }
  }
  // Snap tied edges to the first member of each tie.
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) if (groups[a] === groups[b]) fixed[b] = fixed[a];
  }
  return { ok: problems.length === 0, problems, fixed };
}

/** Legal cell edges for a group, given one requested size. */
export function snapDims(group, dims) { return checkDims(group, dims).fixed; }

export function cellIndex(p, dims) { return (p[0] * dims[1] + p[1]) * dims[2] + p[2]; }

export function cellFromIndex(index, dims, out = [0, 0, 0]) {
  out[2] = index % dims[2];
  const rest = (index - out[2]) / dims[2];
  out[1] = rest % dims[1];
  out[0] = (rest - out[1]) / dims[1];
  return out;
}

/**
 * All distinct images of one block under the group, as cell indices.
 * @returns {number[]}
 */
export function orbitOf(group, dims, p) {
  const seen = new Set();
  const q = [0, 0, 0];
  for (let i = 0; i < group.order; i++) {
    applyOp(group, i, dims, p, q);
    seen.add(cellIndex(q, dims));
  }
  return [...seen].sort((a, b) => a - b);
}

/** Multiplicity of a site: how many blocks one authored block becomes. */
export function multiplicityAt(group, dims, p) { return orbitOf(group, dims, p).length; }

const REP_CACHE = new Map();
const REP_CACHE_LIMIT = 6;

/**
 * For every block in the cell, the smallest cell index in its orbit.
 * The set of blocks that are their own representative is a fundamental domain -
 * a valid asymmetric unit, chosen canonically rather than from a table.
 *
 * @returns {{reps:Int32Array, domain:Uint8Array, domainSize:number,
 *            orbitCount:number, dims:number[]}}
 */
export function orbitMap(group, dims) {
  const key = `${group.number}|${group.choice}|${dims.join('x')}`;
  const cached = REP_CACHE.get(key);
  if (cached) return cached;

  const total = dims[0] * dims[1] * dims[2];
  const reps = new Int32Array(total).fill(-1);
  const domain = new Uint8Array(total);
  const p = [0, 0, 0], q = [0, 0, 0];
  let orbitCount = 0, domainSize = 0;

  for (let index = 0; index < total; index++) {
    if (reps[index] >= 0) continue;
    cellFromIndex(index, dims, p);
    orbitCount++;
    domain[index] = 1;
    domainSize++;
    for (let i = 0; i < group.order; i++) {
      applyOp(group, i, dims, p, q);
      reps[cellIndex(q, dims)] = index;
    }
  }

  const result = { reps, domain, domainSize, orbitCount, dims: dims.slice(), order: group.order };
  if (REP_CACHE.size >= REP_CACHE_LIMIT) REP_CACHE.delete(REP_CACHE.keys().next().value);
  REP_CACHE.set(key, result);
  return result;
}

export function clearOrbitCache() { REP_CACHE.clear(); }

/**
 * Seitz-style text for one operation, e.g. "-y, x+1/2, z+3/4".
 * Written for the UI, and useful when checking a group against the tables.
 */
export function opToString(group, i) {
  const r = group.rot(i);
  const t = group.trans(i);
  const axes = ['x', 'y', 'z'];
  const parts = [];
  for (let k = 0; k < 3; k++) {
    let s = '';
    for (let j = 0; j < 3; j++) {
      const v = r[k * 3 + j];
      if (!v) continue;
      s += v > 0 ? (s ? '+' : '') : '-';
      s += axes[j];
    }
    if (t[k]) s += '+' + fraction(t[k], TWELFTHS);
    parts.push(s || '0');
  }
  return parts.join(', ');
}

function fraction(n, d) {
  const g = gcd(n, d);
  return `${n / g}/${d / g}`;
}
function gcd(a, b) { return b ? gcd(b, a % b) : a; }
