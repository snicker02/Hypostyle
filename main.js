// main.js
// Editor state and wiring. Everything structural lives in engine/; this file
// is the part that knows about the DOM.

import { GROUPS, SYSTEM_NAMES, groupByNumber } from './engine/spacegroups.js';
import { checkDims, opToString, multiplicityAt, cellIndex } from './engine/symmetry.js';
import { UnitCell } from './engine/unit.js';
import { expandUnit, buildSkeleton } from './engine/expander.js';
import { findVoids, describeVoids } from './engine/voids.js';
import { buildExport, download } from './engine/export.js';
import { PRESETS, buildPreset } from './engine/presets.js';
import { Renderer, boxLines, gridLines, linesToMesh } from './engine/renderer.js';
import {
  VoxelGrid, Palette, MATERIALS, meshGrid, raycastGrid, raycastPlane, rayFromNDC,
} from './engine/blockcore/index.js';

export const HYPOSTYLE_VERSION = '0.1.0';

const $ = (id) => document.getElementById(id);
const palette = new Palette();

const state = {
  unit: null,
  view: 'author',
  tool: 'place',
  material: 0,
  workZ: 0,
  showGhost: true,
  showDomain: false,
  boxAnchor: null,
  cellGrid: null,
  pickGrid: null,
  structure: null,
  voids: null,
  hover: null,
  dirty: true,
  systemFilter: 'all',
};

const camera = { yaw: 0.72, pitch: 0.48, dist: 90, target: [12, 12, 10], fov: 0.85 };

let renderer;

/* --------------------------------------------------------------- startup */

function boot() {
  try {
    renderer = new Renderer($('view'));
  } catch (err) {
    const fatal = $('fatal');
    fatal.style.display = 'grid';
    fatal.textContent = `${err.message}. Hypostyle needs WebGL; try another browser or enable hardware acceleration.`;
    return;
  }

  buildSwatches();
  buildPresetList();
  buildGroupList();

  const start = buildPreset('hypostyle-hall');
  state.unit = start.unit;
  $('exportName').value = start.preset.name.toLowerCase();

  wireControls();
  syncGroupUI();
  syncCellUI();
  frameCamera();
  refreshAuthor();
  loop();
}

/* ------------------------------------------------------------- UI build */

function buildSwatches() {
  const host = $('swatches');
  host.innerHTML = '';
  MATERIALS.forEach((m, i) => {
    const el = document.createElement('button');
    el.className = 'swatch' + (i === state.material ? ' on' : '');
    el.style.background = `rgb(${m.rgb.map((c) => Math.round(c * 255)).join(',')})`;
    el.title = m.label;
    el.setAttribute('aria-label', m.label);
    el.addEventListener('click', () => {
      state.material = i;
      [...host.children].forEach((c, j) => c.classList.toggle('on', j === i));
      $('materialName').textContent = m.label;
    });
    host.appendChild(el);
  });
  $('materialName').textContent = MATERIALS[state.material].label;
}

