// tools/validate.mjs
// Headless validation. Run with:  node tools/validate.mjs
//
// Gates, in the order a failure would matter:
//   1  modules load
//   2  the 163 groups are the right 163, correctly shaped
//   3  each group really is a group: closed, inverses, identity
//   4  every operation is a bijection of the block lattice
//   5  orbits and the canonical asymmetric unit are consistent
//   6  expansion output is invariant under the group it was expanded by
//   7  tiling is exact and budget-honest
//   8  blockcore: storage, mesher, NBT, .mcstructure, split, zip
//   9  the axis map into Minecraft is a rotation, not a reflection
//  12  wfc modules, variants and adjacency
//  13  the wave solves every preset and seals nothing
//  14  open space written as air, and split pieces written from their corner
//  10  room finding
//  11  the five presets build and stay invariant

import { GROUPS, ROTS, groupByNumber, groupByHM } from '../engine/spacegroups.js';
import {
  applyOp, checkDims, orbitMap, orbitOf, cellIndex, cellFromIndex, opToString, EDGE_MULTIPLE,
} from '../engine/symmetry.js';
import { UnitCell } from '../engine/unit.js';
import { expandUnit, tileCells, buildSkeleton } from '../engine/expander.js';
import { findVoids } from '../engine/voids.js';
import { toMinecraftAxes, buildExport, roofedTest } from '../engine/export.js';
import {
  moduleSet, fillInteriors, solve, mulberry32, parseLayers, rotateZ, mirrorX,
  contentKey, faceProfile, opposite, forbiddenMask, boundaryAllows,
  idx as wfcIdx,
} from '../engine/wfc/index.js';
import { PRESETS, buildPreset } from '../engine/presets.js';
import {
  VoxelGrid, BudgetExceeded, packKey, unpackKey, Palette, meshGrid, countExposedFaces,
  writeNBT, readNBT, nbt, buildMcStructure, readMcStructure, splitGrid, placementGuide,
  buildZip, crc32, buildMcPack, raycastGrid, BLOCKCORE_VERSION,
} from '../engine/blockcore/index.js';

let passed = 0, failed = 0;
const failures = [];
let gateName = '';

function gate(name) { gateName = name; console.log(`\n${name}`); }

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    failures.push(`${gateName} / ${label}${detail ? ' - ' + detail : ''}`);
    console.log(`  FAIL  ${label}${detail ? '  (' + detail + ')' : ''}`);
  }
}

/* ------------------------------------------------------ 1. modules load */

gate('1  modules');
check('blockcore version present', typeof BLOCKCORE_VERSION === 'string' && BLOCKCORE_VERSION.length > 0);
check('163 groups exported', GROUPS.length === 163, `got ${GROUPS.length}`);
check('48 rotation matrices', ROTS.length === 48);
check('presets exported', PRESETS.length >= 4, `got ${PRESETS.length}`);

/* -------------------------------------------------------- 2. group data */

gate('2  space group data');
{
  const counts = { o: 0, t: 0, c: 0 };
  for (const g of GROUPS) counts[g.system]++;
  check('59 orthorhombic', counts.o === 59, `got ${counts.o}`);
  check('68 tetragonal', counts.t === 68, `got ${counts.t}`);
  check('36 cubic', counts.c === 36, `got ${counts.c}`);

  const numbers = GROUPS.map((g) => g.number);
  check('numbers unique', new Set(numbers).size === 163);
  check('numbers in the right ranges', numbers.every((n) =>
    (n >= 16 && n <= 74) || (n >= 75 && n <= 142) || (n >= 195 && n <= 230)));
  check('no trigonal or hexagonal snuck in', !numbers.some((n) => n >= 143 && n <= 194));

  let badRot = 0, badDet = 0, dupOps = 0, noIdentity = 0;
  for (const g of GROUPS) {
    if (new Set(g.ops).size !== g.order) dupOps++;
    let hasIdentity = false;
    for (let i = 0; i < g.order; i++) {
      const r = g.rot(i);
      if (!isSignedPermutation(r)) badRot++;
      if (Math.abs(det3(r)) !== 1) badDet++;
      const t = g.trans(i);
      if (isIdentity(r) && t.every((v) => v === 0)) hasIdentity = true;
    }
    if (!hasIdentity) noIdentity++;
  }
  check('all rotations are signed permutations', badRot === 0, `${badRot} bad`);
  check('all determinants are +/-1', badDet === 0, `${badDet} bad`);
  check('no duplicate operations', dupOps === 0, `${dupOps} groups`);
  check('every group contains the identity', noIdentity === 0, `${noIdentity} without`);

  check('translations are quarters of a cell edge',
    GROUPS.every((g) => {
      for (let i = 0; i < g.order; i++) if (g.trans(i).some((t) => t % 3 !== 0)) return false;
      return true;
    }));

  const p41 = groupByHM('P4_1'), p43 = groupByHM('P4_3');
  check('enantiomorphic pair P4_1 / P4_3 are distinct',
    p41 && p43 && p41.ops.join() !== p43.ops.join());

  check('Pm-3m has 48 operations', groupByNumber(221).order === 48, `${groupByNumber(221).order}`);
  check('Fm-3m has 192 (48 x 4 centring)', groupByNumber(225).order === 192);
  check('Ia-3d has 96', groupByNumber(230).order === 96);
  check('P222 has 4', groupByNumber(16).order === 4);

  check('edge ties: cubic locks all three', groupByNumber(221).edgeGroups().every((v, _, a) => v === a[0]));
  {
    const t = groupByNumber(99).edgeGroups();
    check('edge ties: tetragonal locks a = b only', t[0] === t[1] && t[1] !== t[2]);
  }
  {
    const o = groupByNumber(16).edgeGroups();
    check('edge ties: orthorhombic locks nothing', o[0] !== o[1] && o[1] !== o[2] && o[0] !== o[2]);
  }
  check('operation strings read like the tables',
    opToString(groupByNumber(16), 0) === 'x, y, z', opToString(groupByNumber(16), 0));
}

/* ------------------------------------------------ 3. they really are groups */

