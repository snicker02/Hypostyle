// engine/wfc/modules.js
// A module is 3x3x3 blocks. That is the whole of it - there are no sockets, no
// hand-typed tags saying "this side is a wall". Everything about how modules
// fit together is read back out of the blocks themselves.
//
// Local axes are the app's: x, y horizontal, z UP, matching the crystallographic
// c axis the skeleton is authored in. Index order is
//
//     i = (x * 3 + y) * 3 + z
//
// A cell holds -1 for air or a material id from the blockcore palette.
//
// FACES. Each of the six directions has an outer 3x3 layer. Two modules fit
// across a face when those layers agree. They are compared as SOLIDITY, not as
// material: a stone wall and a sandstone wall are the same wall as far as
// fitting goes, which leaves material free to vary without multiplying the
// module set. Nine positions, nine bits, one integer per face - so a comparison
// is a single ===.
//
// The tangential ordering is chosen so that a face and the face it meets index
// the same physical positions in the same order:
//
//     +x / -x   layer x=2 / x=0, ordered (y * 3 + z)
//     +y / -y   layer y=2 / y=0, ordered (x * 3 + z)
//     +z / -z   layer z=2 / z=0, ordered (x * 3 + y)
//
// VARIANTS. Every module is expanded by the lattice rotations that keep up
// pointing up - the four quarter turns about z, with and without a mirror in x,
// so eight at most. The full 24 rotations of the cube are deliberately not
// used: they would tip a floor onto a wall, and the vertical is not
// interchangeable with the horizontal in a building. Variants that come out
// identical are dropped, so a symmetric module contributes once.

export const MODULE_EDGE = 3;
export const MODULE_CELLS = 27;
export const AIR = -1;

export const DIRS = Object.freeze([
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
]);
export const DIR_NAMES = Object.freeze(['+x', '-x', '+y', '-y', '+z', '-z']);
/** The face a given direction meets. */
export function opposite(d) { return d ^ 1; }

export function idx(x, y, z) { return (x * 3 + y) * 3 + z; }

/** Letters used by the library, mapped to blockcore material ids. */
export const LETTERS = Object.freeze({
  '.': AIR, ' ': AIR,
  S: 0, C: 1, M: 2, A: 3, Q: 4, P: 5, D: 6, U: 7,
  K: 8, B: 9, O: 10, W: 11, R: 12, I: 13, G: 14, L: 15,
});

/**
 * Parse three layers of three rows of three characters.
 * layers[0] is z = 0, the bottom. Within a layer, row index is y and character
 * index is x, so the text reads like a plan seen from above.
 */
export function parseLayers(layers) {
  if (!Array.isArray(layers) || layers.length !== 3) {
    throw new Error('a module needs exactly 3 layers');
  }
  const cells = new Int16Array(MODULE_CELLS).fill(AIR);
  for (let z = 0; z < 3; z++) {
    const layer = layers[z];
    if (!Array.isArray(layer) || layer.length !== 3) {
      throw new Error(`layer ${z} needs exactly 3 rows`);
    }
    for (let y = 0; y < 3; y++) {
      const row = layer[y];
      if (typeof row !== 'string' || row.length !== 3) {
        throw new Error(`layer ${z} row ${y} needs exactly 3 characters`);
      }
      for (let x = 0; x < 3; x++) {
        const ch = row[x];
        if (!(ch in LETTERS)) throw new Error(`unknown material letter "${ch}"`);
        cells[idx(x, y, z)] = LETTERS[ch];
      }
    }
  }
  return cells;
}

/** Quarter turn about the vertical: (x, y) -> (2 - y, x). */
export function rotateZ(cells) {
  const out = new Int16Array(MODULE_CELLS).fill(AIR);
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      for (let z = 0; z < 3; z++) out[idx(2 - y, x, z)] = cells[idx(x, y, z)];
    }
  }
  return out;
}