function buildPresetList() {
  const sel = $('presetSelect');
  sel.innerHTML = '';
  for (const p of PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

function buildGroupList() {
  const sel = $('groupSelect');
  const current = state.unit ? state.unit.group.number : 99;
  sel.innerHTML = '';
  const systems = state.systemFilter === 'all' ? ['o', 't', 'c'] : [state.systemFilter];
  for (const sys of systems) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = SYSTEM_NAMES[sys];
    for (const g of GROUPS) {
      if (g.system !== sys) continue;
      const opt = document.createElement('option');
      opt.value = String(g.number);
      opt.textContent = `${g.number}  ${g.hm}${g.choice ? ' (' + g.choice + ')' : ''}  ·  ${g.order} ops`;
      optgroup.appendChild(opt);
    }
    sel.appendChild(optgroup);
  }
  sel.value = String(current);
  if (!sel.value) sel.selectedIndex = 0;
}

/* ------------------------------------------------------------ UI syncing */

function syncGroupUI() {
  const g = state.unit.group;
  $('groupSymbol').innerHTML = prettySymbol(g.hm);
  $('groupMeta').textContent = `#${g.number} · ${SYSTEM_NAMES[g.system]} · ${g.order} operations`
    + (g.choice ? ` · setting ${g.choice}` : '');
  const list = $('opList');
  list.innerHTML = '';
  for (let i = 0; i < g.order; i++) {
    const row = document.createElement('div');
    row.textContent = `${String(i + 1).padStart(3)}  ${opToString(g, i)}`;
    list.appendChild(row);
  }
  $('groupSelect').value = String(g.number);
}

function prettySymbol(hm) {
  return hm.replace(/_(\d)/g, '<sub>$1</sub>').replace(/-(\d)/g, '<span style="text-decoration:overline">$1</span>');
}

function syncCellUI() {
  const d = state.unit.dims;
  $('cellA').value = d[0];
  $('cellB').value = d[1];
  $('cellC').value = d[2];
  const z = $('workZ');
  z.max = String(d[2] - 1);
  if (state.workZ > d[2] - 1) state.workZ = 0;
  z.value = String(state.workZ);
  $('workZValue').textContent = String(state.workZ);

  const groups = state.unit.group.edgeGroups();
  const ties = [];
  if (groups[0] === groups[1] && groups[1] === groups[2]) ties.push('a = b = c');
  else if (groups[0] === groups[1]) ties.push('a = b');
  else if (groups[1] === groups[2]) ties.push('b = c');
  else if (groups[0] === groups[2]) ties.push('a = c');
  $('cellNote').textContent = ties.length
    ? `${state.unit.group.hm} maps those axes onto each other, so ${ties[0]}. Edges stay multiples of 12.`
    : 'All three edges are free here. Keep them multiples of 12 so glides and screw axes land on block boundaries.';
}

function setStats(el, pairs) {
  el.innerHTML = '';
  for (const [k, v] of pairs) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    el.append(dt, dd);
  }
}

function say(message) {
  $('stMsg').textContent = message || '';
}

/* ----------------------------------------------------------- author view */

function refreshAuthor() {
  const unit = state.unit;
  const expanded = expandUnit(unit, { budget: 4000000 });
  state.cellGrid = expanded.grid;
  state.pickGrid = expanded.grid;

  const authored = new VoxelGrid({ budget: unit.blocks.budget });
  unit.blocks.forEach((x, y, z, v) => authored.set(x, y, z, v & 0xff));

  const ghost = new VoxelGrid({ budget: 4000000 });
  expanded.grid.forEach((x, y, z, v) => {
    if (!authored.has(x, y, z)) ghost.set(x, y, z, v & 0xff);
  });

  renderer.setBatch('solid', meshGrid(authored, { palette }), { order: 0 });
  renderer.setBatch('ghost', state.showGhost ? meshGrid(ghost, { palette }) : null,
    { alpha: 0.4, order: 20 });

  if (state.showDomain) {
    const { domain } = unit.domain();
    const dom = new VoxelGrid({ budget: 4000000 });
    const dims = unit.dims;
    for (let x = 0; x < dims[0]; x++) {
      for (let y = 0; y < dims[1]; y++) {
        for (let z = 0; z < dims[2]; z++) {
          if (domain[cellIndex([x, y, z], dims)]) dom.set(x, y, z, 0);
        }
      }
    }
    renderer.setBatch('domain', meshGrid(dom, { palette: flatPalette([0.30, 0.48, 0.56]) }),
      { alpha: 0.2, order: 30 });
  } else {
    renderer.clearBatch('domain');
  }

  overlayLines();
  updateUnitStats(expanded.stats);
  state.dirty = true;
}

function flatPalette(rgb) {
  return { rgbFor: () => rgb, resolve: (m) => m, blockFor: () => ({ name: 'x', states: {} }) };
}

