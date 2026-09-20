// engine/export.js
// One place where crystallographic axes become Minecraft axes.
//
// Inside the app the c axis is up, because that is how every space group table
// is written and it keeps the operation strings honest. Minecraft puts y up.
// The map is a rotation, not a swap:
//
//     X = x,  Y = z,  Z = -y
//
// determinant +1, so it turns the building upright without mirroring it. A
// plain (x,y,z) -> (x,z,y) swap would be a reflection and would quietly turn
// every 4_1 screw axis into a 4_3 - the build would look fine and be the wrong
// hand. The grid is then normalised so its minimum corner sits at the origin.

import {
  VoxelGrid, valueMaterial, Palette, buildMcStructure, splitGrid, needsSplit,
  placementGuide, buildMcPack, sanitise, MAX_STRUCTURE_EDGE,
} from './blockcore/index.js';

/** Rotate a build from c-up into Minecraft's y-up and sit it on the origin. */
export function toMinecraftAxes(grid) {
  const out = new VoxelGrid({ budget: grid.budget });
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  const mapped = [];
  grid.forEach((x, y, z, value) => {
    const X = x, Y = z, Z = -y;
    if (X < minX) minX = X;
    if (Y < minY) minY = Y;
    if (Z < minZ) minZ = Z;
    mapped.push(X, Y, Z, valueMaterial(value));
  });
  for (let i = 0; i + 3 < mapped.length; i += 4) {
    out.set(mapped[i] - minX, mapped[i + 1] - minY, mapped[i + 2] - minZ, mapped[i + 3]);
  }
  return out;
}

/**
 * Build the export for a finished skeleton.
 * @param {import('./blockcore/index.js').VoxelGrid} grid  in app (c-up) axes
 * @param {object} opts
 *   name        build name, used for files and the pack
 *   chunk       [x,y,z] piece size (default 64 cubed, Bedrock's own limit)
 *   flattened   modern block names (default true)
 *   notes       extra lines for the readme in the pack
 * @returns {{pack:Uint8Array, filename:string, pieces:number, guide:string,
 *            single:?Uint8Array, size:number[], cells:number, structures:Array}}
 */
export function buildExport(grid, opts = {}) {
  const name = opts.name || 'hypostyle';
  const slug = sanitise(name);
  const palette = new Palette({ flattened: opts.flattened !== false });
  const mc = toMinecraftAxes(grid);
  const chunk = opts.chunk || [MAX_STRUCTURE_EDGE, MAX_STRUCTURE_EDGE, MAX_STRUCTURE_EDGE];

  const bounds = mc.bounds(true);
  const split = splitGrid(mc, { chunk });
  const structures = split.chunks.map((c) => ({
    name: `${slug}_${String(c.index).padStart(3, '0')}`,
    bytes: buildMcStructure(c.grid, { palette }).bytes,
    offset: c.offset,
    cells: c.cells,
    size: c.size,
  }));

  const guide = placementGuide(split, { baseName: slug, title: name });
  const readme = packReadme(name, split, bounds, opts.notes || []);

  const pack = buildMcPack({
    name,
    namespace: 'hypostyle',
    description: `${name} - ${mc.size.toLocaleString()} blocks in ${structures.length} piece`
               + `${structures.length === 1 ? '' : 's'}, built by Hypostyle.`,
    seed: `${slug}:${mc.size}:${bounds.size.join('x')}`,
    structures,
    extraFiles: [
      { path: 'placement-guide.txt', data: guide },
      { path: 'README.txt', data: readme },
    ],
  });

  const single = structures.length === 1 ? structures[0].bytes : null;

  return {
    pack: pack.bytes,
    filename: `${slug}.mcpack`,
    pieces: structures.length,
    guide,
    readme,
    single,
    singleName: `${slug}.mcstructure`,
    size: bounds.size,
    cells: mc.size,
    structures,
    needsSplit: needsSplit(mc),
    manifest: pack.manifest,
  };
}

function packReadme(name, split, bounds, notes) {
  const lines = [];
  lines.push(name);
  lines.push('='.repeat(name.length));
  lines.push('');
  lines.push(`${split.totalCells.toLocaleString()} blocks, ${bounds.size.join(' x ')} overall.`);
  lines.push(`${split.chunks.length} structure file${split.chunks.length === 1 ? '' : 's'}.`);
  lines.push('');
  for (const note of notes) lines.push(note);
  if (notes.length) lines.push('');
  lines.push('To use:');
  lines.push('  1. Open this .mcpack to import it, then add it to a world as a');
  lines.push('     behaviour pack. Creative mode and cheats on.');
  lines.push('  2. Place a structure block, set it to Load, and type the structure');
  lines.push('     name from placement-guide.txt.');
  lines.push('  3. Or run /structure load hypostyle:<name> ~ ~ ~ while standing at');
  lines.push('     the spot you want the piece to start.');
  lines.push('');
  lines.push('Pieces are aligned to a single grid: put piece 000 down first and use');
  lines.push('the offsets in placement-guide.txt for the rest. They butt together');
  lines.push('exactly; there is no overlap to trim.');
  lines.push('');
  lines.push('The build is exported with the crystallographic c axis on Minecraft\'s');
  lines.push('y axis, so the cell height you authored is the height you get.');
  return lines.join('\n');
}

/** Trigger a browser download. */
export function download(bytes, filename, mime = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
