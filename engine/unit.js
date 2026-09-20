// engine/unit.js
// The thing the author actually edits: blocks placed inside one cell.
//
// Blocks may be placed anywhere in the cell, not only inside the asymmetric
// unit. Placing a block outside it is harmless - it lands in the same orbit as
// some block inside it and expands to exactly the same structure - so the
// domain is shown as guidance rather than enforced as a fence.
//
// Coordinates wrap. Dragging a wall off the +x face brings it back on the -x
// face, which is what a periodic cell means and saves a lot of arithmetic when
// authoring something that straddles a cell boundary.

import { VoxelGrid, valueMaterial } from './blockcore/index.js';
import { snapDims, orbitMap, cellIndex } from './symmetry.js';
import { groupByNumber, GROUPS } from './spacegroups.js';

export class UnitCell {
  constructor(opts = {}) {
    this.group = opts.group || groupByNumber(221) || GROUPS[0];
    this.dims = snapDims(this.group, opts.dims || [24, 24, 24]);
    this.blocks = new VoxelGrid({ budget: opts.budget || 200000 });
  }

  /** Wrap a position into the cell. */
  fold(p, out = [0, 0, 0]) {
    for (let a = 0; a < 3; a++) {
      let v = p[a] % this.dims[a];
      if (v < 0) v += this.dims[a];
      out[a] = v;
    }
    return out;
  }

  inCell(p) {
    return p[0] >= 0 && p[0] < this.dims[0]
        && p[1] >= 0 && p[1] < this.dims[1]
        && p[2] >= 0 && p[2] < this.dims[2];
  }

  place(p, material) {
    const q = this.fold(p);
    this.blocks.set(q[0], q[1], q[2], material);
    return q;
  }

  erase(p) {
    const q = this.fold(p);
    return this.blocks.delete(q[0], q[1], q[2]);
  }

  materialAt(p) {
    const q = this.fold(p);
    return this.blocks.material(q[0], q[1], q[2]);
  }

  /** Fill the inclusive box between two corners. */
  box(a, b, material, hollow = false) {
    const lo = [0, 1, 2].map((i) => Math.min(a[i], b[i]));
    const hi = [0, 1, 2].map((i) => Math.max(a[i], b[i]));
    let n = 0;
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) {
          if (hollow && x > lo[0] && x < hi[0] && y > lo[1] && y < hi[1] && z > lo[2] && z < hi[2]) continue;
          this.place([x, y, z], material);
          n++;
        }
      }
    }
    return n;
  }

  eraseBox(a, b) {
    const lo = [0, 1, 2].map((i) => Math.min(a[i], b[i]));
    const hi = [0, 1, 2].map((i) => Math.max(a[i], b[i]));
    let n = 0;
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) if (this.erase([x, y, z])) n++;
      }
    }
    return n;
  }

  clear() { this.blocks.clear(); }

  get count() { return this.blocks.size; }

  /**
   * Change group or cell shape. Blocks are kept where they still fit and
   * folded where they do not, so switching groups mid-edit is not destructive.
   */
  reshape(group, dims) {
    const nextGroup = group || this.group;
    const nextDims = snapDims(nextGroup, dims || this.dims);
    if (nextDims.join() === this.dims.join()) {
      this.group = nextGroup;
      return { moved: 0 };
    }
    const kept = new VoxelGrid({ budget: this.blocks.budget });
    let moved = 0;
    this.blocks.forEach((x, y, z, value) => {
      const q = [0, 1, 2].map((a) => {
        let v = [x, y, z][a] % nextDims[a];
        if (v < 0) v += nextDims[a];
        if (v !== [x, y, z][a]) moved++;
        return v;
      });
      kept.set(q[0], q[1], q[2], valueMaterial(value));
    });
    this.group = nextGroup;
    this.dims = nextDims;
    this.blocks = kept;
    return { moved };
  }

  /** The canonical asymmetric unit for the current group and cell. */
  domain() { return orbitMap(this.group, this.dims); }

  /** How many authored blocks sit inside the canonical asymmetric unit. */
  domainStats() {
    const { domain } = this.domain();
    let inside = 0;
    this.blocks.forEach((x, y, z) => {
      if (domain[cellIndex([x, y, z], this.dims)]) inside++;
    });
    return { inside, outside: this.blocks.size - inside };
  }

  toJSON() {
    const cells = [];
    this.blocks.forEach((x, y, z, value) => cells.push(x, y, z, valueMaterial(value)));
    return {
      format: 'hypostyle.unit',
      version: 1,
      group: this.group.number,
      setting: this.group.choice,
      dims: this.dims.slice(),
      cells,
    };
  }

  static fromJSON(data) {
    if (!data || data.format !== 'hypostyle.unit') throw new Error('not a Hypostyle unit file');
    const group = groupByNumber(data.group);
    if (!group) throw new Error(`unknown space group ${data.group}`);
    const unit = new UnitCell({ group, dims: data.dims });
    const cells = data.cells || [];
    for (let i = 0; i + 3 < cells.length; i += 4) {
      unit.place([cells[i], cells[i + 1], cells[i + 2]], cells[i + 3]);
    }
    return unit;
  }
}