gate('3  group axioms, all 163 groups');
{
  let notClosed = 0, noInverse = 0;
  for (const g of GROUPS) {
    const set = new Set();
    for (let i = 0; i < g.order; i++) set.add(canonical(g, i));
    for (let i = 0; i < g.order; i++) {
      for (let j = 0; j < g.order; j++) {
        const composed = compose(g, i, j);
        if (!set.has(composed)) { notClosed++; i = g.order; break; }
      }
    }
    for (let i = 0; i < g.order; i++) {
      let found = false;
      for (let j = 0; j < g.order && !found; j++) {
        if (compose(g, i, j) === canonical(g, identityIndex(g))) found = true;
      }
      if (!found) { noInverse++; break; }
    }
  }
  check('closed under composition', notClosed === 0, `${notClosed} groups not closed`);
  check('every operation has an inverse', noInverse === 0, `${noInverse} groups incomplete`);
}

/* -------------------------------------------- 4. action on the block grid */

gate('4  block lattice action');
{
  let notBijective = 0, offLattice = 0, tested = 0;
  for (const g of GROUPS) {
    const dims = checkDims(g, [12, 12, 12]).fixed;
    const total = dims[0] * dims[1] * dims[2];
    const p = [0, 0, 0], q = [0, 0, 0];
    for (let i = 0; i < g.order; i++) {
      const seen = new Uint8Array(total);
      for (let index = 0; index < total; index++) {
        cellFromIndex(index, dims, p);
        applyOp(g, i, dims, p, q);
        if (!q.every((v, a) => Number.isInteger(v) && v >= 0 && v < dims[a])) { offLattice++; break; }
        seen[cellIndex(q, dims)] = 1;
      }
      let covered = 0;
      for (let k = 0; k < total; k++) covered += seen[k];
      if (covered !== total) { notBijective++; break; }
      tested++;
    }
  }
  check('every operation lands on integer blocks inside the cell', offLattice === 0, `${offLattice} failures`);
  check('every operation permutes the cell', notBijective === 0, `${notBijective} groups`);
  check('operations exercised', tested > 3000, `${tested}`);

  // The half-block convention is the point: a mirror must not lose a row.
  // Operations are found by their rotation matrix - the order spglib lists
  // them in is an implementation detail and must never be assumed.
  const opsWithRot = (g, r) => {
    const out = [];
    for (let i = 0; i < g.order; i++) {
      const m = g.rot(i);
      if (r.every((v, k) => v === m[k])) out.push(i);
    }
    return out;
  };

  const pm = groupByNumber(25);          // Pmm2 contains x -> -x, y -> -y
  const dims = [24, 24, 24];
  const twofold = opsWithRot(pm, [-1, 0, 0, 0, -1, 0, 0, 0, 1]);
  check('Pmm2 has a 2-fold about z', twofold.length === 1, `${twofold.length}`);
  const images = new Set();
  for (let x = 0; x < 24; x++) images.add(applyOp(pm, twofold[0], dims, [x, 3, 3])[0]);
  check('a mirror is a clean swap of all 24 columns', images.size === 24, `${images.size}`);
  const flipped = applyOp(pm, twofold[0], dims, [0, 3, 3]);
  check('mirror sends block 0 to block 23', flipped[0] === 23 && flipped[1] === 20, `${flipped}`);
  const mirrorY = opsWithRot(pm, [1, 0, 0, 0, -1, 0, 0, 0, 1]);
  check('the y mirror leaves x alone and reflects y',
    (() => { const q = applyOp(pm, mirrorY[0], dims, [0, 3, 3]); return q[0] === 0 && q[1] === 20 && q[2] === 3; })());

  check('cell edges must be multiples of 12', checkDims(groupByNumber(16), [20, 24, 24]).fixed[0] % EDGE_MULTIPLE === 0);
  check('tetragonal cell snaps a and b together',
    (() => { const f = checkDims(groupByNumber(99), [24, 36, 48]).fixed; return f[0] === f[1]; })());
  check('cubic cell snaps all three',
    (() => { const f = checkDims(groupByNumber(221), [24, 36, 48]).fixed; return f[0] === f[1] && f[1] === f[2]; })());

  // 4_1 and 4_3 screw axes must differ in where they put a block. The pair is
  // an enantiomorphic one, so this is the check that the export axis map has
  // not quietly reflected the build and swapped one for the other.
  const fourfold = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  const g41 = groupByHM('P4_1'), g43 = groupByHM('P4_3');
  const i41 = opsWithRot(g41, fourfold), i43 = opsWithRot(g43, fourfold);
  check('both screw groups carry one 4-fold rotation',
    i41.length === 1 && i43.length === 1, `${i41.length},${i43.length}`);
  const a = applyOp(g41, i41[0], [24, 24, 24], [1, 0, 0]);
  const b = applyOp(g43, i43[0], [24, 24, 24], [1, 0, 0]);
  check('4_1 and 4_3 screw a block to different heights', a[2] !== b[2], `${a} vs ${b}`);
  check('4_1 rises a quarter cell and 4_3 three quarters',
    (a[2] === 6 && b[2] === 18) || (a[2] === 18 && b[2] === 6), `${a[2]} and ${b[2]}`);
}

/* ------------------------------------------- 5. orbits and the asymmetric unit */

gate('5  orbits and the asymmetric unit');
{
  for (const number of [16, 25, 99, 107, 141, 221, 225]) {
    const g = groupByNumber(number);
    const dims = checkDims(g, [24, 24, 24]).fixed;
    const map = orbitMap(g, dims);
    const total = dims[0] * dims[1] * dims[2];
    let sizes = new Map();
    for (let i = 0; i < total; i++) {
      const rep = map.reps[i];
      sizes.set(rep, (sizes.get(rep) || 0) + 1);
    }
    const orbitSizes = [...sizes.values()];
    check(`${g.hm}: orbits cover the cell exactly`,
      orbitSizes.reduce((n, v) => n + v, 0) === total);
    check(`${g.hm}: every orbit size divides the group order`,
      orbitSizes.every((s) => g.order % s === 0),
      [...new Set(orbitSizes)].sort((x, y) => x - y).join(','));
    check(`${g.hm}: representatives are the asymmetric unit`,
      map.domainSize === sizes.size && map.orbitCount === sizes.size);
    check(`${g.hm}: general position multiplicity equals the order`,
      Math.max(...orbitSizes) === g.order, `max orbit ${Math.max(...orbitSizes)}`);
    check(`${g.hm}: asymmetric unit is about 1/${g.order} of the cell`,
      map.domainSize >= total / g.order && map.domainSize <= total / g.order * 2.2,
      `${map.domainSize} vs ${(total / g.order).toFixed(0)}`);
  }
  const g = groupByNumber(221);
  check('orbitOf agrees with orbitMap',
    orbitOf(g, [24, 24, 24], [5, 3, 1]).length === 48);
}

/* -------------------------------------------- 6. expansion is group invariant */

