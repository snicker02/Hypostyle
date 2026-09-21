// engine/presets.js
// Worked examples. Each is a single asymmetric unit; the group does the rest.
// They exist to answer the only question the skeleton has to answer: does it
// produce architecture, or does it produce interesting rubble?
//
// Height is the crystallographic c axis (z). Groups that are polar along c -
// 4mm, mm2 and their relatives - are the useful ones for buildings, because a
// floor and a capital are not mirror images of each other. A mirror
// perpendicular to c stacks the structure on its own reflection, which is what
// a vault sometimes wants and a colonnade never does.
//
// Cubic groups make all three axes equivalent. That buys cross vaults in every
// direction and costs you the idea of a floor: you cannot have a solid slab
// underfoot and an open arch beside you, because the group cannot tell those
// two directions apart. The cubic presets lean into that rather than fighting
// it, and the enclosed rooms come from the tetragonal ones instead.
//
// HOW MUCH TO AUTHOR. The rule of thumb is that authored volume times the
// group order is roughly what you get, less whatever lands on a special
// position. So Pmm2 with four operations wants a whole quadrant drawn, and
// Fm-3m with a hundred and ninety-two wants a single strut. Author a quadrant
// in Fm-3m and the cell comes out solid. Every preset here is checked by the
// validator to land between five and sixty per cent fill, which is the band
// where a build reads as a building rather than as a block or a haze.

import { UnitCell } from './unit.js';
import { groupByNumber } from './spacegroups.js';

// Material ids by name, so the presets read as building material.
const M = {
  stone: 0, chiselled: 1, mossy: 2, andesite: 3,
  quartz: 4, pillar: 5, sandstone: 6, cutSandstone: 7,
  deepslate: 8, blackstone: 9, oak: 10, darkOak: 11,
  copper: 12, prismarine: 13, glass: 14, glow: 15,
};

/** Inclusive box from three ranges. */
function box(unit, x, y, z, material) {
  unit.box([x[0], y[0], z[0]], [x[1], y[1], z[1]], material);
}

function cut(unit, x, y, z) {
  unit.eraseBox([x[0], y[0], z[0]], [x[1], y[1], z[1]]);
}

/**
 * Cut a round-headed opening out of a wall that has already been built.
 * The wall's thickness runs along `thickness` on axis `wallAxis`; the opening
 * runs along axis `openAxis`, is centred on `centre` with radius `r`, and its
 * springing is at height `spring`.
 */
function archCut(unit, wallAxis, thickness, openAxis, from, to, centre, r, spring) {
  const p = [0, 0, 0];
  const heightAxis = 3 - wallAxis - openAxis;
  for (let d = thickness[0]; d <= thickness[1]; d++) {
    for (let u = from; u <= to; u++) {
      const du = u - centre + 0.5;
      const head = spring + Math.floor(Math.sqrt(Math.max(0, r * r - du * du)));
      for (let h = 0; h <= head; h++) {
        p[wallAxis] = d;
        p[openAxis] = u;
        p[heightAxis] = h;
        unit.erase(p);
      }
    }
  }
}

/**
 * A run of stair treads following an arc. Authored as a fraction of a turn; a
 * screw axis of the right order and hand then continues it into a helix that
 * closes on itself, which is the whole reason the screw-axis presets exist.
 */
function helicalFlight(unit, opts) {
  const { centre, inner, outer, fromAngle, toAngle, steps, baseZ, rise, material } = opts;
  for (let i = 0; i < steps; i++) {
    const a = fromAngle + ((toAngle - fromAngle) * i) / steps;
    const z = baseZ + Math.round(i * rise);
    for (let r = inner; r <= outer; r++) {
      const x = Math.round(centre[0] + Math.cos(a) * r);
      const y = Math.round(centre[1] + Math.sin(a) * r);
      unit.place([x, y, z], material);
      if (i > 0) unit.place([x, y, z - 1], material);
    }
  }
}

/** A diagonal strut of square cross-section, stepped one block at a time. */
function strut(unit, from, to, material, thickness = 1) {
  const steps = Math.max(
    Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), Math.abs(to[2] - from[2]),
  );
  const t = thickness - 1;
  for (let i = 0; i <= steps; i++) {
    const p = [0, 1, 2].map((a) => Math.round(from[a] + ((to[a] - from[a]) * i) / steps));
    unit.box(p, [p[0] + t, p[1] + t, p[2] + t], material);
  }
}