function overlayLines() {
  const d = state.unit.dims;
  const out = { positions: [], colors: [] };
  gridLines([0, 0], [d[0], d[1]], 12, [0.16, 0.19, 0.23], state.view === 'author' ? state.workZ : 0, out);
  boxLines([0, 0, 0], d, [0.36, 0.46, 0.53], out);
  if (state.view === 'structure' && state.structure) {
    const r = state.structure.repeats;
    for (let i = 0; i <= r[0]; i++) {
      for (let j = 0; j <= r[1]; j++) {
        // corner posts only, so the overlay stays readable on a big build
        out.positions.push(i * d[0], j * d[1], 0, i * d[0], j * d[1], r[2] * d[2]);
        out.colors.push(0.19, 0.24, 0.28, 0.19, 0.24, 0.28);
      }
    }
  }
  if (state.hover) {
    const h = state.hover;
    boxLines([h[0], h[1], h[2]], [1, 1, 1], [0.86, 0.72, 0.44], out);
  }
  if (state.boxAnchor) {
    boxLines(state.boxAnchor, [1, 1, 1], [0.55, 0.78, 0.88], out);
  }
  renderer.setBatch('lines', linesToMesh(out), { mode: 'lines', unlit: true, order: 40 });
}

function updateUnitStats(stats) {
  const unit = state.unit;
  const dom = unit.domainStats();
  const cellVolume = unit.dims[0] * unit.dims[1] * unit.dims[2];
  setStats($('unitStats'), [
    ['authored blocks', stats.authored.toLocaleString()],
    ['blocks in the cell', stats.cellCells.toLocaleString()],
    ['cell filled', `${(stats.cellCells / cellVolume * 100).toFixed(1)}%`],
    ['outside the unit', dom.outside ? `${dom.outside} (redundant)` : '0'],
    ['on special positions', stats.specialSites.toLocaleString()],
    ['material clashes', stats.collisions.toLocaleString()],
  ]);
  setStats($('cellStats'), [
    ['cell volume', cellVolume.toLocaleString()],
    ['asymmetric unit', unit.domain().domainSize.toLocaleString()],
  ]);
  $('stCount').textContent = stats.cellCells.toLocaleString();
}

/* -------------------------------------------------------- structure view */

function buildStructure() {
  const repeats = [Number($('repX').value), Number($('repY').value), Number($('repZ').value)]
    .map((n) => Math.max(1, Math.min(24, n | 0)));
  const budget = Math.max(10000, Number($('budget').value) | 0);
  const t0 = performance.now();
  const result = buildSkeleton(state.unit, repeats, { budget });
  const ms = performance.now() - t0;

  if (!result.tile.ok) {
    state.structure = null;
    renderer.clearBatch('structure');
    setStats($('buildStats'), [['status', 'over budget']]);
    $('voidNote').className = 'note warn';
    $('voidNote').textContent = result.tile.message
      + '. Lower the cell count, shrink the cell, or raise the budget.';
    $('exportNote').textContent = 'Nothing built yet.';
    state.dirty = true;
    return;
  }

  state.structure = { ...result, repeats };
  state.voids = null;
  renderer.setBatch('structure', meshGrid(result.grid, { palette }), { order: 0 });
  setStats($('buildStats'), [
    ['cells', repeats.join(' x ')],
    ['blocks', result.tile.cells.toLocaleString()],
    ['extent', result.tile.size.join(' x ')],
    ['build time', `${ms.toFixed(0)} ms`],
  ]);
  $('voidNote').className = 'note';
  $('voidNote').textContent = 'Find rooms reports the air the shell encloses.';
  $('exportNote').textContent = `Ready: ${result.tile.cells.toLocaleString()} blocks.`;
  setView('structure');
  frameCamera();
  say(`built ${result.tile.cells.toLocaleString()} blocks in ${ms.toFixed(0)} ms`);
}

function analyseVoids() {
  if (!state.structure) { say('build a structure first'); return; }
  const t0 = performance.now();
  const result = findVoids(state.structure.grid);
  state.voids = result;
  $('voidNote').className = 'note' + (result.ok && result.sealed ? ' good' : '');
  $('voidNote').textContent = describeVoids(result);
  say(`rooms analysed in ${(performance.now() - t0).toFixed(0)} ms`);
}

/* ------------------------------------------------------------- view mode */

