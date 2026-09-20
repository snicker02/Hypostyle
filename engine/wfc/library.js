// engine/wfc/library.js
// The authored modules. Each is three layers of three rows of three
// characters: layers[0] is the bottom (z = 0), a row index is y, a character
// index is x, so a layer reads like a plan seen from above. '.' is air; every
// other letter is a blockcore material (see LETTERS in modules.js).
//
// Nothing here declares how modules join. Adjacency is read off the blocks by
// adjacency.js.
//
// WHAT THIS LIBRARY IS FOR. The skeleton already has floors, walls and a roof;
// it is the architecture. These are the fittings inside it. Two earlier drafts
// are worth recording because both failed in the same way, visibly, in a cross
// section:
//
//   A floor band that laid its own slab built a second floor hanging above the
//   real one.
//   An interior band full of single ornaments left quartz blocks floating in
//   mid-air with nothing under them.
//
// So the rule the library now keeps: a module either stands on the ground, or
// hangs from the roof, or spans from one to the other. Nothing floats. That is
// why the floor band holds all the furniture, the ceiling band all the
// lighting, and the interior band almost nothing but columns passing through -
// a tall hall SHOULD be mostly air at head height.
//
// Three mechanisms make the set fit together:
//
//   CENTRE PIECES. A block at (1,1,z) touches no side face, so its module joins
//   anything an empty cell joins sideways. Ornament is free.
//
//   RUNS WITH END CAPS. A bench spanning x = 0..2 leaves one bit on its -x and
//   +x faces, so it can only continue into another bench. The end cap carries
//   the bit on one side and nothing on the other, which is how a run stops.
//   That pairing is why the solver has real work to do instead of rolling dice.
//
//   VERTICAL FAMILIES. A pillar leaves a bit on its up and down faces, chains
//   through as many cells as the room is tall, and has to finish in a cap or
//   reach the roof. A pillar cannot start without somewhere to end.
//
// Bands: 'floor' is the lowest layer of a room, 'ceiling' the highest,
// 'interior' between, 'any' all three - which is what a pillar needs.

/** @type {Array<{name:string, band:string, weight:number, layers:string[][], symmetry?:string}>} */
export const MODULE_LIBRARY = [
  /* ------------------------------------------------- standing on the ground */

  {
    name: 'floor.void', band: 'floor', weight: 10,
    layers: [['...', '...', '...'], ['...', '...', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.plinth', band: 'floor', weight: 3,
    layers: [['...', '.C.', '...'], ['...', '...', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.pedestal', band: 'floor', weight: 3,
    layers: [['...', '.A.', '...'], ['...', '.Q.', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.brazier', band: 'floor', weight: 3.5,
    layers: [['...', '.K.', '...'], ['...', '.L.', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.basin', band: 'floor', weight: 2.5,
    layers: [['...', '.I.', '...'], ['...', '...', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.planter', band: 'floor', weight: 2.5,
    layers: [['...', '.M.', '...'], ['...', '...', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.bench_mid', band: 'floor', weight: 3.5,
    layers: [['...', 'OOO', '...'], ['...', '...', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.bench_end', band: 'floor', weight: 4,
    layers: [['...', 'OO.', '...'], ['...', '...', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.table_mid', band: 'floor', weight: 3,
    layers: [['...', 'W.W', '...'], ['...', 'WWW', '...'], ['...', '...', '...']],
  },
  {
    name: 'floor.table_end', band: 'floor', weight: 3.5,
    layers: [['...', 'W..', '...'], ['...', 'WW.', '...'], ['...', '...', '...']],
  },

  /* --------------------------------------------------- open at head height */

  {
    name: 'interior.void', band: 'interior', weight: 10,
    layers: [['...', '...', '...'], ['...', '...', '...'], ['...', '...', '...']],
  },

  /* ------------------------------- passing through every band: the columns */

  {
    name: 'pillar.shaft', band: 'any', weight: 0.6,
    layers: [['...', '.P.', '...'], ['...', '.P.', '...'], ['...', '.P.', '...']],
  },
  {
    name: 'pillar.cap', band: 'any', weight: 1.6,
    layers: [['...', '.P.', '...'], ['...', '.C.', '...'], ['...', '...', '...']],
  },
  /* ------------------------------------ partitions: a run in x and in z both */
  //
  // A wall is the first family that has to terminate in two directions at once.
  // Sideways it leaves the full column of its side face, so it can only
  // continue into another wall or into an end cap. Vertically it leaves the
  // full row of its top and bottom faces, so it can only continue into another
  // wall - which means a partition always runs the whole height of the room,
  // from the floor the skeleton laid to the roof the skeleton put over it. That
  // is what a partition is. The end cap carries the side profile on one side
  // and nothing on the other, and its own top and bottom rows are two thirds
  // long, so the end of a wall stays the end of that wall all the way up.

  {
    name: 'wall.core', band: 'any', weight: 0.9,
    layers: [['...', 'SSS', '...'], ['...', 'SSS', '...'], ['...', 'SSS', '...']],
  },
  {
    name: 'wall.weathered', band: 'any', weight: 0.7,
    layers: [['...', 'SMS', '...'], ['...', 'MSM', '...'], ['...', 'SSS', '...']],
  },
  {
    name: 'wall.glazed', band: 'any', weight: 0.7,
    layers: [['...', 'SSS', '...'], ['...', 'SGS', '...'], ['...', 'SSS', '...']],
  },
  {
    name: 'wall.end', band: 'any', weight: 1.6,
    layers: [['...', 'SS.', '...'], ['...', 'SS.', '...'], ['...', 'SS.', '...']],
  },
  {
    name: 'wall.doorway', band: 'floor', weight: 2.5,
    layers: [['...', 'S.S', '...'], ['...', 'S.S', '...'], ['...', 'SSS', '...']],
  },
  {
    name: 'wall.hearth', band: 'floor', weight: 1.5,
    layers: [['...', 'SKS', '...'], ['...', 'SLS', '...'], ['...', 'SSS', '...']],
  },

  /* ------------------------------------------------- hanging from the roof */

  {
    name: 'ceiling.void', band: 'ceiling', weight: 10,
    layers: [['...', '...', '...'], ['...', '...', '...'], ['...', '...', '...']],
  },
  {
    name: 'ceiling.lamp', band: 'ceiling', weight: 4.5,
    layers: [['...', '...', '...'], ['...', '...', '...'], ['...', '.L.', '...']],
  },
  {
    name: 'ceiling.pendant', band: 'ceiling', weight: 3.5,
    layers: [['...', '...', '...'], ['...', '.L.', '...'], ['...', '.W.', '...']],
  },
  {
    name: 'ceiling.boss', band: 'ceiling', weight: 3,
    layers: [['...', '...', '...'], ['...', '...', '...'], ['...', '.C.', '...']],
  },
  {
    name: 'ceiling.beam_mid', band: 'ceiling', weight: 3.5,
    layers: [['...', '...', '...'], ['...', '...', '...'], ['...', 'WWW', '...']],
  },
  {
    name: 'ceiling.beam_end', band: 'ceiling', weight: 4,
    layers: [['...', '...', '...'], ['...', '...', '...'], ['...', 'WW.', '...']],
  },
];

export const BANDS = Object.freeze(['floor', 'interior', 'ceiling', 'any']);
