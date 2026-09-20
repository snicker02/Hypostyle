// engine/presets.js
// Worked examples. Each is a single asymmetric unit; the group does the rest.
// They exist to answer the only question phase one has to answer: does the
// skeleton produce architecture, or does it produce interesting rubble?
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
// two directions apart. Cubic crypt below leans into that rather than fighting
// it, and the enclosed rooms come from the tetragonal presets instead.

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

export const PRESETS = [
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
    id: 'cloister-cells',
    name: 'Cloister cells',
    note: 'P4mm, cell 24. Floor, ceiling and one wall with a doorway and a '
        + 'window. The four-fold walls all four sides, so every bay closes into '
        + 'a room - these are the enclosed voids phase two will fill.',
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
];

export function buildPreset(id) {
  const preset = PRESETS.find((p) => p.id === id) || PRESETS[0];
  const group = groupByNumber(preset.group);
  const unit = new UnitCell({ group, dims: preset.dims });
  preset.build(unit);
  return { unit, preset };
}