gate('6  expansion is invariant under its own group');
{
  for (const preset of PRESETS) {
    const { unit } = buildPreset(preset.id);
    const { grid } = expandUnit(unit, { budget: 4000000 });
    const g = unit.group;
    const q = [0, 0, 0];
    let broken = 0;
    grid.forEach((x, y, z) => {
      if (broken) return;
      for (let i = 0; i < g.order; i += Math.max(1, Math.floor(g.order / 8))) {
        applyOp(g, i, unit.dims, [x, y, z], q);
        if (!grid.has(q[0], q[1], q[2])) broken++;
      }
    });
    check(`${preset.name}: every block's images are present`, broken === 0, `${broken} missing`);
    check(`${preset.name}: expansion is not empty`, grid.size > 0);
    check(`${preset.name}: expansion stays inside the cell`,
      (() => {
        const b = grid.bounds(true);
        return b.min.every((v) => v >= 0) && b.max.every((v, a) => v < unit.dims[a]);
      })());
  }

  // Determinism: same input, same output, twice.
  const one = buildPreset('cubic-crypt');
  const two = buildPreset('cubic-crypt');
  const a = expandUnit(one.unit, {}).grid, b = expandUnit(two.unit, {}).grid;
  check('expansion is deterministic', a.size === b.size && [...a.cells.keys()].every((k) => b.cells.has(k)));
}

/* ------------------------------------------------------- 7. tiling and budget */

gate('7  tiling and budget');
{
  const { unit } = buildPreset('hypostyle-hall');
  const expanded = expandUnit(unit, {});
  const tiled = tileCells(expanded.grid, unit.dims, [2, 3, 2], { budget: 4000000 });
  check('tiled count is cell count times repeats',
    tiled.stats.cells === expanded.grid.size * 12,
    `${tiled.stats.cells} vs ${expanded.grid.size * 12}`);
  check('tiled extent matches the repeats',
    tiled.stats.size[0] <= unit.dims[0] * 2 && tiled.stats.size[1] <= unit.dims[1] * 3);

  const tight = tileCells(expanded.grid, unit.dims, [4, 4, 4], { budget: 1000 });
  check('over-budget builds refuse rather than hang', tight.stats.ok === false);
  check('refusal says how far over it was', /budget/.test(tight.stats.message));

  const skeleton = buildSkeleton(unit, [2, 2, 1], { budget: 4000000 });
  check('buildSkeleton returns both stages',
    skeleton.expand.cellCells > 0 && skeleton.tile.cells === skeleton.expand.cellCells * 4);
}

/* ------------------------------------------------------------ 8. blockcore */