export const PRESETS = [
  /* ============================================================ tetragonal */

  {
    id: 'hypostyle-hall',
    name: 'Hypostyle hall',
    note: 'P4mm, cell 24. A quarter of one column and one beam stub. The '
        + 'four-fold builds the rest of the column and turns one beam into both '
        + 'directions; the lattice turns one bay into the forest.',
    group: 99,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.sandstone);          // floor
      box(unit, [0, 3], [0, 3], [1, 16], M.cutSandstone);        // shaft
      box(unit, [0, 4], [0, 4], [17, 17], M.sandstone);          // necking
      box(unit, [0, 5], [0, 5], [18, 19], M.cutSandstone);       // capital
      box(unit, [0, 11], [0, 2], [20, 21], M.sandstone);         // architrave
      box(unit, [0, 11], [0, 11], [22, 22], M.cutSandstone);     // roof
      cut(unit, [7, 11], [7, 11], [22, 22]);                     // light well
      box(unit, [0, 1], [0, 1], [21, 21], M.glow);
    },
  },

  {
    id: 'cloister-cells',
    name: 'Cloister cells',
    note: 'P4mm, cell 24. Floor, ceiling and one wall with a doorway and a '
        + 'window. The four-fold walls all four sides, so every bay closes into '
        + 'a room - the enclosed voids the interiors pass likes best.',
    group: 99,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.stone);              // floor
      box(unit, [0, 11], [0, 11], [23, 23], M.deepslate);        // ceiling
      box(unit, [0, 0], [0, 11], [1, 22], M.stone);              // party wall
      box(unit, [0, 0], [0, 11], [22, 22], M.chiselled);         // wall head
      archCut(unit, 0, [0, 0], 1, 8, 11, 12, 4, 1);              // doorway
      box(unit, [0, 0], [9, 11], [14, 17], M.glass);             // window
      box(unit, [1, 2], [1, 2], [22, 22], M.glow);               // corner lamp
      box(unit, [1, 1], [1, 1], [1, 21], M.oak);                 // corner post
    },
  },

  {
    id: 'staggered-hall',
    name: 'Staggered hall',
    note: 'I4mm, cell 36. Body centring puts a second column at the middle of '
        + 'the cell, half a storey up, so the bays interlock instead of '
        + 'stacking. Sixteen operations from one authored bracket.',
    group: 107,
    dims: [36, 36, 36],
    build(unit) {
      box(unit, [0, 17], [0, 17], [0, 0], M.deepslate);          // floor
      box(unit, [0, 4], [0, 4], [1, 22], M.blackstone);          // column
      box(unit, [0, 6], [0, 6], [23, 24], M.deepslate);          // capital
      box(unit, [0, 12], [0, 3], [25, 26], M.blackstone);        // bracket
      box(unit, [0, 17], [0, 2], [27, 28], M.deepslate);         // beam
      box(unit, [0, 17], [0, 17], [29, 29], M.blackstone);       // gallery deck
      cut(unit, [8, 17], [8, 17], [29, 29]);                     // bay opening
      box(unit, [0, 2], [0, 2], [24, 24], M.glow);
      box(unit, [0, 5], [0, 5], [30, 33], M.copper);             // upper stub
    },
  },

  {
    id: 'spiral-stair',
    name: 'Spiral stair',
    note: 'P4_1, cell 24 x 24 x 48. A quarter turn of treads, twelve blocks '
        + 'high. The four-fold screw lifts each image by a quarter of the cell, '
        + 'so the quarter turn closes into an unbroken helix that repeats up '
        + 'the lattice forever. This is the preset that proves the screw axes '
        + 'are the right hand.',
    group: 76,
    dims: [24, 24, 48],
    build(unit) {
      box(unit, [10, 13], [10, 13], [0, 47], M.chiselled);       // newel
      helicalFlight(unit, {
        centre: [12, 12], inner: 4, outer: 9,
        fromAngle: 0, toAngle: Math.PI / 2, steps: 12,
        baseZ: 0, rise: 1, material: M.stone,
      });
      box(unit, [0, 1], [0, 23], [0, 47], M.mossy);              // shaft wall
      box(unit, [0, 1], [4, 7], [6, 11], M.glass);               // slit window
      box(unit, [10, 13], [10, 13], [11, 11], M.glow);
    },
  },

  {
    id: 'spiral-stair-left',
    name: 'Spiral stair, other hand',
    note: 'P4_3, cell 24 x 24 x 48. Exactly the same authored flight as the '
        + 'P4_1 preset. The only difference is the hand of the screw, and the '
        + 'stair winds the other way. Build both and stand between them.',
    group: 78,
    dims: [24, 24, 48],
    build(unit) {
      box(unit, [10, 13], [10, 13], [0, 47], M.chiselled);
      helicalFlight(unit, {
        centre: [12, 12], inner: 4, outer: 9,
        fromAngle: 0, toAngle: Math.PI / 2, steps: 12,
        baseZ: 0, rise: 1, material: M.sandstone,
      });
      box(unit, [0, 1], [0, 23], [0, 47], M.cutSandstone);
      box(unit, [0, 1], [4, 7], [6, 11], M.glass);
      box(unit, [10, 13], [10, 13], [11, 11], M.glow);
    },
  },

  {
    id: 'lantern-tower',
    name: 'Lantern tower',
    note: 'P4/mmm, cell 24. The horizontal mirror is the point: everything '
        + 'built in the lower half appears upside down in the upper, so the '
        + 'tower is its own reflection and the glazed band lands exactly at '
        + 'mid height. Sixteen operations.',
    group: 123,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 1], M.andesite);           // deck
      box(unit, [0, 2], [0, 2], [2, 8], M.quartz);               // corner shaft
      box(unit, [0, 11], [0, 1], [2, 4], M.quartz);              // spandrel
      box(unit, [4, 11], [0, 1], [5, 9], M.glass);               // lantern glazing
      box(unit, [0, 3], [0, 1], [9, 11], M.pillar);              // mullion head
      box(unit, [0, 1], [0, 1], [10, 11], M.glow);
    },
  },

  {
    id: 'pinwheel-court',
    name: 'Pinwheel court',
    note: 'P4, cell 36 x 36 x 24. Rotations only, no mirrors at all, so the '
        + 'plan is chiral: four L-shaped wings chase each other around the '
        + 'court and never close into a square. Four operations.',
    group: 75,
    dims: [36, 36, 24],
    build(unit) {
      box(unit, [0, 35], [0, 35], [0, 0], M.stone);              // ground
      box(unit, [0, 21], [0, 2], [1, 14], M.oak);                // long wing
      box(unit, [0, 2], [3, 13], [1, 14], M.oak);                // return
      box(unit, [0, 21], [0, 3], [15, 16], M.darkOak);           // eaves
      box(unit, [0, 3], [3, 13], [15, 16], M.darkOak);
      box(unit, [4, 18], [0, 2], [5, 9], M.glass);               // shopfront
      box(unit, [20, 21], [0, 2], [1, 16], M.chiselled);         // corner pier
      box(unit, [1, 2], [1, 2], [14, 14], M.glow);
    },
  },

  {
    id: 'glide-piers',
    name: 'Glide piers',
    note: 'P4bm, cell 24. The b glide slides half a cell as it reflects, so '
        + 'the piers on one side sit opposite the gaps on the other. Nothing '
        + 'here lines up with itself and the arcade reads as woven.',
    group: 100,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.deepslate);          // floor
      box(unit, [0, 4], [0, 4], [1, 15], M.stone);               // pier
      box(unit, [0, 5], [0, 5], [16, 17], M.chiselled);          // impost
      box(unit, [0, 11], [0, 3], [18, 19], M.stone);             // lintel
      box(unit, [0, 11], [0, 11], [20, 20], M.mossy);            // soffit
      cut(unit, [6, 11], [6, 11], [20, 20]);
      box(unit, [0, 1], [0, 1], [17, 17], M.glow);
    },
  },

  {
    id: 'water-court',
    name: 'Water court',
    note: 'P4/n, cell 24. The n glide carries a diagonal half-shift with its '
        + 'reflection, which offsets the upper storey from the lower by half a '
        + 'cell in both directions - galleries that overhang the court they '
        + 'look into.',
    group: 85,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.andesite);           // paving
      box(unit, [2, 9], [2, 9], [0, 0], M.prismarine);           // basin
      box(unit, [0, 1], [0, 11], [1, 9], M.cutSandstone);        // court wall
      box(unit, [0, 11], [0, 1], [1, 9], M.cutSandstone);
      box(unit, [0, 11], [0, 2], [10, 11], M.sandstone);         // gallery deck
      box(unit, [0, 2], [3, 11], [10, 11], M.sandstone);
      box(unit, [0, 1], [0, 1], [9, 9], M.glow);
    },
  },

  {
    id: 'lattice-tower',
    name: 'Lattice tower',
    note: 'I4, cell 24 x 24 x 36. Body centring plus a pure four-fold: the '
        + 'second tower sits at the middle of the cell, half a storey up and '
        + 'rotated, so the diagonal braces of one pass through the bays of the '
        + 'next without ever meeting.',
    group: 79,
    dims: [24, 24, 36],
    build(unit) {
      box(unit, [0, 3], [0, 3], [0, 35], M.copper);              // leg
      strut(unit, [0, 0, 0], [11, 0, 17], M.blackstone, 2);      // brace
      strut(unit, [0, 0, 18], [11, 0, 35], M.blackstone, 2);
      box(unit, [0, 11], [0, 1], [17, 18], M.deepslate);         // tie
      box(unit, [0, 11], [0, 1], [35, 35], M.deepslate);
      box(unit, [0, 1], [0, 1], [18, 18], M.glow);
    },
  },

  {
    id: 'deep-arcade',
    name: 'Deep arcade',
    note: 'P4cc, cell 24 x 24 x 36. Both glides run along c, so every mirror '
        + 'image is also lifted half a cell. The arcade climbs as it turns and '
        + 'the storeys never align.',
    group: 103,
    dims: [24, 24, 36],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.stone);
      box(unit, [0, 3], [0, 3], [1, 14], M.blackstone);          // pier
      box(unit, [0, 11], [0, 2], [15, 24], M.stone);             // spandrel
      archCut(unit, 1, [0, 2], 0, 4, 11, 12, 8, 15);
      box(unit, [0, 11], [0, 3], [25, 26], M.chiselled);         // cornice
      box(unit, [0, 11], [0, 11], [35, 35], M.deepslate);        // deck over
      cut(unit, [6, 11], [6, 11], [35, 35]);
      box(unit, [0, 1], [0, 1], [24, 24], M.glow);
    },
  },

  {
    id: 'hall-of-tombs',
    name: 'Hall of tombs',
    note: 'I4/mmm, cell 24. Thirty-two operations: four-fold, every mirror, '
        + 'and body centring on top. One authored niche becomes a wall of '
        + 'niches facing every direction, above and below.',
    group: 139,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 1], [0, 11], [0, 11], M.deepslate);          // wall slab
      cut(unit, [0, 1], [4, 9], [2, 7]);                         // niche
      box(unit, [0, 0], [3, 10], [1, 1], M.blackstone);          // sill
      box(unit, [0, 11], [0, 1], [0, 1], M.blackstone);          // plinth run
      box(unit, [0, 1], [0, 1], [8, 8], M.glow);
    },
  },

  {
    id: 'vaulted-chamber',
    name: 'Vaulted chamber',
    note: 'P-4m2, cell 24. The four-fold rotoinversion turns a quarter turn '
        + 'and then inverts, so the springing of a rib on one side becomes the '
        + 'crown of the rib at right angles to it. Vaults that cross without '
        + 'being mirrored.',
    group: 115,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.sandstone);
      box(unit, [0, 2], [0, 2], [1, 12], M.cutSandstone);        // respond
      for (let i = 0; i <= 9; i++) {                             // rib
        const h = 13 + Math.round(Math.sqrt(Math.max(0, 81 - (9 - i) * (9 - i))) * 0.7);
        box(unit, [i, i + 1], [0, 1], [h - 1, h], M.chiselled);
      }
      box(unit, [0, 11], [0, 1], [11, 12], M.sandstone);         // wall head
      box(unit, [0, 1], [0, 1], [12, 12], M.glow);
    },
  },

  {
    id: 'helical-frame',
    name: 'Helical frame',
    note: 'I4_1, cell 24 x 24 x 48. A four-fold screw with body centring: two '
        + 'interpenetrating helices, offset by half a cell, neither touching '
        + 'the other. The authored piece is one strut and one landing.',
    group: 80,
    dims: [24, 24, 48],
    build(unit) {
      strut(unit, [4, 4, 0], [19, 4, 11], M.copper, 2);          // rising strut
      box(unit, [0, 23], [0, 3], [12, 13], M.darkOak);           // landing
      box(unit, [0, 3], [0, 3], [0, 13], M.blackstone);          // post
      box(unit, [0, 3], [0, 3], [13, 13], M.glow);
    },
  },

  /* ========================================================== orthorhombic */

  {
    id: 'arcade',
    name: 'Arcade and clerestory',
    note: 'Pmm2, cell 24 x 24 x 36. A pier, the arch springing from it and a '
        + 'glazed band above. The two mirrors close the arch and face the aisle '
        + 'both ways; nothing here is drawn twice.',
    group: 25,
    dims: [24, 24, 36],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.stone);              // floor
      box(unit, [0, 4], [0, 4], [1, 1], M.chiselled);            // plinth
      box(unit, [0, 3], [0, 3], [2, 15], M.stone);               // pier
      box(unit, [0, 4], [0, 4], [16, 16], M.chiselled);          // impost
      box(unit, [0, 11], [0, 2], [17, 27], M.stone);             // spandrel
      archCut(unit, 1, [0, 2], 0, 4, 11, 12, 8, 17);             // arch head
      box(unit, [0, 11], [0, 2], [28, 28], M.chiselled);         // string course
      box(unit, [4, 11], [0, 2], [29, 32], M.glass);             // clerestory
      box(unit, [0, 3], [0, 2], [29, 32], M.stone);              // mullion
      box(unit, [0, 11], [0, 3], [33, 34], M.stone);             // cornice
      box(unit, [0, 11], [0, 11], [35, 35], M.deepslate);        // roof
      box(unit, [0, 1], [0, 1], [27, 27], M.glow);
    },
  },

  {
    id: 'basilica',
    name: 'Basilica',
    note: 'Pmm2, cell 36 x 24 x 36. A wide cell instead of a square one, so '
        + 'the mirrors give a tall nave with a lower aisle either side rather '
        + 'than a uniform grid. Same group as the arcade, different proportion, '
        + 'completely different building.',
    group: 25,
    dims: [36, 24, 36],
    build(unit) {
      box(unit, [0, 17], [0, 11], [0, 0], M.stone);              // floor
      box(unit, [12, 15], [0, 3], [1, 18], M.chiselled);         // nave pier
      box(unit, [12, 17], [0, 2], [19, 21], M.stone);            // arcade head
      box(unit, [0, 11], [0, 11], [12, 12], M.deepslate);        // aisle roof
      cut(unit, [2, 9], [2, 9], [12, 12]);
      box(unit, [0, 1], [0, 11], [1, 12], M.mossy);              // outer wall
      archCut(unit, 0, [0, 1], 1, 4, 9, 7, 3, 1);                // aisle door
      box(unit, [12, 17], [0, 2], [26, 31], M.glass);            // clerestory
      box(unit, [12, 17], [0, 11], [35, 35], M.deepslate);       // nave roof
      box(unit, [13, 14], [0, 1], [21, 21], M.glow);
    },
  },

  {
    id: 'chiral-bays',
    name: 'Chiral bays',
    note: 'P222, cell 24. Three perpendicular two-folds and not one mirror, '
        + 'so the bay has a handedness: the stair turns the same way in every '
        + 'copy and the building cannot be reflected onto itself.',
    group: 16,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.andesite);
      box(unit, [0, 11], [0, 1], [1, 11], M.oak);                // spine wall
      box(unit, [0, 1], [0, 11], [1, 7], M.oak);                 // return
      for (let i = 0; i < 10; i++) {                             // stair run
        box(unit, [2 + i, 2 + i], [2, 5], [i, i + 1], M.darkOak);
      }
      box(unit, [0, 11], [0, 11], [12, 12], M.deepslate);        // deck
      cut(unit, [2, 8], [6, 11], [12, 12]);                      // stairwell
      box(unit, [0, 1], [0, 1], [11, 11], M.glow);
    },
  },

  {
    id: 'zigzag-wall',
    name: 'Zigzag wall',
    note: 'Pba2, cell 24. Two axial glides at right angles. Each reflection '
        + 'shifts half a cell along the wall, so a straight authored panel '
        + 'comes out as a serpentine - a crinkle-crankle wall that braces '
        + 'itself.',
    group: 32,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.stone);
      box(unit, [0, 11], [0, 2], [1, 14], M.mossy);              // panel
      box(unit, [0, 2], [0, 11], [1, 14], M.mossy);              // return
      box(unit, [0, 11], [0, 3], [15, 16], M.chiselled);         // coping
      box(unit, [0, 3], [0, 11], [15, 16], M.chiselled);
      box(unit, [4, 8], [0, 2], [4, 8], M.glass);                // pierced panel
      box(unit, [0, 1], [0, 1], [16, 16], M.glow);
    },
  },

  {
    id: 'long-gallery',
    name: 'Long gallery',
    note: 'Cmm2, cell 36 x 24 x 24. C centring adds a copy at the middle of '
        + 'the a-b face, so the bays interleave along the gallery and the '
        + 'rhythm is twice as fine as the cell.',
    group: 35,
    dims: [36, 24, 24],
    build(unit) {
      box(unit, [0, 17], [0, 11], [0, 0], M.oak);                // boarded floor
      box(unit, [0, 17], [0, 1], [1, 16], M.stone);              // side wall
      box(unit, [3, 8], [0, 1], [3, 10], M.glass);               // window
      box(unit, [0, 2], [0, 5], [1, 16], M.chiselled);           // chimney breast
      box(unit, [0, 17], [0, 11], [17, 18], M.darkOak);          // ceiling beams
      cut(unit, [4, 13], [3, 11], [17, 17]);
      box(unit, [0, 1], [0, 1], [15, 15], M.glow);
    },
  },

  {
    id: 'terraced-steps',
    name: 'Terraced steps',
    note: 'P2_12_12_1, cell 24. Three screw axes and nothing else: every copy '
        + 'is rotated and shifted half a cell, so terraces step past each '
        + 'other in all three directions at once. Utterly chiral.',
    group: 19,
    dims: [24, 24, 24],
    build(unit) {
      for (let i = 0; i < 6; i++) {                              // stepped terrace
        box(unit, [0, 23], [4 * i, 4 * i + 3], [2 * i, 2 * i + 1], M.sandstone);
      }
      box(unit, [0, 2], [0, 23], [0, 13], M.cutSandstone);       // retaining wall
      box(unit, [8, 11], [0, 23], [12, 13], M.mossy);            // planting bed
      box(unit, [0, 1], [0, 1], [13, 13], M.glow);
    },
  },

  {
    id: 'transept',
    name: 'Transept',
    note: 'Cmcm, cell 24 x 36 x 24. A mirror one way, a c glide the other, '
        + 'and C centring through both. The cross arm meets the main range '
        + 'half a storey out of step, which is what makes a crossing read as a '
        + 'crossing.',
    group: 63,
    dims: [24, 36, 24],
    build(unit) {
      box(unit, [0, 11], [0, 17], [0, 0], M.stone);
      cut(unit, [4, 11], [6, 17], [0, 0]);                       // open crossing
      box(unit, [0, 1], [0, 17], [1, 15], M.stone);              // range wall
      archCut(unit, 0, [0, 1], 1, 5, 12, 9, 4, 1);               // arcade opening
      box(unit, [0, 11], [0, 1], [1, 19], M.chiselled);          // cross arm wall
      box(unit, [0, 11], [0, 17], [16, 16], M.deepslate);        // aisle roof
      cut(unit, [3, 11], [0, 13], [16, 16]);
      box(unit, [0, 5], [0, 1], [20, 22], M.glass);              // gable window
      box(unit, [0, 1], [0, 1], [15, 15], M.glow);
    },
  },

  {
    id: 'open-frame',
    name: 'Open frame',
    note: 'Fmm2, cell 24. All-face centring quadruples every operation, so a '
        + 'single authored post and beam becomes a dense frame with members at '
        + 'every half-cell offset. Sixteen operations from three boxes.',
    group: 42,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 2], [0, 2], [0, 17], M.darkOak);             // post
      box(unit, [0, 11], [0, 1], [18, 19], M.oak);               // beam
      box(unit, [0, 1], [0, 11], [18, 19], M.oak);               // cross beam
      box(unit, [0, 11], [0, 11], [20, 20], M.stone);            // deck
      cut(unit, [4, 11], [4, 11], [20, 20]);
      box(unit, [0, 1], [0, 1], [19, 19], M.glow);
    },
  },

  {
    id: 'braced-block',
    name: 'Braced block',
    note: 'Ibam, cell 24. Body centring with two axial glides: a diagonal '
        + 'brace authored once reappears rotated and half-shifted, and the '
        + 'braces cross at the middle of every cell.',
    group: 72,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.blackstone);
      strut(unit, [0, 0, 1], [11, 0, 12], M.copper, 2);          // brace
      box(unit, [0, 2], [0, 2], [1, 12], M.deepslate);           // corner post
      box(unit, [0, 11], [0, 1], [13, 14], M.deepslate);         // ring beam
      box(unit, [0, 1], [0, 11], [13, 14], M.deepslate);
      box(unit, [0, 1], [0, 1], [12, 12], M.glow);
    },
  },

  {
    id: 'cellular-rows',
    name: 'Cellular rows',
    note: 'Pnma, cell 24. Diagonal and axial glides together. Rooms in rows '
        + 'that shift half a cell every time they repeat, so no corridor runs '
        + 'straight for more than one bay.',
    group: 62,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.andesite);
      box(unit, [0, 1], [0, 11], [1, 10], M.stone);              // cell wall
      box(unit, [0, 11], [0, 1], [1, 10], M.stone);
      archCut(unit, 0, [0, 1], 1, 4, 8, 6, 3, 1);                // door
      box(unit, [0, 11], [0, 11], [11, 11], M.mossy);            // cell ceiling
      box(unit, [4, 7], [4, 7], [11, 11], M.glass);              // oculus
      box(unit, [0, 1], [0, 1], [10, 10], M.glow);
    },
  },

  {
    id: 'clerestory-loft',
    name: 'Clerestory loft',
    note: 'Amm2, cell 24 x 24 x 36. A-face centring offsets a copy by half a '
        + 'cell in b and c together, so the upper lights sit between the lower '
        + 'ones instead of above them.',
    group: 38,
    dims: [24, 24, 36],
    build(unit) {
      box(unit, [0, 11], [0, 11], [0, 0], M.oak);
      box(unit, [0, 11], [0, 1], [1, 16], M.stone);              // long wall
      box(unit, [3, 9], [0, 1], [6, 12], M.glass);               // window
      box(unit, [0, 1], [0, 11], [1, 16], M.stone);              // end wall
      box(unit, [0, 11], [0, 11], [17, 17], M.darkOak);          // loft floor
      cut(unit, [6, 11], [6, 11], [17, 17]);                     // ladder well
      box(unit, [0, 11], [0, 2], [18, 25], M.stone);             // upper wall
      box(unit, [0, 1], [0, 1], [16, 16], M.glow);
    },
  },

  /* ================================================================= cubic */

  {
    id: 'cubic-crypt',
    name: 'Cubic crypt',
    note: 'Pm-3m, cell 24. One corner pier, one edge rib and one face web with '
        + 'an arch in it. All 48 operations turn that into piers on every '
        + 'corner, ribs on all twelve edges and an arch through all six faces.',
    group: 221,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 3], [0, 3], [0, 3], M.stone);                // corner pier
      box(unit, [4, 11], [0, 2], [0, 2], M.mossy);               // edge rib
      for (let x = 4; x <= 11; x++) {                            // rib haunch
        const h = Math.max(0, 3 - Math.round((x - 4) * 0.45));
        box(unit, [x, x], [0, h], [0, h], M.chiselled);
      }
      box(unit, [0, 11], [0, 1], [0, 11], M.andesite);           // face web
      archCut(unit, 1, [0, 1], 0, 4, 11, 12, 8.5, 0);            // arch
    },
  },

  {
    id: 'cubic-cage',
    name: 'Cubic cage',
    note: 'Pm-3, cell 24. The same cubic frame as the crypt but without the '
        + 'diagonal mirrors, so the faces can carry a pattern that is not '
        + 'symmetric about its own diagonal. Twenty-four operations.',
    group: 200,
    dims: [24, 24, 24],
    build(unit) {
      box(unit, [0, 11], [0, 2], [0, 2], M.blackstone);          // edge bar
      box(unit, [0, 2], [0, 11], [0, 2], M.blackstone);
      box(unit, [4, 9], [0, 1], [4, 5], M.copper);               // face brace
      box(unit, [0, 1], [0, 1], [0, 1], M.glow);
    },
  },

  {
    id: 'octet-truss',
    name: 'Octet truss',
    note: 'Fm-3m, cell 24. A hundred and ninety-two operations, which is the '
        + 'most any group here offers, so the authored piece is one short '
        + 'diagonal strut and nothing else. Face centring and the full cubic '
        + 'point group do all the rest.',
    group: 225,
    dims: [24, 24, 24],
    build(unit) {
      strut(unit, [0, 0, 0], [11, 11, 0], M.copper, 2);          // face diagonal
      box(unit, [0, 2], [0, 2], [0, 2], M.blackstone);           // node
    },
  },

  {
    id: 'diamond-frame',
    name: 'Diamond frame',
    note: 'Fd-3m, cell 24. The diamond glide carries a quarter-cell shift, '
        + 'which is exactly why cell edges have to be multiples of twelve: at '
        + 'any other size that quarter lands between blocks. One strut becomes '
        + 'the tetrahedral frame of a diamond lattice.',
    group: 227,
    dims: [24, 24, 24],
    build(unit) {
      strut(unit, [0, 0, 0], [5, 5, 5], M.quartz, 2);            // body diagonal
      box(unit, [0, 2], [0, 2], [0, 2], M.pillar);               // node
    },
  },

  {
    id: 'gyroid-cage',
    name: 'Gyroid cage',
    note: 'Ia-3d, cell 36. Ninety-six operations including three-folds along '
        + 'every body diagonal and screw axes throughout. One strut becomes a '
        + 'continuous interwoven frame that never touches its own mirror '
        + 'image.',
    group: 230,
    dims: [36, 36, 36],
    build(unit) {
      strut(unit, [0, 0, 0], [8, 8, 0], M.prismarine, 2);
      strut(unit, [8, 8, 0], [8, 17, 8], M.prismarine, 2);
      box(unit, [0, 2], [0, 2], [0, 2], M.deepslate);
    },
  },

  {
    id: 'chiral-knot',
    name: 'Chiral knot',
    note: 'P4_132, cell 24. A chiral cubic group: four-fold screws, three-fold '
        + 'rotations, no mirrors anywhere. The frame it builds cannot be laid '
        + 'over its own reflection, which is rare enough to be worth seeing.',
    group: 213,
    dims: [24, 24, 24],
    build(unit) {
      strut(unit, [0, 0, 0], [11, 5, 0], M.copper, 2);
      box(unit, [0, 3], [0, 3], [0, 1], M.blackstone);
      box(unit, [0, 1], [0, 1], [0, 0], M.glow);
    },
  },

  {
    id: 'space-frame',
    name: 'Space frame',
    note: 'Im-3m, cell 24. Body centring under the full cubic point group: '
        + 'ninety-six operations. Struts meet at the corners and at the centre '
        + 'of every cell, which is the densest regular frame in the set.',
    group: 229,
    dims: [24, 24, 24],
    build(unit) {
      strut(unit, [0, 0, 0], [8, 8, 8], M.copper, 2);            // to body centre
      box(unit, [0, 3], [0, 3], [0, 3], M.deepslate);            // corner node
      box(unit, [0, 11], [0, 1], [0, 1], M.blackstone);          // edge bar
    },
  },
];

export function buildPreset(id) {
  const preset = PRESETS.find((p) => p.id === id) || PRESETS[0];
  const group = groupByNumber(preset.group);
  const unit = new UnitCell({ group, dims: preset.dims });
  preset.build(unit);
  return { unit, preset };
}

/** Presets grouped by crystal system, for the UI's preset list. */
export function presetsBySystem() {
  const out = new Map();
  for (const preset of PRESETS) {
    const group = groupByNumber(preset.group);
    if (!out.has(group.system)) out.set(group.system, []);
    out.get(group.system).push(preset);
  }
  return out;
}