function setView(view) {
  state.view = view;
  [...$('viewTabs').children].forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  const author = view === 'author';
  renderer.clearBatch(author ? 'structure' : 'solid');
  if (author) {
    refreshAuthor();
  } else {
    renderer.clearBatch('ghost');
    renderer.clearBatch('domain');
    if (!state.structure) buildStructure();
    else overlayLines();
  }
  $('help').style.opacity = author ? '1' : '0.35';
  state.dirty = true;
}

/* --------------------------------------------------------------- camera */

function frameCamera() {
  const grid = state.view === 'structure' && state.structure ? state.structure.grid : state.cellGrid;
  const dims = state.unit.dims;
  let centre = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
  let span = Math.max(dims[0], dims[1], dims[2]);
  if (grid && grid.size) {
    const b = grid.bounds(true);
    centre = [0, 1, 2].map((a) => b.min[a] + b.size[a] / 2);
    span = Math.max(b.size[0], b.size[1], b.size[2]);
  }
  camera.target = centre;
  camera.dist = span * 2.1 + 12;
  state.dirty = true;
}

function cameraEye() {
  const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  return [
    camera.target[0] + camera.dist * cp * Math.cos(camera.yaw),
    camera.target[1] + camera.dist * cp * Math.sin(camera.yaw),
    camera.target[2] + camera.dist * sp,
  ];
}

/* ------------------------------------------------------------- pointing */

function pickAt(event) {
  const [nx, ny] = renderer.ndcFromEvent(event);
  const ray = rayFromNDC(renderer.invViewProj, nx, ny);
  const grid = state.view === 'structure' && state.structure ? state.structure.grid : state.pickGrid;
  const hit = grid ? raycastGrid(grid, ray.origin, ray.dir, 900) : { hit: false };
  if (hit.hit) return hit;
  const plane = raycastPlane(ray.origin, ray.dir, state.view === 'author' ? state.workZ : 0);
  if (!plane.hit) return { hit: false };
  return { hit: true, plane: true, cell: plane.cell, adjacent: plane.cell, normal: [0, 0, 1] };
}

function applyTool(event) {
  if (state.view !== 'author') return;
  const pick = pickAt(event);
  if (!pick.hit) return;

  const erasing = event.altKey || state.tool === 'erase' || state.tool === 'boxErase';
  const target = erasing ? pick.cell : pick.adjacent;

  if (state.tool === 'box' || state.tool === 'boxErase') {
    if (!state.boxAnchor) {
      state.boxAnchor = state.unit.fold(target);
      say('second corner');
      overlayLines();
      state.dirty = true;
      return;
    }
    const a = state.boxAnchor;
    const b = state.unit.fold(target);
    const n = state.tool === 'box'
      ? state.unit.box(a, b, state.material)
      : state.unit.eraseBox(a, b);
    state.boxAnchor = null;
    say(`${state.tool === 'box' ? 'placed' : 'erased'} ${n} block${n === 1 ? '' : 's'}`);
  } else if (erasing) {
    state.unit.erase(target);
  } else {
    state.unit.place(target, state.material);
  }
  state.structure = null;
  refreshAuthor();
}

function hoverAt(event) {
  const pick = pickAt(event);
  if (!pick.hit) {
    if (state.hover) { state.hover = null; overlayLines(); state.dirty = true; }
    $('stCursor').textContent = '—';
    $('stMult').textContent = '—';
    return;
  }
  const cell = state.view === 'author' ? state.unit.fold(pick.cell) : pick.cell;
  if (!state.hover || state.hover.join() !== cell.join()) {
    state.hover = cell;
    overlayLines();
    state.dirty = true;
  }
  $('stCursor').textContent = cell.join(', ');
  if (state.view === 'author') {
    const m = multiplicityAt(state.unit.group, state.unit.dims, cell);
    $('stMult').textContent = `${m} of ${state.unit.group.order}`;
  } else {
    $('stMult').textContent = '—';
  }
}

/* --------------------------------------------------------------- wiring */

