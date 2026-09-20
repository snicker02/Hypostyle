// blockcore/voxels.js
// Sparse voxel storage. Map<packedKey, packedValue>.
//
// Key packing: 17 bits per axis, biased, base-131072 positional.
//   max key = 131072^3 - 1 = 2^51 - 1  -> exactly representable as a Number,
//   so Map lookups stay on the integer fast path and no BigInt is involved.
// Coordinate range: -65536 .. 65535 on every axis. There are no world bounds;
// growth is limited by the cell budget, exactly like IFScraft and Fieldcraft.
//
// Value packing: material id in bits 0-7, shade in bits 8-15. Shade is carried
// through untouched by everything here; it exists for the later surface
// detailer and colour-space palette passes.

export const AXIS_BITS = 17;
export const AXIS_SPAN = 1 << AXIS_BITS;      // 131072
export const AXIS_BIAS = AXIS_SPAN >> 1;      // 65536
export const COORD_MIN = -AXIS_BIAS;
export const COORD_MAX = AXIS_BIAS - 1;

const S1 = AXIS_SPAN;
const S2 = AXIS_SPAN * AXIS_SPAN;

export const DEFAULT_BUDGET = 4_000_000;

export function packKey(x, y, z) {
  return ((x + AXIS_BIAS) * S2) + ((y + AXIS_BIAS) * S1) + (z + AXIS_BIAS);
}

export function unpackKey(key, out = [0, 0, 0]) {
  const z = key % S1;
  const rest = (key - z) / S1;
  const y = rest % S1;
  const x = (rest - y) / S1;
  out[0] = x - AXIS_BIAS;
  out[1] = y - AXIS_BIAS;
  out[2] = z - AXIS_BIAS;
  return out;
}

export function packValue(material, shade = 0) {
  return (material & 0xff) | ((shade & 0xff) << 8);
}
export function valueMaterial(value) { return value & 0xff; }
export function valueShade(value) { return (value >> 8) & 0xff; }

export class BudgetExceeded extends Error {
  constructor(budget) {
    super(`cell budget of ${budget.toLocaleString()} exceeded`);
    this.name = 'BudgetExceeded';
    this.budget = budget;
  }
}

export class VoxelGrid {
  constructor(opts = {}) {
    this.cells = new Map();
    this.budget = opts.budget || DEFAULT_BUDGET;
    this._min = [Infinity, Infinity, Infinity];
    this._max = [-Infinity, -Infinity, -Infinity];
  }

  get size() { return this.cells.size; }

  /** True when (x,y,z) is inside the representable coordinate range. */
  static inRange(x, y, z) {
    return x >= COORD_MIN && x <= COORD_MAX && y >= COORD_MIN && y <= COORD_MAX
        && z >= COORD_MIN && z <= COORD_MAX;
  }

  /**
   * Write one cell. Throws BudgetExceeded when adding a NEW cell would pass the
   * budget; overwriting an existing cell is always allowed.
   * @returns {boolean} true if a new cell was created.
   */
  set(x, y, z, material, shade = 0) {
    if (!VoxelGrid.inRange(x, y, z)) throw new RangeError(`cell out of range: ${x},${y},${z}`);
    const key = packKey(x, y, z);
    const fresh = !this.cells.has(key);
    if (fresh && this.cells.size >= this.budget) throw new BudgetExceeded(this.budget);
    this.cells.set(key, packValue(material, shade));
    if (fresh) this._grow(x, y, z);
    return fresh;
  }

  /** Write only if the cell is empty. @returns {boolean} true if it was written. */
  setIfEmpty(x, y, z, material, shade = 0) {
    const key = packKey(x, y, z);
    if (this.cells.has(key)) return false;
    this.set(x, y, z, material, shade);
    return true;
  }

  get(x, y, z) {
    const v = this.cells.get(packKey(x, y, z));
    return v === undefined ? -1 : v;
  }

  has(x, y, z) { return this.cells.has(packKey(x, y, z)); }

  material(x, y, z) {
    const v = this.cells.get(packKey(x, y, z));
    return v === undefined ? -1 : valueMaterial(v);
  }

  delete(x, y, z) { return this.cells.delete(packKey(x, y, z)); }

  clear() {
    this.cells.clear();
    this._min = [Infinity, Infinity, Infinity];
    this._max = [-Infinity, -Infinity, -Infinity];
  }

  _grow(x, y, z) {
    const mn = this._min, mx = this._max;
    if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x;
    if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
    if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
  }

  /**
   * Bounding box. Recomputed from scratch when cells have been deleted, since
   * _min/_max only ever grow.
   * @returns {{min:number[], max:number[], size:number[], empty:boolean}}
   */
  bounds(recompute = false) {
    if (this.cells.size === 0) {
      return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], empty: true };
    }
    if (recompute || !isFinite(this._min[0])) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      const p = [0, 0, 0];
      for (const key of this.cells.keys()) {
        unpackKey(key, p);
        for (let i = 0; i < 3; i++) {
          if (p[i] < mn[i]) mn[i] = p[i];
          if (p[i] > mx[i]) mx[i] = p[i];
        }
      }
      this._min = mn; this._max = mx;
    }
    const min = this._min.slice(), max = this._max.slice();
    return { min, max, size: [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1], empty: false };
  }

  /** @param {(x:number,y:number,z:number,value:number)=>void} fn */
  forEach(fn) {
    const p = [0, 0, 0];
    for (const [key, value] of this.cells) {
      unpackKey(key, p);
      fn(p[0], p[1], p[2], value);
    }
  }

  /** Histogram of material id -> cell count. */
  materialCounts() {
    const counts = new Map();
    for (const value of this.cells.values()) {
      const m = valueMaterial(value);
      counts.set(m, (counts.get(m) || 0) + 1);
    }
    return counts;
  }

  /** Copy, optionally translated. */
  clone(offset = null) {
    const g = new VoxelGrid({ budget: this.budget });
    if (!offset) {
      g.cells = new Map(this.cells);
      g._min = this._min.slice();
      g._max = this._max.slice();
      return g;
    }
    const p = [0, 0, 0];
    for (const [key, value] of this.cells) {
      unpackKey(key, p);
      g.set(p[0] + offset[0], p[1] + offset[1], p[2] + offset[2],
            valueMaterial(value), valueShade(value));
    }
    return g;
  }

  /** Merge another grid in, translated. Later writes win. */
  merge(other, offset = [0, 0, 0]) {
    const p = [0, 0, 0];
    for (const [key, value] of other.cells) {
      unpackKey(key, p);
      this.set(p[0] + offset[0], p[1] + offset[1], p[2] + offset[2],
               valueMaterial(value), valueShade(value));
    }
    return this;
  }

  /** Cells translated so the bounding box minimum sits at the origin. */
  normalized() {
    const b = this.bounds(true);
    if (b.empty) return this.clone();
    return this.clone([-b.min[0], -b.min[1], -b.min[2]]);
  }
}
