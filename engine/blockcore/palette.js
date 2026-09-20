// blockcore/palette.js
// The small fixed material palette. Every front end (Hypostyle, Fieldcraft,
// IFScraft, Imagecraft, Mazecraft) resolves material ids through this one file
// so there is a single place where a block name is written down.
//
// Colour-space matching against the full Bedrock block set is a later pass; it
// slots in behind blockFor() without any caller changing.

// Packed block version stamped on every palette entry:
//   (major << 24) | (minor << 16) | (patch << 8) | revision
// Bedrock upgrades older stamps on load, so this is advisory rather than load
// bearing. Set for 1.26.51.
export const DEFAULT_BLOCK_VERSION = (1 << 24) | (26 << 16) | (51 << 8) | 0;

/**
 * Materials chosen for architecture: structural stone, two lighter dressings,
 * two woods, glass for openings and glowstone for lighting.
 * rgb is the preview colour, not a matching key.
 */
export const MATERIALS = Object.freeze([
  { label: 'Stone bricks',      flat: 'minecraft:stone_bricks',                legacy: { name: 'minecraft:stonebrick', states: { stone_brick_type: 'default' } },  rgb: [0.48, 0.48, 0.46] },
  { label: 'Chiselled bricks',  flat: 'minecraft:chiseled_stone_bricks',       legacy: { name: 'minecraft:stonebrick', states: { stone_brick_type: 'chiseled' } }, rgb: [0.52, 0.52, 0.50] },
  { label: 'Mossy bricks',      flat: 'minecraft:mossy_stone_bricks',          legacy: { name: 'minecraft:stonebrick', states: { stone_brick_type: 'mossy' } },    rgb: [0.42, 0.48, 0.38] },
  { label: 'Polished andesite', flat: 'minecraft:polished_andesite',           legacy: { name: 'minecraft:stone', states: { stone_type: 'andesite_smooth' } },     rgb: [0.58, 0.58, 0.57] },
  { label: 'Quartz block',      flat: 'minecraft:quartz_block',                legacy: { name: 'minecraft:quartz_block', states: { chisel_type: 'default', pillar_axis: 'y' } }, rgb: [0.92, 0.90, 0.86] },
  { label: 'Quartz pillar',     flat: 'minecraft:quartz_pillar',               legacy: { name: 'minecraft:quartz_block', states: { chisel_type: 'lines', pillar_axis: 'y' } },   rgb: [0.88, 0.86, 0.82] },
  { label: 'Sandstone',         flat: 'minecraft:sandstone',                   legacy: { name: 'minecraft:sandstone', states: { sand_stone_type: 'default' } },    rgb: [0.85, 0.79, 0.58] },
  { label: 'Cut sandstone',     flat: 'minecraft:cut_sandstone',               legacy: { name: 'minecraft:sandstone', states: { sand_stone_type: 'cut' } },        rgb: [0.88, 0.82, 0.62] },
  { label: 'Deepslate bricks',  flat: 'minecraft:deepslate_bricks',            legacy: { name: 'minecraft:deepslate_bricks', states: {} },                         rgb: [0.31, 0.31, 0.33] },
  { label: 'Blackstone bricks', flat: 'minecraft:polished_blackstone_bricks',  legacy: { name: 'minecraft:polished_blackstone_bricks', states: {} },               rgb: [0.20, 0.18, 0.21] },
  { label: 'Oak planks',        flat: 'minecraft:oak_planks',                  legacy: { name: 'minecraft:planks', states: { wood_type: 'oak' } },                  rgb: [0.72, 0.58, 0.36] },
  { label: 'Dark oak planks',   flat: 'minecraft:dark_oak_planks',             legacy: { name: 'minecraft:planks', states: { wood_type: 'dark_oak' } },             rgb: [0.35, 0.24, 0.13] },
  { label: 'Copper block',      flat: 'minecraft:copper_block',                legacy: { name: 'minecraft:copper_block', states: {} },                              rgb: [0.76, 0.45, 0.31] },
  { label: 'Prismarine bricks', flat: 'minecraft:prismarine_bricks',           legacy: { name: 'minecraft:prismarine', states: { prismarine_block_type: 'bricks' } }, rgb: [0.39, 0.62, 0.57] },
  { label: 'Glass',             flat: 'minecraft:glass',                       legacy: { name: 'minecraft:glass', states: {} },                                     rgb: [0.78, 0.88, 0.92], translucent: true },
  { label: 'Glowstone',         flat: 'minecraft:glowstone',                   legacy: { name: 'minecraft:glowstone', states: {} },                                 rgb: [0.98, 0.86, 0.54], emissive: true },
]);

export const MATERIAL_COUNT = MATERIALS.length;

export class Palette {
  /**
   * @param {object} opts
   *   flattened     use modern block names (default true); false emits legacy
   *                 name + block states for older worlds.
   *   blockVersion  packed version int stamped on every palette entry.
   *   remap         optional Array or Map: source material id -> palette id.
   */
  constructor(opts = {}) {
    this.flattened = opts.flattened !== false;
    this.blockVersion = opts.blockVersion || DEFAULT_BLOCK_VERSION;
    this.remap = opts.remap || null;
  }

  /** Resolve a source material id through the remap into a palette id. */
  resolve(materialId) {
    let id = materialId | 0;
    if (this.remap) {
      const r = Array.isArray(this.remap) ? this.remap[id] : this.remap.get(id);
      if (r !== undefined && r !== null) id = r | 0;
    }
    if (id < 0) id = 0;
    return id % MATERIAL_COUNT;
  }

  /** @returns {{name:string, states:object}} */
  blockFor(materialId /*, shade */) {
    const m = MATERIALS[this.resolve(materialId)];
    return this.flattened
      ? { name: m.flat, states: {} }
      : { name: m.legacy.name, states: { ...m.legacy.states } };
  }

  rgbFor(materialId) { return MATERIALS[this.resolve(materialId)].rgb; }
  labelFor(materialId) { return MATERIALS[this.resolve(materialId)].label; }
  isTranslucent(materialId) { return !!MATERIALS[this.resolve(materialId)].translucent; }
}

/** Stable interning key for a resolved block. */
export function blockKey(block) {
  const keys = Object.keys(block.states).sort();
  let s = block.name;
  for (const k of keys) s += `|${k}=${block.states[k]}`;
  return s;
}