function wireControls() {
  const canvas = $('view');
  let drag = null;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button, shift: e.shiftKey };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) { hoverAt(e); return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.button === 0 && !drag.shift) {
      camera.yaw -= dx * 0.0075;
      camera.pitch = Math.max(-1.45, Math.min(1.45, camera.pitch + dy * 0.0075));
    } else {
      const scale = camera.dist * 0.0016;
      const right = [-Math.sin(camera.yaw), Math.cos(camera.yaw), 0];
      const up = [
        -Math.sin(camera.pitch) * Math.cos(camera.yaw),
        -Math.sin(camera.pitch) * Math.sin(camera.yaw),
        Math.cos(camera.pitch),
      ];
      for (let a = 0; a < 3; a++) {
        camera.target[a] -= right[a] * dx * scale;
        camera.target[a] += up[a] * dy * scale;
      }
    }
    state.dirty = true;
  });

  canvas.addEventListener('pointerup', (e) => {
    const wasDrag = drag && drag.moved > 5;
    const button = drag ? drag.button : 0;
    drag = null;
    if (!wasDrag && button === 0) applyTool(e);
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.dist = Math.max(6, Math.min(4000, camera.dist * Math.exp(e.deltaY * 0.0012)));
    state.dirty = true;
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape' && state.boxAnchor) {
      state.boxAnchor = null; say('box cancelled'); overlayLines(); state.dirty = true;
    }
    if (e.key === 'f') { frameCamera(); }
    if (e.key === '[') { setWorkZ(state.workZ - 1); }
    if (e.key === ']') { setWorkZ(state.workZ + 1); }
    if (e.key === 'g') { $('ghostToggle').click(); }
  });

  $('systemTabs').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    state.systemFilter = button.dataset.system;
    [...$('systemTabs').children].forEach((b) => b.classList.toggle('on', b === button));
    buildGroupList();
    const sel = $('groupSelect');
    if (sel.value !== String(state.unit.group.number)) sel.selectedIndex = 0;
  });

  $('groupSelect').addEventListener('change', () => {
    applyGroup(groupByNumber(Number($('groupSelect').value)));
  });

  $('randomGroup').addEventListener('click', () => {
    const pool = state.systemFilter === 'all'
      ? GROUPS : GROUPS.filter((g) => g.system === state.systemFilter);
    applyGroup(pool[Math.floor(Math.random() * pool.length)]);
  });

  $('opToggle').addEventListener('click', () => {
    const list = $('opList');
    const showing = list.style.display === 'block';
    list.style.display = showing ? 'none' : 'block';
    $('opToggle').textContent = showing ? 'Show operations' : 'Hide operations';
    $('opToggle').classList.toggle('on', !showing);
  });

  for (const id of ['cellA', 'cellB', 'cellC']) {
    $(id).addEventListener('change', () => {
      const dims = [Number($('cellA').value), Number($('cellB').value), Number($('cellC').value)];
      const check = checkDims(state.unit.group, dims);
      state.unit.reshape(null, check.fixed);
      state.structure = null;
      syncCellUI();
      refreshAuthor();
      frameCamera();
      say(check.ok ? '' : check.problems[0] + ' - snapped to ' + check.fixed.join(' x '));
    });
  }

  $('toolTabs').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    state.tool = button.dataset.tool;
    state.boxAnchor = null;
    [...$('toolTabs').children].forEach((b) => b.classList.toggle('on', b === button));
  });

  $('workZ').addEventListener('input', () => setWorkZ(Number($('workZ').value)));

  $('ghostToggle').addEventListener('click', () => {
    state.showGhost = !state.showGhost;
    $('ghostToggle').classList.toggle('on', state.showGhost);
    refreshAuthor();
  });

  $('domainToggle').addEventListener('click', () => {
    state.showDomain = !state.showDomain;
    $('domainToggle').classList.toggle('on', state.showDomain);
    refreshAuthor();
  });

  $('loadPreset').addEventListener('click', () => {
    const { unit, preset } = buildPreset($('presetSelect').value);
    state.unit = unit;
    state.structure = null;
    state.workZ = 0;
    $('exportName').value = preset.name.toLowerCase();
    buildGroupList();
    syncGroupUI();
    syncCellUI();
    setView('author');
    frameCamera();
    say(preset.note);
  });

  $('clearUnit').addEventListener('click', () => {
    state.unit.clear();
    state.structure = null;
    refreshAuthor();
    say('cleared');
  });

  $('saveUnit').addEventListener('click', () => {
    const json = JSON.stringify(state.unit.toJSON());
    download(new TextEncoder().encode(json), `${slug($('exportName').value)}-unit.json`, 'application/json');
  });

  $('exportUnitJson').addEventListener('click', () => $('saveUnit').click());

  $('openUnit').addEventListener('click', () => $('fileInput').click());

  $('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const unit = UnitCell.fromJSON(JSON.parse(await file.text()));
      state.unit = unit;
      state.structure = null;
      buildGroupList();
      syncGroupUI();
      syncCellUI();
      setView('author');
      frameCamera();
      say(`loaded ${file.name}`);
    } catch (err) {
      say(err.message);
    }
    e.target.value = '';
  });

  $('buildBtn').addEventListener('click', buildStructure);
  $('analyseBtn').addEventListener('click', analyseVoids);

  $('viewTabs').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) setView(button.dataset.view);
  });

  $('exportPack').addEventListener('click', () => doExport('pack'));
  $('exportStructure').addEventListener('click', () => doExport('single'));

  window.addEventListener('resize', () => { state.dirty = true; });
}