gate('8  blockcore');
{
  const g = new VoxelGrid({ budget: 100 });
  check('key round trip at the extremes',
    [[-65536, 0, 65535], [0, 0, 0], [65535, -65536, 7]].every(([x, y, z]) => {
      const p = unpackKey(packKey(x, y, z));
      return p[0] === x && p[1] === y && p[2] === z;
    }));
  check('keys stay exact integers', packKey(65535, 65535, 65535) <= Number.MAX_SAFE_INTEGER);

  g.set(1, 2, 3, 7);
  check('read back what was written', g.material(1, 2, 3) === 7);
  check('missing cells read as -1', g.material(9, 9, 9) === -1);
  g.delete(1, 2, 3);
  check('delete removes the cell', !g.has(1, 2, 3) && g.size === 0);

  let threw = false;
  try { for (let i = 0; i < 200; i++) g.set(i, 0, 0, 0); } catch (e) { threw = e instanceof BudgetExceeded; }
  check('budget is enforced', threw && g.size === 100, `size ${g.size}`);

  // Mesher: merged quads must cover exactly the exposed faces.
  const box = new VoxelGrid({ budget: 100000 });
  for (let x = 0; x < 6; x++) for (let y = 0; y < 5; y++) for (let z = 0; z < 4; z++) box.set(x, y, z, 0);
  const exposed = countExposedFaces(box);
  const mesh = meshGrid(box, { palette: new Palette() });
  check('solid box exposes only its surface', exposed === 2 * (6 * 5 + 5 * 4 + 6 * 4), `${exposed}`);
  check('greedy mesh covers the same area', Math.round(meshArea(mesh)) === exposed,
    `${meshArea(mesh).toFixed(1)} vs ${exposed}`);
  check('greedy mesh uses far fewer quads', mesh.quadCount === 6, `${mesh.quadCount}`);

  const hollow = new VoxelGrid({ budget: 100000 });
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) for (let z = 0; z < 5; z++) {
    if (x === 0 || y === 0 || z === 0 || x === 4 || y === 4 || z === 4) hollow.set(x, y, z, 3);
  }
  const hollowMesh = meshGrid(hollow, { palette: new Palette() });
  check('hollow shell area matches its faces', Math.round(meshArea(hollowMesh)) === countExposedFaces(hollow));

  // NBT round trip.
  const root = nbt.compound({
    format_version: nbt.int(1),
    size: nbt.intList([3, 4, 5]),
    label: nbt.string('hypostyle'),
    nested: nbt.compound({ flag: nbt.byte(1), ratio: nbt.float(0.5) }),
    things: nbt.list('compound', [nbt.compound({ n: nbt.int(7) })]),
  });
  const parsed = readNBT(writeNBT(root, 'root'));
  check('NBT round trips scalars', parsed.root.value.format_version.value === 1
    && parsed.root.value.label.value === 'hypostyle');
  check('NBT round trips lists', parsed.root.value.size.value.join() === '3,4,5');
  check('NBT round trips nesting', parsed.root.value.nested.value.flag.value === 1
    && parsed.root.value.things.value[0].value.n.value === 7);
  check('NBT keeps the root name', parsed.name === 'root');

  // .mcstructure.
  const small = new VoxelGrid({ budget: 1000 });
  small.set(0, 0, 0, 0);
  small.set(2, 1, 3, 4);
  small.set(1, 1, 1, 4);
  const built = buildMcStructure(small, { palette: new Palette() });
  const back = readMcStructure(built.bytes);
  check('structure size is the bounding box', back.size.join() === '3,2,4', back.size.join());
  check('structure keeps every block', back.solidCount === 3, `${back.solidCount}`);
  check('palette has one entry per distinct block', back.palette.length === 2, `${back.palette.length}`);
  check('palette entries are namespaced', back.palette.every((p) => p.name.startsWith('minecraft:')));
  check('palette entries carry a version', back.palette.every((p) => p.version > 0));
  check('two layers are written', back.layers.length === 2);
  check('the second layer is empty', back.layers[1].every((i) => i === -1));
  check('format version is 1', back.formatVersion === 1);
  {
    const [sx, sy, sz] = back.size;
    const idx = ((2 - 0) * sy + (1 - 0)) * sz + (3 - 0);
    check('index order is x-major then y then z',
      back.layers[0][idx] >= 0 && back.palette[back.layers[0][idx]].name.includes('quartz'),
      back.palette[back.layers[0][idx]] && back.palette[back.layers[0][idx]].name);
    check('empty cells are left alone (-1)', back.layers[0].filter((i) => i === -1).length === sx * sy * sz - 3);
  }

  // Split and guide.
  const wide = new VoxelGrid({ budget: 400000 });
  for (let x = 0; x < 130; x++) for (let y = 0; y < 20; y++) wide.set(x, y, 0, 0);
  const split = splitGrid(wide, { chunk: [64, 64, 64] });
  check('split covers every cell once',
    split.chunks.reduce((n, c) => n + c.cells, 0) === wide.size, `${split.chunks.reduce((n, c) => n + c.cells, 0)}`);
  check('split produces aligned pieces', split.chunks.every((c) =>
    c.offset.every((v, a) => (v - split.origin[a]) % split.chunkSize[a] === 0)));
  check('pieces stay inside the chunk size', split.chunks.every((c) =>
    c.size.every((v, a) => v <= split.chunkSize[a])));
  const guide = placementGuide(split, { baseName: 'test' });
  check('guide lists every piece', split.chunks.every((c) =>
    guide.includes(`test_${String(c.index).padStart(3, '0')}`)));
  check('guide gives the first piece a zero offset', /\+0, \+0, \+0/.test(guide));

  // ZIP.
  const zip = buildZip([
    { path: 'manifest.json', data: '{"a":1}' },
    { path: 'structures/x/y.mcstructure', data: new Uint8Array([1, 2, 3, 4]) },
  ]);
  const entries = readZipDirectory(zip.bytes);
  check('zip has an end-of-central-directory record', entries !== null);
  check('zip lists both entries', entries && entries.length === 2, entries && String(entries.length));
  check('zip CRCs match the data', entries && entries.every((e) => e.crcOk), 'crc mismatch');
  check('crc32 matches a known value', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926,
    crc32(new TextEncoder().encode('123456789')).toString(16));

  const pack = buildMcPack({
    name: 'test pack', namespace: 'hypostyle',
    structures: [{ name: 'piece_000', bytes: built.bytes }],
    extraFiles: [{ path: 'placement-guide.txt', data: guide }],
  });
  check('pack contains a manifest', pack.files.includes('manifest.json'));
  check('pack puts structures in the right folder',
    pack.files.includes('structures/hypostyle/piece_000.mcstructure'));
  check('manifest has two distinct uuids',
    pack.manifest.header.uuid !== pack.manifest.modules[0].uuid);
  check('manifest uuids are uuid-shaped',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pack.manifest.header.uuid),
    pack.manifest.header.uuid);
  check('pack is a readable zip', readZipDirectory(pack.bytes) !== null);

  // Picking.
  const wall = new VoxelGrid({ budget: 1000 });
  for (let y = 0; y < 5; y++) for (let z = 0; z < 5; z++) wall.set(10, y, z, 0);
  const hit = raycastGrid(wall, [0.5, 2.5, 2.5], [1, 0, 0], 100);
  check('raycast finds the wall', hit.hit && hit.cell[0] === 10, JSON.stringify(hit.cell));
  check('raycast reports the face it came in through', hit.normal.join() === '-1,0,0', hit.normal.join());
  check('raycast gives the cell in front of the face', hit.adjacent.join() === '9,2,2', hit.adjacent.join());
  check('raycast misses when it should', !raycastGrid(wall, [0.5, 2.5, 2.5], [0, 1, 0], 100).hit);
}

/* ------------------------------------------------------------ 9. axis map */

