// engine/wfc/adjacency.js
// Adjacency is derived, never declared.
//
// Two variants may sit side by side when the 3x3 face one presents and the 3x3
// face the other presents back are the same. Both were read out of the blocks,
// so authoring a module means placing blocks and nothing else. The comparison
// is on solidity rather than material, which is what lets a mossy floor and a
// clean floor be the same floor.
//
// THE SKELETON BOUNDARY. Where a module touches something that is not part of
// the wave - skeleton stone, a doorway, the outside - there is no module on the
// far side to match against, only block content. The rule there is not equality
// but a one-way prohibition, and it is the same in all six directions:
//
//     a module may not put a block against air on the far side of a boundary.
//
// Read sideways that keeps doorways, arches and windows clear. Read downwards
// it means nothing is placed without something under it. Read upwards it means
// a lamp needs a roof to hang from. One sentence, and it is the whole reason
// the fill never floats and never seals a passage.
//
// Stated plainly because it is a judgement rather than a derivation: equality
// against arbitrary skeleton content would reject almost every module, and the
// useful thing to forbid is blocking a passage or hanging in mid-air, not
// failing to mirror a wall.

import { opposite, faceProfile, AIR, idx } from './modules.js';

export const FULL_FACE = 0x1ff;

/**
 * @param {import('./modules.js').Variant[]} variants
 * @returns {{adj:Uint8Array[][], bandMasks:Map<string,Uint8Array>, count:number,
 *            profiles:Set<number>[], support:Int32Array[][]}}
 */
export function buildAdjacency(variants) {
  const n = variants.length;
  const adj = [];
  for (let d = 0; d < 6; d++) {
    const table = new Array(n);
    const od = opposite(d);
    for (let a = 0; a < n; a++) {
      const row = new Uint8Array(n);
      const pa = variants[a].profiles[d];
      for (let b = 0; b < n; b++) row[b] = variants[b].profiles[od] === pa ? 1 : 0;
      table[a] = row;
    }
    adj.push(table);
  }

  const bandMasks = new Map();
  for (const band of ['floor', 'interior', 'ceiling']) {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      mask[i] = (variants[i].band === band || variants[i].band === 'any') ? 1 : 0;
    }
    bandMasks.set(band, mask);
  }

  const profiles = [];
  for (let d = 0; d < 6; d++) {
    const set = new Set();
    for (let i = 0; i < n; i++) set.add(variants[i].profiles[d]);
    profiles.push(set);
  }

  return { adj, bandMasks, count: n, profiles };
}

/** The positions a module may not fill, given what the skeleton shows it. */
export function forbiddenMask(d, skeletonProfile) {
  return (~skeletonProfile) & FULL_FACE;
}

/** Does this variant's face d survive the boundary rule against that content? */
export function boundaryAllows(variant, d, skeletonProfile) {
  return (variant.profiles[d] & forbiddenMask(d, skeletonProfile)) === 0;
}

/**
 * Read the 3x3 face a lump of world content presents back toward a module.
 * @param {(x:number,y:number,z:number)=>boolean} isSolid  world query
 * @param {number[]} origin  the NEIGHBOUR coarse cell's minimum corner
 * @param {number} d  the direction FROM the module TO that neighbour
 */
export function worldFaceProfile(isSolid, origin, d) {
  const cells = new Int16Array(27).fill(AIR);
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      for (let z = 0; z < 3; z++) {
        if (isSolid(origin[0] + x, origin[1] + y, origin[2] + z)) cells[idx(x, y, z)] = 0;
      }
    }
  }
  return faceProfile(cells, opposite(d));
}
