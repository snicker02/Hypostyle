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
//
// Two things this module deliberately does NOT do:
//
//   * It does not refuse to write an oversized single .mcstructure. Bedrock's
//     structure BLOCK clamps its size fields to 64 per axis, but the file
//     format has no such limit and /structure load takes the size from the
//     file. Whether a given build loads is the game's business; the file is
//     written faithfully either way and the caller is told it is oversized.
//   * It does not assume the player will read a table of offsets. The pack
//     carries commands.txt: the literal command lines, in order, to paste.
//
// OPEN SPACE. By default an empty cell is written as -1, which means "leave
// whatever is already there" - the build drops into terrain and the terrain
// shows through every window and fills every room. The air option writes
// explicit minecraft:air instead, so the structure clears its own space:
//
//   none     -1 everywhere. Terrain shows through. The old behaviour.
//   roofed   clear every empty cell that has part of the build above it in the
//            same column. Interiors, aisles and undercrofts come out hollow;
//            the sky above the roof and the ground beside the walls are left
//            alone. This is almost always the one you want.
//   box      clear every empty cell in the bounding box. Levels the site.
//
// "Roofed" is computed once over the WHOLE build and then queried per piece, so
// a split build gets the same answer in every piece - work it out per piece and
// the topmost piece has no roof above it and comes out solid.

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
 *   chunk       [x,y,z] piece size (default 64 cubed, the structure block limit)
 *   namespace   structure namespace (default 'hypostyle')
 *   flattened   modern block names (default true)
 *   notes       extra lines for the readme in the pack
 * @returns {object} pack bytes, the whole-build single structure, the command
 *   script, the placement guide, and the numbers behind all of them.
 */
export function buildExport(grid, opts = {}) {
  const name = opts.name || 'hypostyle';
  const slug = sanitise(name);
  const namespace = sanitise(opts.namespace || 'hypostyle');
  const palette = new Palette({ flattened: opts.flattened !== false });
  const mc = toMinecraftAxes(grid);
  const chunk = opts.chunk || [MAX_STRUCTURE_EDGE, MAX_STRUCTURE_EDGE, MAX_STRUCTURE_EDGE];

  const bounds = mc.bounds(true);
  const air = AIR_MODES.includes(opts.air) ? opts.air : 'none';
  const roofed = air === 'roofed' ? roofedTest(mc, bounds) : null;
  const airWhereWorld = air === 'box' ? () => true : roofed;

  const split = splitGrid(mc, { chunk });
  const structures = split.chunks.map((c) => {
    // Pieces are written from their chunk corner, not from their own lowest
    // block. Otherwise a piece whose content starts part way in would be
    // placed at the offset of the chunk and drawn from the offset of the
    // content, and it would sit skew by that difference.
    const size = [0, 1, 2].map((a) => Math.min(chunk[a], bounds.size[a] - c.offset[a]));
    const built = buildMcStructure(c.grid, {
      palette,
      bounds: { min: [0, 0, 0], size },
      includeAir: air !== 'none',
      airWhere: airWhereWorld
        ? (x, y, z) => airWhereWorld(x + c.offset[0], y + c.offset[1], z + c.offset[2])
        : null,
    });
    return {
      name: `${slug}_${String(c.index).padStart(3, '0')}`,
      bytes: built.bytes,
      offset: c.offset,
      cells: c.cells,
      size,
    };
  });

  // The whole build as one file, always written, oversized or not.
  const whole = buildMcStructure(mc, {
    palette, includeAir: air !== 'none', airWhere: airWhereWorld,
  }).bytes;
  const oversize = needsSplit(mc);

  const guide = placementGuide(split, { baseName: slug, title: name });
  const commands = commandScript({
    title: name, namespace, split, bounds, oversize, wholeName: slug,
  });
  const readme = packReadme(name, split, bounds, oversize, air, opts.notes || []);

  const pack = buildMcPack({
    name,
    namespace,
    description: `${name} - ${mc.size.toLocaleString()} blocks in ${structures.length} piece`
               + `${structures.length === 1 ? '' : 's'}, built by Hypostyle.`,
    seed: `${slug}:${mc.size}:${bounds.size.join('x')}`,
    structures,
    extraFiles: [
      { path: 'commands.txt', data: commands },
      { path: 'placement-guide.txt', data: guide },
      { path: 'README.txt', data: readme },
    ],
  });

  return {
    pack: pack.bytes,
    filename: `${slug}.mcpack`,
    pieces: structures.length,
    guide,
    readme,
    commands,
    commandsName: `${slug}-commands.txt`,
    single: whole,
    singleName: `${slug}.mcstructure`,
    oversize,
    air,
    maxEdge: MAX_STRUCTURE_EDGE,
    namespace,
    size: bounds.size,
    cells: mc.size,
    structures,
    needsSplit: oversize,
    manifest: pack.manifest,
  };
}

/**
 * The literal lines to type in game. Offsets are relative (~), so the player
 * stands where they want the build to start and pastes.
 */
