// blockcore/index.js
// The shared block engine: sparse voxel map, palette, mesher, picking and the
// Bedrock export path. Hypostyle, Fieldcraft, IFScraft, Imagecraft and
// Mazecraft are front ends on top of this - nothing block-shaped should be
// written a second time in any of them.
//
// Nothing in here knows about space groups, distance fields, mazes or images.
// Keep it that way.

export const BLOCKCORE_VERSION = '0.2.0';

export {
  VoxelGrid, BudgetExceeded, DEFAULT_BUDGET,
  packKey, unpackKey, packValue, valueMaterial, valueShade,
  AXIS_BITS, AXIS_SPAN, COORD_MIN, COORD_MAX,
} from './voxels.js';

export {
  Palette, MATERIALS, MATERIAL_COUNT, DEFAULT_BLOCK_VERSION, blockKey,
} from './palette.js';

export { meshGrid, countExposedFaces } from './mesher.js';

export { writeNBT, readNBT, nbt, TAG } from './nbt.js';

export { buildMcStructure, readMcStructure, AIR_INDEX } from './mcstructure.js';

export {
  splitGrid, needsSplit, placementGuide, DEFAULT_CHUNK, MAX_STRUCTURE_EDGE,
} from './split.js';

export { buildZip, crc32 } from './zip.js';

export { buildMcPack, buildManifest, seededUuid, sanitise } from './mcpack.js';

export { raycastGrid, raycastPlane, rayFromNDC } from './pick.js';