/** Mirror in x: (x, y) -> (2 - x, y). */
export function mirrorX(cells) {
  const out = new Int16Array(MODULE_CELLS).fill(AIR);
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      for (let z = 0; z < 3; z++) out[idx(2 - x, y, z)] = cells[idx(x, y, z)];
    }
  }
  return out;
}

/** The nine positions of one outer layer, in the shared tangential order. */
export function faceCells(cells, d) {
  const out = new Int16Array(9);
  switch (d) {
    case 0: for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) out[y * 3 + z] = cells[idx(2, y, z)]; break;
    case 1: for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) out[y * 3 + z] = cells[idx(0, y, z)]; break;
    case 2: for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) out[x * 3 + z] = cells[idx(x, 2, z)]; break;
    case 3: for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) out[x * 3 + z] = cells[idx(x, 0, z)]; break;
    case 4: for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) out[x * 3 + y] = cells[idx(x, y, 2)]; break;
    case 5: for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) out[x * 3 + y] = cells[idx(x, y, 0)]; break;
    default: throw new RangeError(`no direction ${d}`);
  }
  return out;
}

/** Nine solidity bits of a face, as one integer. */
export function faceProfile(cells, d) {
  const f = faceCells(cells, d);
  let bits = 0;
  for (let i = 0; i < 9; i++) if (f[i] !== AIR) bits |= 1 << i;
  return bits;
}

/**
 * Positions of a horizontal face that sit at the bottom of the module.
 * Used by the skeleton boundary rule: a floor is allowed to run through a
 * threshold, so the lowest row of a side face is exempt from it.
 */
export const HORIZONTAL_BOTTOM_MASK = (1 << 0) | (1 << 3) | (1 << 6);
export function isHorizontal(d) { return d < 4; }

export function contentKey(cells) {
  let s = '';
  for (let i = 0; i < MODULE_CELLS; i++) s += (cells[i] === AIR ? 'x' : cells[i].toString(16)) + ',';
  return s;
}

export function solidCount(cells) {
  let n = 0;
  for (let i = 0; i < MODULE_CELLS; i++) if (cells[i] !== AIR) n++;
  return n;
}

/** One placed orientation of one authored module. */
export class Variant {
  constructor(cells, def, index) {
    this.cells = cells;
    this.name = def.name;
    this.band = def.band || 'any';
    this.weight = def.weight;
    this.index = index;
    this.profiles = new Int32Array(6);
    for (let d = 0; d < 6; d++) this.profiles[d] = faceProfile(cells, d);
    this.solid = solidCount(cells);
  }
}

/**
 * Expand authored definitions into the variant set the solver works on.
 * @param {Array} defs  { name, band, weight, layers, symmetry }
 *   symmetry: 'full' (default, 4 turns + mirror), 'rotate' (4 turns only),
 *   'fixed' (as authored).
 * @returns {{variants:Variant[], byName:Map, families:number}}
 */
export function buildVariants(defs) {
  const variants = [];
  const byName = new Map();
  for (const def of defs) {
    const base = def.cells ? Int16Array.from(def.cells) : parseLayers(def.layers);
    const forms = [];
    const seen = new Set();
    const mirrors = def.symmetry === 'rotate' || def.symmetry === 'fixed' ? [false] : [false, true];
    const turns = def.symmetry === 'fixed' ? 1 : 4;
    for (const mirror of mirrors) {
      let cells = mirror ? mirrorX(base) : base;
      for (let r = 0; r < turns; r++) {
        const key = contentKey(cells);
        if (!seen.has(key)) { seen.add(key); forms.push(cells); }
        cells = rotateZ(cells);
      }
    }
    // Weight is shared across a family's orientations, so a module that happens
    // to have eight distinct turns is no more likely than a symmetric one.
    const share = (def.weight === undefined ? 1 : def.weight) / forms.length;
    const list = [];
    for (const cells of forms) {
      const v = new Variant(cells, { ...def, weight: share }, variants.length);
      variants.push(v);
      list.push(v);
    }
    byName.set(def.name, list);
  }
  return { variants, byName, families: defs.length };
}