gate('9  axis map into Minecraft');
{
  const g = new VoxelGrid({ budget: 1000 });
  g.set(0, 0, 0, 0);      // origin
  g.set(3, 0, 0, 1);      // +a
  g.set(0, 5, 0, 2);      // +b
  g.set(0, 0, 7, 3);      // +c, the height
  const mc = toMinecraftAxes(g);
  check('cell count is unchanged', mc.size === 4, `${mc.size}`);
  const b = mc.bounds(true);
  check('build sits on the origin', b.min.join() === '0,0,0', b.min.join());
  check('c becomes height', b.size[1] === 8, `${b.size.join('x')}`);
  check('a stays the same length', b.size[0] === 4);
  check('b becomes depth', b.size[2] === 6);

  // Handedness: map the three basis vectors and take the determinant.
  const map = (p) => [p[0], p[2], -p[1]];
  const m = [map([1, 0, 0]), map([0, 1, 0]), map([0, 0, 1])];
  const d = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
          - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
          + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  check('the axis map is a rotation, not a reflection', d === 1, `determinant ${d}`);

  const { unit } = buildPreset('arcade');
  const skeleton = buildSkeleton(unit, [1, 1, 1], { budget: 4000000 });
  const exported = buildExport(skeleton.grid, { name: 'arcade test', chunk: [64, 64, 64] });
  check('export keeps every block', exported.cells === skeleton.tile.cells,
    `${exported.cells} vs ${skeleton.tile.cells}`);
  check('export names the pack file', exported.filename.endsWith('.mcpack'));
  check('export writes a placement guide', exported.guide.includes('placement guide'));
  check('export pack is a readable zip', readZipDirectory(exported.pack) !== null);
  check('tall build splits into pieces', exported.pieces >= 1);
  check('every piece parses back', exported.structures.every((s) => {
    try { return readMcStructure(s.bytes).solidCount === s.cells; } catch { return false; }
  }));
  check('piece cell counts sum to the whole',
    exported.structures.reduce((n, s) => n + s.cells, 0) === exported.cells);

  // The single .mcstructure is always written, whatever the size.
  check('a whole-build structure is always produced', exported.single instanceof Uint8Array);
  check('the whole-build structure holds every block',
    readMcStructure(exported.single).solidCount === exported.cells,
    `${readMcStructure(exported.single).solidCount} vs ${exported.cells}`);
  check('the whole-build structure carries the full size',
    readMcStructure(exported.single).size.join('x') === exported.size.join('x'),
    readMcStructure(exported.single).size.join('x'));

  // Force a build past the 64 limit and check it still exports in one file.
  const bigUnit = buildPreset('arcade').unit;
  const big = buildSkeleton(bigUnit, [3, 3, 2], { budget: 4000000 });
  const bigExport = buildExport(big.grid, { name: 'oversize test', chunk: [64, 64, 64] });
  check('an oversized build still exports as one structure',
    bigExport.single instanceof Uint8Array && bigExport.oversize === true,
    `oversize=${bigExport.oversize}`);
  check('oversized: bounds really do exceed 64',
    Math.max(...bigExport.size) > 64, bigExport.size.join('x'));
  check('oversized: the single file still round trips',
    readMcStructure(bigExport.single).solidCount === bigExport.cells);
  check('oversized: pieces are produced as well', bigExport.pieces > 1, `${bigExport.pieces}`);

  // commands.txt: one /structure load per piece, in the pack and on the result.
  const cmdLines = bigExport.commands.split('\n').filter((l) => l.startsWith('/structure load'));
  check('commands: one load line per piece', cmdLines.length === bigExport.pieces,
    `${cmdLines.length} lines vs ${bigExport.pieces} pieces`);
  check('commands: every line is namespaced',
    cmdLines.every((l) => l.includes(`${bigExport.namespace}:`)));
  check('commands: every line has three relative coordinates',
    cmdLines.every((l) => {
      const parts = l.trim().split(/\s+/);
      return parts.length === 6 && parts.slice(3).every((p) => /^~(-?\d+)?$/.test(p));
    }), cmdLines[1] || '');
  check('commands: the first piece sits at the player',
    cmdLines[0].endsWith(' ~ ~ ~'), cmdLines[0]);
  check('commands: offsets match the placement guide',
    (() => {
      const base = bigExport.structures[0].offset;
      return bigExport.structures.every((s, i) => {
        const rel = [0, 1, 2].map((a) => s.offset[a] - base[a]);
        const want = rel.map((n) => (n === 0 ? '~' : `~${n}`)).join(' ');
        return cmdLines[i].endsWith(` ${want}`);
      });
    })());
  check('commands: the oversize caveat is stated', bigExport.commands.includes('64'));
  check('commands.txt is inside the pack',
    (() => {
      const entries = readZipDirectory(bigExport.pack);
      return entries !== null && entries.some((e) => e.name === 'commands.txt' && e.crcOk);
    })());
  check('the pack also carries the guide and readme',
    (() => {
      const names = (readZipDirectory(bigExport.pack) || []).map((e) => e.name);
      return names.includes('placement-guide.txt') && names.includes('README.txt');
    })());
  check('a single-piece build gets a single command',
    (() => {
      const small = buildExport(buildSkeleton(buildPreset('cloister').unit, [1, 1, 1],
        { budget: 4000000 }).grid, { name: 'small test', chunk: [64, 64, 64] });
      const ls = small.commands.split('\n').filter((l) => l.startsWith('/structure load'));
      return small.oversize === false && ls.length === 1 && ls[0].endsWith(' ~ ~ ~');
    })());
}

/* -------------------------------------------------------------- 10. rooms */

gate('10  room finding');
{
  const sealed = new VoxelGrid({ budget: 100000 });
  for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) for (let z = 0; z < 9; z++) {
    if (x === 0 || y === 0 || z === 0 || x === 8 || y === 8 || z === 8) sealed.set(x, y, z, 0);
  }
  const r1 = findVoids(sealed);
  check('a sealed box has one sealed room', r1.sealed === 1, `${r1.sealed}`);
  check('the room is the right size', r1.sealedAir === 7 * 7 * 7, `${r1.sealedAir}`);
  check('nothing is reported as open', r1.open === 0, `${r1.open}`);

  sealed.delete(4, 4, 0);
  const r2 = findVoids(sealed);
  check('one hole opens the room up', r2.sealed === 0 && r2.open >= 1);

  const two = new VoxelGrid({ budget: 100000 });
  for (let x = 0; x < 17; x++) for (let y = 0; y < 9; y++) for (let z = 0; z < 9; z++) {
    if (x === 0 || y === 0 || z === 0 || x === 16 || y === 8 || z === 8 || x === 8) two.set(x, y, z, 0);
  }
  const r3 = findVoids(two);
  check('a dividing wall gives two rooms', r3.sealed === 2, `${r3.sealed}`);

  const solid = new VoxelGrid({ budget: 1000 });
  solid.set(0, 0, 0, 0);
  check('a single block has no rooms', findVoids(solid).regions.length === 0);
}

/* ------------------------------------------------------------ 11. presets */

gate('11  presets');
{
  for (const preset of PRESETS) {
    const { unit } = buildPreset(preset.id);
    const skeleton = buildSkeleton(unit, [2, 2, 1], { budget: 4000000 });
    check(`${preset.name}: authors blocks`, unit.blocks.size > 0);
    check(`${preset.name}: cell edges are legal for ${unit.group.hm}`,
      checkDims(unit.group, unit.dims).ok, unit.dims.join('x'));
    check(`${preset.name}: expands`, skeleton.expand.cellCells > unit.blocks.size);
    check(`${preset.name}: fills between 5% and 60% of the cell`,
      skeleton.expand.fill > 0.05 && skeleton.expand.fill < 0.6,
      `${(skeleton.expand.fill * 100).toFixed(1)}%`);
    check(`${preset.name}: tiles to a real building`, skeleton.tile.cells > 1000);
    check(`${preset.name}: has air inside its bounding box`,
      findVoids(skeleton.grid).air > skeleton.tile.cells * 0.3);
    check(`${preset.name}: exports`,
      buildExport(skeleton.grid, { name: preset.id }).pack.length > 500);
  }
  const unitJson = buildPreset('cloister-cells').unit.toJSON();
  const reloaded = UnitCell.fromJSON(JSON.parse(JSON.stringify(unitJson)));
  check('unit JSON round trips',
    reloaded.blocks.size === buildPreset('cloister-cells').unit.blocks.size
    && reloaded.dims.join() === unitJson.dims.join()
    && reloaded.group.number === unitJson.group);
}

/* ------------------------------------------------ 12. modules and adjacency */