function setWorkZ(z) {
  state.workZ = Math.max(0, Math.min(state.unit.dims[2] - 1, z));
  $('workZ').value = String(state.workZ);
  $('workZValue').textContent = String(state.workZ);
  overlayLines();
  state.dirty = true;
}

function applyGroup(group) {
  if (!group) return;
  const check = checkDims(group, state.unit.dims);
  state.unit.reshape(group, check.fixed);
  state.structure = null;
  syncGroupUI();
  syncCellUI();
  setView('author');
  frameCamera();
  say(check.ok ? '' : `cell snapped to ${check.fixed.join(' x ')} for ${group.hm}`);
}

function doExport(kind) {
  if (!state.structure) buildStructure();
  if (!state.structure) return;
  const name = $('exportName').value.trim() || 'hypostyle';
  const edge = Math.max(8, Math.min(64, Number($('chunkSize').value) | 0));
  const unit = state.unit;
  const notes = [
    `Space group ${unit.group.hm} (#${unit.group.number}), ${unit.group.order} operations.`,
    `Cell ${unit.dims.join(' x ')} blocks, repeated ${state.structure.repeats.join(' x ')}.`,
    `${unit.blocks.size} authored blocks became ${state.structure.tile.cells.toLocaleString()}.`,
  ];
  const t0 = performance.now();
  const result = buildExport(state.structure.grid, { name, chunk: [edge, edge, edge], notes });
  const ms = performance.now() - t0;

  if (kind === 'single') {
    if (!result.single) {
      $('exportNote').className = 'note warn';
      $('exportNote').textContent = `Too big for one structure: ${result.size.join(' x ')} `
        + `needs ${result.pieces} pieces. Use the .mcpack.`;
      return;
    }
    download(result.single, result.singleName);
  } else {
    download(result.pack, result.filename);
  }
  $('exportNote').className = 'note good';
  $('exportNote').textContent = `${result.cells.toLocaleString()} blocks, ${result.pieces} piece`
    + `${result.pieces === 1 ? '' : 's'}, ${result.size.join(' x ')} in ${ms.toFixed(0)} ms.`;
  say('exported');
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'hypostyle';
}

/* ----------------------------------------------------------- draw loop */

function loop() {
  if (state.dirty) {
    state.dirty = false;
    renderer.render({ ...camera, eye: cameraEye(), fogScale: 0.9 / (camera.dist + 60) });
    const unit = state.unit;
    $('hud').innerHTML = state.view === 'author'
      ? `${unit.group.hm} · cell ${unit.dims.join(' x ')}<br>height plane z = ${state.workZ}`
      : `${unit.group.hm} · ${state.structure ? state.structure.tile.cells.toLocaleString() + ' blocks' : 'not built'}`;
  }
  requestAnimationFrame(loop);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
