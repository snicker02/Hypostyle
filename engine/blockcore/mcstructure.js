// blockcore/mcstructure.js
// Bedrock .mcstructure: uncompressed little-endian NBT.
//
//   format_version           int 1
//   size                     list<int>[3]            x, y, z
//   structure_world_origin   list<int>[3]
//   structure
//     block_indices          list<list<int>>         two layers
//     entities               list<compound>          empty
//     palette
//       default
//         block_palette          list<compound>      { name, states, version }
//         block_position_data    compound            empty
//
// Index order is x-major, then y, then z:
//     i = (x * sizeY + y) * sizeZ + z
// -1 means "leave whatever is already there", which is what we want for air in
// layer 0 and for the whole of layer 1 (the liquid/waterlogging layer).

import { writeNBT, readNBT, nbt } from './nbt.js';
import { Palette, blockKey } from './palette.js';
import { valueMaterial, valueShade } from './voxels.js';

export const AIR_INDEX = -1;

/**
 * Serialise a grid as a .mcstructure.
 * @param {import('./voxels.js').VoxelGrid} grid
 * @param {object} opts
 *   palette       Palette instance (default: a fresh one)
 *   origin        structure_world_origin (default [0,0,0])
 *   bounds        explicit {min,size} instead of the grid's own bounds
 *   includeAir    write an explicit air palette entry instead of -1
 * @returns {{bytes:Uint8Array, size:number[], origin:number[],
 *            paletteEntries:object[], cellCount:number}}
 */
export function buildMcStructure(grid, opts = {}) {
  const palette = opts.palette || new Palette();
  const origin = opts.origin || [0, 0, 0];

  const b = opts.bounds || grid.bounds(true);
  const min = b.empty ? [0, 0, 0] : b.min;
  const size = b.empty ? [0, 0, 0] : (b.size || [
    b.max[0] - b.min[0] + 1, b.max[1] - b.min[1] + 1, b.max[2] - b.min[2] + 1,
  ]);
  const [sx, sy, sz] = size;
  const total = sx * sy * sz;

  const entries = [];
  const entryIndex = new Map();

  function indexFor(material /*, shade */) {
    const block = palette.blockFor(material);
    const key = blockKey(block);
    let i = entryIndex.get(key);
    if (i === undefined) {
      i = entries.length;
      entryIndex.set(key, i);
      entries.push(block);
    }
    return i;
  }

  const airIndex = opts.includeAir ? internAir(entries, entryIndex) : AIR_INDEX;

  const layer0 = new Int32Array(total).fill(airIndex);
  const layer1 = new Int32Array(total).fill(AIR_INDEX);

  let cellCount = 0;
  grid.forEach((x, y, z, value) => {
    const ix = x - min[0], iy = y - min[1], iz = z - min[2];
    if (ix < 0 || iy < 0 || iz < 0 || ix >= sx || iy >= sy || iz >= sz) return;
    layer0[(ix * sy + iy) * sz + iz] = indexFor(valueMaterial(value), valueShade(value));
    cellCount++;
  });

  const paletteNodes = entries.map((block) => nbt.compound({
    name: nbt.string(block.name),
    states: nbt.compound(Object.fromEntries(
      Object.entries(block.states).map(([k, v]) => [k, stateNode(v)]),
    )),
    version: nbt.int(palette.blockVersion),
  }));

  const root = nbt.compound({
    format_version: nbt.int(1),
    size: nbt.intList(size),
    structure_world_origin: nbt.intList(origin),
    structure: nbt.compound({
      block_indices: nbt.list('list', [nbt.intList(layer0), nbt.intList(layer1)]),
      entities: nbt.list('compound', []),
      palette: nbt.compound({
        default: nbt.compound({
          block_palette: nbt.list('compound', paletteNodes),
          block_position_data: nbt.compound({}),
        }),
      }),
    }),
  });

  return {
    bytes: writeNBT(root, ''),
    size,
    origin,
    min,
    paletteEntries: entries,
    cellCount,
  };
}

function internAir(entries, entryIndex) {
  const block = { name: 'minecraft:air', states: {} };
  const key = blockKey(block);
  let i = entryIndex.get(key);
  if (i === undefined) {
    i = entries.length;
    entryIndex.set(key, i);
    entries.push(block);
  }
  return i;
}

function stateNode(v) {
  if (typeof v === 'boolean') return nbt.byte(v ? 1 : 0);
  if (typeof v === 'number') return Number.isInteger(v) ? nbt.int(v) : nbt.float(v);
  return nbt.string(v);
}

/**
 * Parse a .mcstructure back into a plain description. Used by the validation
 * harness to prove the writer round-trips.
 * @returns {{size:number[], origin:number[], palette:object[],
 *            layers:number[][], solidCount:number}}
 */
export function readMcStructure(bytes) {
  const { root } = readNBT(bytes);
  const v = root.value;
  const size = v.size.value.slice();
  const origin = v.structure_world_origin.value.slice();
  const s = v.structure.value;
  const layers = s.block_indices.value.map((layer) => Array.from(layer.value));
  const palette = s.palette.value.default.value.block_palette.value.map((entry) => ({
    name: entry.value.name.value,
    states: Object.fromEntries(
      Object.entries(entry.value.states.value).map(([k, node]) => [k, node.value]),
    ),
    version: entry.value.version.value,
  }));
  const solidCount = layers[0].reduce((n, i) => n + (i >= 0 ? 1 : 0), 0);
  return { size, origin, palette, layers, solidCount, formatVersion: v.format_version.value };
}