gate('12  wfc modules');
{
  const set = moduleSet();
  check('the library expands into variants', set.variants.length >= set.families,
    `${set.families} modules -> ${set.variants.length} variants`);
  check('every variant carries 27 cells',
    set.variants.every((v) => v.cells.length === 27));

  // Four turns about z is the identity; the mirror is an involution.
  const base = parseLayers([['SC.', '...', '...'], ['...', '.P.', '...'], ['..G', '...', '...']]);
  let spun = base;
  for (let i = 0; i < 4; i++) spun = rotateZ(spun);
  check('four quarter turns come back to the start', contentKey(spun) === contentKey(base));
  check('the mirror is its own inverse',
    contentKey(mirrorX(mirrorX(base))) === contentKey(base));
  check('a turn is a bijection on the 27 cells',
    (() => {
      const seen = new Set();
      const r = rotateZ(base);
      let n = 0;
      for (let i = 0; i < 27; i++) if (r[i] !== -1) n++;
      for (let i = 0; i < 27; i++) if (base[i] !== -1) seen.add(i);
      return n === seen.size;
    })());
  check('turning about z never changes a height',
    (() => {
      const r = rotateZ(base);
      for (let z = 0; z < 3; z++) {
        let a = 0, b = 0;
        for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) {
          if (base[wfcIdx(x, y, z)] !== -1) a++;
          if (r[wfcIdx(x, y, z)] !== -1) b++;
        }
        if (a !== b) return false;
      }
      return true;
    })());

  // Faces must line up physically: a face and the face it meets index the same
  // positions, so a module butted against a copy of itself always agrees.
  check('a module always fits its own mirror image across a face',
    (() => {
      for (const v of set.variants) {
        for (let d = 0; d < 6; d++) {
          if (v.profiles[d] !== faceProfile(v.cells, d)) return false;
        }
      }
      return true;
    })());
  check('opposite() pairs the six directions', [0, 1, 2, 3, 4, 5]
    .every((d) => opposite(opposite(d)) === d && opposite(d) !== d));

  // No variant may be dead: something has to be placeable next to it in every
  // direction, or it can never be chosen without an immediate contradiction.
  // A variant with no partner at all in some direction can only ever be placed
  // where that side is boundary. That is legitimate downward for the floor band
  // and upward for the ceiling band, since those layers never have a wave cell
  // there - and a bug anywhere else, because the solver would contradict the
  // moment it chose one.
  const dead = [];
  for (let i = 0; i < set.variants.length; i++) {
    const band = set.variants[i].band;
    for (let d = 0; d < 6; d++) {
      if (d === 5 && band === 'floor') continue;
      if (d === 4 && band === 'ceiling') continue;
      const row = set.adj[d][i];
      let any = false;
      for (let j = 0; j < row.length; j++) if (row[j]) { any = true; break; }
      if (!any) dead.push(`${set.variants[i].name} dir${d}`);
    }
  }
  check('no variant is dead where it could meet another', dead.length === 0,
    dead.slice(0, 4).join(', '));
  check('a pillar passes every band and is live in all six directions',
    (() => {
      for (let i = 0; i < set.variants.length; i++) {
        if (set.variants[i].band !== 'any') continue;
        for (let d = 0; d < 6; d++) {
          const row = set.adj[d][i];
          let any = false;
          for (let j = 0; j < row.length; j++) if (row[j]) { any = true; break; }
          if (!any) return false;
        }
      }
      return true;
    })());

  check('adjacency is symmetric',
    (() => {
      for (let d = 0; d < 6; d++) {
        const od = opposite(d);
        for (let a = 0; a < set.variants.length; a++) {
          for (let b = 0; b < set.variants.length; b++) {
            if (set.adj[d][a][b] !== set.adj[od][b][a]) return false;
          }
        }
      }
      return true;
    })());

  check('every band has an empty module',
    ['floor', 'interior', 'ceiling'].every((band) => {
      const mask = set.bandMasks.get(band);
      return set.variants.some((v, i) => mask[i] && v.solid === 0);
    }));
  check('every run family has an end cap',
    ['floor.bench', 'floor.table', 'ceiling.beam'].every((fam) =>
      set.variants.some((v) => v.name === `${fam}_end`)
      && set.variants.some((v) => v.name === `${fam}_mid`)));
  check('an end cap really is open on one side',
    (() => {
      const mid = set.variants.filter((v) => v.name === 'floor.bench_mid');
      const end = set.variants.filter((v) => v.name === 'floor.bench_end');
      const opens = end.some((v) => [0, 1, 2, 3].some((d) => v.profiles[d] === 0));
      const runs = mid.some((v) => [0, 1, 2, 3].some((d) => v.profiles[d] !== 0));
      return opens && runs;
    })());

  // The boundary rule, direction by direction.
  const solidFace = 0x1ff;
  check('a solid neighbour forbids nothing', forbiddenMask(0, solidFace) === 0);
  check('an empty neighbour forbids everything', forbiddenMask(0, 0) === 0x1ff);
  check('the rule is the same in all six directions',
    [0, 1, 2, 3, 4, 5].every((d) => forbiddenMask(d, 0b101) === forbiddenMask(0, 0b101)));
  check('a lamp needs a roof',
    (() => {
      const lamp = set.variants.find((v) => v.name === 'ceiling.lamp');
      return !boundaryAllows(lamp, 4, 0) && boundaryAllows(lamp, 4, solidFace);
    })());
  check('nothing is placed with air under it',
    set.variants.every((v) => v.profiles[5] === 0 || !boundaryAllows(v, 5, 0)));
  check('an empty module is allowed against anything',
    (() => {
      const v = set.variants.find((x) => x.solid === 0);
      return [0, 1, 2, 3, 4, 5].every((d) => boundaryAllows(v, d, 0));
    })());
}

/* --------------------------------------------------- 13. the wave in anger */