function commandScript({ title, namespace, split, bounds, oversize, wholeName }) {
  const lines = [];
  lines.push(`${title} - commands`);
  lines.push('='.repeat(Math.max(24, title.length + 11)));
  lines.push('');
  lines.push('Before anything:');
  lines.push('  1. Open the .mcpack to import it. Bedrock files it with your packs.');
  lines.push('  2. Edit the world, Behaviour Packs, activate this pack, Cheats on.');
  lines.push('     Creative mode is easiest.');
  lines.push('  3. Leave and re-enter the world so the structures register.');
  lines.push('');

  if (split.chunks.length === 0) {
    lines.push('Nothing to place: the build is empty.');
    return lines.join('\n');
  }

  lines.push('Then stand where you want the corner of the build to be and run these');
  lines.push('in order. ~ ~ ~ means "here", so every piece lands relative to where');
  lines.push('you are standing - do not move between commands.');
  lines.push('');
  lines.push('Blocks are placed east (+x), up (+y) and south (+z) from you.');
  lines.push(`Overall footprint: ${bounds.size.join(' x ')} blocks.`);
  lines.push('');
  lines.push('-'.repeat(62));
  lines.push('');

  const base = split.chunks[0].offset;
  for (const c of split.chunks) {
    const rel = [0, 1, 2].map((a) => c.offset[a] - base[a]);
    const nm = `${wholeName}_${String(c.index).padStart(3, '0')}`;
    lines.push(`/structure load ${namespace}:${nm} ${tilde(rel[0])} ${tilde(rel[1])} ${tilde(rel[2])}`);
  }

  lines.push('');
  lines.push('-'.repeat(62));
  lines.push('');
  lines.push(`${split.chunks.length} command${split.chunks.length === 1 ? '' : 's'}, `
    + `${split.totalCells.toLocaleString()} blocks total.`);
  lines.push('');
  lines.push('Chat takes one command at a time. For a long list, use a command block');
  lines.push('on Repeat / Always Active, or paste them one by one.');
  lines.push('');
  lines.push('If a piece lands in the wrong spot you moved between commands. Return');
  lines.push('to where you started and run that line again, or use the absolute');
  lines.push('form: replace ~ ~ ~ with your starting x y z plus the offsets in');
  lines.push('placement-guide.txt.');
  lines.push('');
  lines.push('Structure block instead of commands: place one, set it to Load, type');
  lines.push(`the name (for example ${namespace}:${wholeName}_000), set the relative`);
  lines.push('offset to the numbers in placement-guide.txt, then press Load.');

  if (oversize) {
    lines.push('');
    lines.push('On the single-file export: this build is over 64 blocks on at least');
    lines.push('one axis. The whole-build .mcstructure the app writes is a valid');
    lines.push('file, but a structure block cannot show more than 64 per axis, so');
    lines.push('load it with /structure load rather than through the block UI - and');
    lines.push('if the game refuses it, use the pieces above.');
  }

  return lines.join('\n');
}

function tilde(n) { return n === 0 ? '~' : `~${n}`; }

export const AIR_MODES = Object.freeze(['none', 'roofed', 'box']);

/**
 * Is this empty cell under the build? One pass records the highest solid block
 * in every column; anything below that line is inside the building's envelope.
 * Minecraft axes, so the column runs along y.
 */
export function roofedTest(grid, bounds) {
  const [sx, , sz] = bounds.size;
  const top = new Int32Array(sx * sz).fill(-1);
  grid.forEach((x, y, z) => {
    const i = x * sz + z;
    if (y > top[i]) top[i] = y;
  });
  return (x, y, z) => {
    if (x < 0 || z < 0 || x >= sx || z >= sz) return false;
    return y < top[x * sz + z];
  };
}

function packReadme(name, split, bounds, oversize, air, notes) {
  const lines = [];
  lines.push(name);
  lines.push('='.repeat(name.length));
  lines.push('');
  lines.push(`${split.totalCells.toLocaleString()} blocks, ${bounds.size.join(' x ')} overall.`);
  lines.push(`${split.chunks.length} structure file${split.chunks.length === 1 ? '' : 's'}.`);
  lines.push('');
  for (const note of notes) lines.push(note);
  if (notes.length) lines.push('');
  lines.push('Read commands.txt. It has the exact command lines to paste, in order.');
  lines.push('placement-guide.txt has the same information as a table of offsets if');
  lines.push('you would rather use structure blocks.');
  lines.push('');
  lines.push('Short version:');
  lines.push('  1. Open this .mcpack to import it, then activate it as a behaviour');
  lines.push('     pack on the world. Cheats on, creative mode.');
  lines.push('  2. Stand where the build should start.');
  lines.push('  3. Run the commands in commands.txt in order, without moving.');
  lines.push('');
  lines.push('Pieces are aligned to a single grid and butt together exactly; there');
  lines.push('is no overlap to trim.');
  lines.push('');
  if (air === 'none') {
    lines.push('Open space is left as it is: the structure only adds blocks, so any');
    lines.push('terrain it lands in will show through the windows and fill the rooms.');
    lines.push('Build in the air, or re-export with open space cleared.');
  } else if (air === 'roofed') {
    lines.push('Open space under the build is cleared to air, so the interiors arrive');
    lines.push('hollow even if you place this in a hillside. Ground beside the walls');
    lines.push('and sky above the roof are left alone.');
  } else {
    lines.push('Every empty cell in the bounding box is cleared to air, so the whole');
    lines.push('site is levelled to make room for the build.');
  }
  if (oversize) {
    lines.push('');
    lines.push('This build is over 64 blocks on at least one axis, which is why it is');
    lines.push('in pieces. The app will still export the whole thing as one');
    lines.push('.mcstructure; that file is only loadable by command, not by the');
    lines.push('structure block UI.');
  }
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
