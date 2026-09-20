// blockcore/mcpack.js
// Wraps .mcstructure files in a behaviour pack so Bedrock can import them by
// opening the file. Structures live at:
//     structures/<namespace>/<name>.mcstructure
// and load in game as  /structure load <namespace>:<name>  .

import { buildZip } from './zip.js';

export const PACK_FORMAT_VERSION = 2;
export const MIN_ENGINE_VERSION = [1, 21, 0];

/**
 * Deterministic UUID v4-shaped string from a seed string.
 * Two exports of the same build produce the same pack, which keeps re-imports
 * from piling up duplicate packs in the game.
 */
export function seededUuid(seed) {
  let h1 = 0x9e3779b9, h2 = 0x85ebca6b, h3 = 0xc2b2ae35, h4 = 0x27d4eb2f;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 + c + i, 0xc2b2ae35) >>> 0;
    h3 = Math.imul(h3 ^ (c << 3), 0x27d4eb2f) >>> 0;
    h4 = Math.imul(h4 + (c * 2654435761), 0x9e3779b9) >>> 0;
  }
  const hex = [h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 3) | 8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function buildManifest(opts) {
  const name = opts.name || 'blockcore export';
  const seed = opts.seed || name;
  return {
    format_version: PACK_FORMAT_VERSION,
    header: {
      name,
      description: opts.description || 'Structures exported by blockcore.',
      uuid: seededUuid(seed + ':header'),
      version: opts.version || [1, 0, 0],
      min_engine_version: opts.minEngineVersion || MIN_ENGINE_VERSION,
    },
    modules: [{
      type: 'data',
      description: opts.description || 'Structures exported by blockcore.',
      uuid: seededUuid(seed + ':module'),
      version: opts.version || [1, 0, 0],
    }],
  };
}

/**
 * @param {object} opts
 *   name        pack name shown in game
 *   namespace   structure namespace (default 'blockcore')
 *   structures  [{ name, bytes }]
 *   extraFiles  [{ path, data }] - README, placement guide, etc.
 * @returns {{bytes:Uint8Array, manifest:object, files:string[]}}
 */
export function buildMcPack(opts) {
  const namespace = sanitise(opts.namespace || 'blockcore');
  const manifest = buildManifest(opts);
  const files = [{ path: 'manifest.json', data: JSON.stringify(manifest, null, 2) }];

  for (const s of opts.structures || []) {
    files.push({ path: `structures/${namespace}/${sanitise(s.name)}.mcstructure`, data: s.bytes });
  }
  for (const f of opts.extraFiles || []) files.push(f);

  const zip = buildZip(files);
  return { bytes: zip.bytes, manifest, files: files.map((f) => f.path) };
}

/** Lowercase, safe for a structure identifier. */
export function sanitise(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9_\-.]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}