gate('13  wave function collapse');
{
  // A sealed room, three modules on a side inside, with real walls.
  const room = (w, h, d) => {
    const g = new VoxelGrid({ budget: 200000 });
    for (let x = 0; x < w; x++) for (let y = 0; y < d; y++) for (let z = 0; z < h; z++) {
      if (x === 0 || y === 0 || z === 0 || x === w - 1 || y === d - 1 || z === h - 1) g.set(x, y, z, 0);
    }
    return g;
  };

  const r = fillInteriors(room(11, 11, 11), { seed: 4, density: 0.7 });
  check('a sealed room is filled', r.ok && r.solvedRegions === 1, `${r.solvedRegions} rooms`);
  check('the fill places blocks', r.placed > 0, `${r.placed}`);
  check('the skeleton is never overwritten',
    (() => {
      const skeleton = room(11, 11, 11);
      let same = true;
      skeleton.forEach((x, y, z, v) => { if (r.grid.get(x, y, z) !== v) same = false; });
      return same;
    })());
  check('the fill only ever wrote into air',
    r.grid.size >= room(11, 11, 11).size && r.grid.size === room(11, 11, 11).size + r.placed,
    `${r.grid.size}`);
  // "Floating" is not "has no block directly beneath it" - a table top is held
  // up by its own legs one cell to either side. The property that actually
  // matters is that no placed block belongs to a cluster hanging free of the
  // skeleton, so flood through everything solid starting from the skeleton and
  // require that it reaches every block the fill added.
  check('nothing is left floating free of the skeleton',
    (() => {
      const skeleton = room(11, 11, 11);
      const seen = new Set();
      const stack = [];
      const key = (x, y, z) => `${x},${y},${z}`;
      skeleton.forEach((x, y, z) => { seen.add(key(x, y, z)); stack.push([x, y, z]); });
      while (stack.length) {
        const [x, y, z] = stack.pop();
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const p2 = [x + dx, y + dy, z + dz];
          const k = key(p2[0], p2[1], p2[2]);
          if (seen.has(k) || !r.grid.has(p2[0], p2[1], p2[2])) continue;
          seen.add(k);
          stack.push(p2);
        }
      }
      let loose = 0;
      r.grid.forEach((x, y, z) => { if (!seen.has(key(x, y, z))) loose++; });
      return loose === 0;
    })());
  check('the coarse grid is offset to sit on the floor', r.offset.some((v) => v > 0),
    r.offset.join(','));

  // Determinism and seed sensitivity.
  const a = fillInteriors(room(11, 11, 11), { seed: 4, density: 0.7 });
  const b2 = fillInteriors(room(11, 11, 11), { seed: 5, density: 0.7 });
  check('the same seed gives the same fill', a.placed === r.placed && a.grid.size === r.grid.size);
  check('a different seed gives a different fill', b2.placed !== r.placed || b2.grid.size !== r.grid.size,
    `${b2.placed} vs ${r.placed}`);

  // Density does what it says.
  const sparse = fillInteriors(room(14, 14, 14), { seed: 9, density: 0.05 });
  const dense = fillInteriors(room(14, 14, 14), { seed: 9, density: 0.95 });
  check('density changes how much is placed', dense.placed > sparse.placed,
    `${sparse.placed} at 0.05, ${dense.placed} at 0.95`);

  // Two rooms separated by a wall must be solved as two regions.
  const pair = new VoxelGrid({ budget: 200000 });
  for (let x = 0; x < 23; x++) for (let y = 0; y < 11; y++) for (let z = 0; z < 11; z++) {
    if (x === 0 || y === 0 || z === 0 || x === 22 || y === 10 || z === 10 || x === 11) {
      pair.set(x, y, z, 0);
    }
  }
  const two = fillInteriors(pair, { seed: 2, density: 0.6 });
  check('a dividing wall gives two regions', two.solvedRegions === 2, `${two.solvedRegions}`);

  // Connectivity: the fill must not seal anything that was open.
  check('nothing is newly cut off', two.connectivity.cutOff === 0, `${two.connectivity.cutOff}`);

  // Every preset, tiled, at three densities.
  for (const preset of PRESETS) {
    const sk = buildSkeleton(buildPreset(preset.id).unit, [1, 1, 1], { budget: 4000000 });
    for (const density of [0.2, 0.6, 0.9]) {
      const f = fillInteriors(sk.grid, { seed: 17, density });
      check(`${preset.name} at density ${density}: every region solved`,
        f.ok && f.failedRegions === 0, f.ok ? `${f.failedRegions} failed` : f.message);
      check(`${preset.name} at density ${density}: nothing sealed off`,
        f.ok && f.connectivity.cutOff === 0, f.ok ? `${f.connectivity.cutOff}` : '');
    }
  }

  // Contradictions are reported, not thrown, and not looped on forever.
  const impossible = solve({
    dims: [2, 1, 1],
    active: Uint8Array.from([1, 1]),
    allowed: Uint8Array.from([1, 0, 0, 1]),
    weights: Float64Array.from([1, 1]),
    adj: [
      [Uint8Array.from([1, 0]), Uint8Array.from([0, 1])],   // +x: a-a, b-b only
      [Uint8Array.from([1, 0]), Uint8Array.from([0, 1])],
      [Uint8Array.from([1, 1]), Uint8Array.from([1, 1])],
      [Uint8Array.from([1, 1]), Uint8Array.from([1, 1])],
      [Uint8Array.from([1, 1]), Uint8Array.from([1, 1])],
      [Uint8Array.from([1, 1]), Uint8Array.from([1, 1])],
    ],
    seed: 1,
    retries: 3,
  });
  check('an impossible region fails cleanly', impossible.ok === false && !!impossible.failure);
  check('retries are capped', impossible.attempts === 4, `${impossible.attempts}`);

  check('a build too small for one module is reported',
    (() => {
      const tiny = new VoxelGrid({ budget: 100 });
      tiny.set(0, 0, 0, 0);
      tiny.set(1, 1, 1, 0);
      const t = fillInteriors(tiny);
      return t.ok === false && typeof t.message === 'string';
    })());

  // Partitions run floor to ceiling by construction, so a legal wave can still
  // cut a room in two. That has to be caught inside the retry loop, not merely
  // reported afterwards, and it has to hold over seeds rather than for one.
  {
    let worst = 0, walls = 0, runs = 0, bad = 0;
    for (let seed = 1; seed <= 12; seed++) {
      for (const density of [0.3, 0.7, 0.95]) {
        const f = fillInteriors(room(14, 11, 14), { seed, density });
        runs++;
        if (f.connectivity.cutOff > worst) worst = f.connectivity.cutOff;
        if (f.connectivity.cutOff > 0) bad++;
        for (const [name, c] of f.byFamily) if (name.startsWith('wall.')) walls += c;
        if (f.regions.some((r) => r.ok && r.orphans > 0)) bad++;
      }
    }
    check(`no seed seals a room off (${runs} runs)`, worst === 0 && bad === 0,
      `worst ${worst}, ${bad} bad runs`);
    check('partitions are actually being built', walls > 0, `${walls} wall cells`);
  }
  check('every region reports its orphan count',
    r.regions.every((x) => !x.ok || typeof x.orphans === 'number'));

  check('the rng is deterministic',
    (() => {
      const p = mulberry32(12345), q = mulberry32(12345);
      for (let i = 0; i < 50; i++) if (p() !== q()) return false;
      return mulberry32(1)() !== mulberry32(2)();
    })());
}

