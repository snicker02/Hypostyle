// engine/wfc/index.js
// Phase two's public surface. One import for everything the app and the
// validator touch.

export {
  MODULE_EDGE, MODULE_CELLS, AIR, DIRS, DIR_NAMES, LETTERS,
  opposite, idx, parseLayers, rotateZ, mirrorX, faceCells, faceProfile,
  contentKey, solidCount, buildVariants, Variant,
  HORIZONTAL_BOTTOM_MASK, isHorizontal,
} from './modules.js';

export { MODULE_LIBRARY, BANDS } from './library.js';

export {
  buildAdjacency, boundaryAllows, forbiddenMask, worldFaceProfile, FULL_FACE,
} from './adjacency.js';

export { runWave, solve, mulberry32, Contradiction } from './collapse.js';

export { fillInteriors, describeInteriors, moduleSet, DEFAULTS } from './interiors.js';

export const WFC_VERSION = '0.1.0';