/* --------------------------------------------- 14. clearing open space out */

gate('14  open space as air');
{
  const sk = buildSkeleton(buildPreset('cloister-cells').unit, [1, 1, 1], { budget: 4000000 });
  const none = buildExport(sk.grid, { name: 'air none', air: 'none' });
  const roofed = buildExport(sk.grid, { name: 'air roofed', air: 'roofed' });
  const box = buildExport(sk.grid, { name: 'air box', air: 'box' });

  check('the air mode is reported back', none.air === 'none' && roofed.air === 'roofed' && box.air === 'box');
  check('an unknown air mode falls back to leaving terrain',
    buildExport(sk.grid, { name: 'x', air: 'nonsense' }).air === 'none');

  const readAir = (bytes) => {
    const s = readMcStructure(bytes);
    return { solid: s.solidCount, size: s.size, air: s.airCount };
  };
  const a0 = readAir(none.single), a1 = readAir(roofed.single), a2 = readAir(box.single);
  check('the block count is the same whatever the air mode',
    a0.solid === a1.solid && a1.solid === a2.solid, `${a0.solid}/${a1.solid}/${a2.solid}`);
  check('leaving terrain writes no air at all', a0.air === 0, `${a0.air}`);
  check('clearing under the build writes air', a1.air > 0, `${a1.air}`);
  // For a building whose roof covers its whole footprint these two agree, and
  // that is correct: there is nothing in the box that is not under the roof.
  check('clearing the whole box writes at least as much air', a2.air >= a1.air,
    `${a2.air} vs ${a1.air}`);
  check('on a stepped shape the two modes differ',
    (() => {
      const step = new VoxelGrid({ budget: 1000 });
      for (let y = 0; y < 6; y++) step.set(0, y, 0, 0);    // tall column
      step.set(3, 0, 0, 0);                                // one low block away from it
      const rf = buildExport(step, { name: 'step roofed', air: 'roofed' });
      const bx = buildExport(step, { name: 'step box', air: 'box' });
      return readMcStructure(bx.single).airCount > readMcStructure(rf.single).airCount;
    })());
  check('the whole box really is every empty cell',
    a2.air === a2.size[0] * a2.size[1] * a2.size[2] - a2.solid,
    `${a2.air}`);

  // The roofed test itself, on a shape where the answer is obvious.
  const post = new VoxelGrid({ budget: 1000 });
  for (let y = 0; y < 5; y++) post.set(0, y, 0, 0);       // a column 5 tall at x=0,z=0
  post.set(2, 0, 0, 0);                                   // a single block at x=2
  const t = roofedTest(post, post.bounds(true));
  check('under the column counts as roofed', t(0, 2, 0) === true);
  check('the top of the column is not under itself', t(0, 4, 0) === false);
  check('beside the column is not roofed', t(2, 0, 0) === false && t(1, 2, 0) === false);
  check('outside the box is not roofed', t(-1, 0, 0) === false && t(9, 0, 0) === false);

  // Split pieces must be written from their chunk corner, not their own
  // lowest block, or they land skew by the difference.
  const tall = buildSkeleton(buildPreset('arcade').unit, [3, 3, 2], { budget: 4000000 });
  const pieces = buildExport(tall.grid, { name: 'corner test', chunk: [64, 64, 64], air: 'roofed' });
  check('a split build still keeps every block',
    pieces.structures.reduce((n, s) => n + s.cells, 0) === pieces.cells);
  check('every piece is written from its chunk corner',
    pieces.structures.every((s, i) => {
      const parsed = readMcStructure(s.bytes);
      const limit = [0, 1, 2].map((a) => Math.min(64, pieces.size[a] - s.offset[a]));
      return parsed.size.join() === limit.join();
    }), pieces.structures.map((s) => readMcStructure(s.bytes).size.join('x')).slice(0, 3).join(' '));
  check('pieces tile the whole build exactly',
    pieces.structures.every((s) => [0, 1, 2].every((a) =>
      s.offset[a] % 64 === 0 && s.offset[a] + s.size[a] <= pieces.size[a])));
}

/* ------------------------------------------------------------- reporting */

console.log(`\n${'-'.repeat(58)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nfailures:');
  for (const f of failures) console.log(`  ${f}`);
  process.exitCode = 1;
}

/* --------------------------------------------------------------- helpers */

function isSignedPermutation(r) {
  for (let i = 0; i < 3; i++) {
    let row = 0, col = 0;
    for (let j = 0; j < 3; j++) {
      row += Math.abs(r[i * 3 + j]);
      col += Math.abs(r[j * 3 + i]);
      if (Math.abs(r[i * 3 + j]) > 1) return false;
    }
    if (row !== 1 || col !== 1) return false;
  }
  return true;
}

function det3(r) {
  return r[0] * (r[4] * r[8] - r[5] * r[7])
       - r[1] * (r[3] * r[8] - r[5] * r[6])
       + r[2] * (r[3] * r[7] - r[4] * r[6]);
}

function isIdentity(r) { return r.join() === '1,0,0,0,1,0,0,0,1'; }

function canonical(g, i) {
  const r = g.rot(i), t = g.trans(i);
  return r.join(',') + '|' + t.join(',');
}

function identityIndex(g) {
  for (let i = 0; i < g.order; i++) {
    if (isIdentity(g.rot(i)) && g.trans(i).every((v) => v === 0)) return i;
  }
  return -1;
}

/** Compose operation i after j, reduced modulo the lattice, as a canonical key. */
function compose(g, i, j) {
  const a = g.rot(i), ta = g.trans(i);
  const b = g.rot(j), tb = g.trans(j);
  const r = new Array(9).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[row * 3 + k] * b[k * 3 + col];
      r[row * 3 + col] = s;
    }
  }
  const t = [0, 1, 2].map((row) => {
    let s = ta[row];
    for (let k = 0; k < 3; k++) s += a[row * 3 + k] * tb[k];
    return ((s % 12) + 12) % 12;
  });
  return r.join(',') + '|' + t.join(',');
}

/** Total area of a triangle mesh, in block faces. */
function meshArea(mesh) {
  let area = 0;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    area += Math.hypot(cx, cy, cz) / 2;
  }
  return area;
}

/** Minimal ZIP central directory reader, so the writer is checked by something. */
function readZipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    const localNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const dataAt = offset + 30 + localNameLen + extraLen;
    const data = bytes.subarray(dataAt, dataAt + size);
    entries.push({ name, size, crc, crcOk: crc32(data) === crc });
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}
