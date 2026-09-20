# Hypostyle v0.1.0

Procedural Minecraft Bedrock architecture from a crystallographic symmetry
skeleton. You author one asymmetric unit; a space group expands it into
columns, ribs, walls, floors and shell; the result tiles and exports as a
`.mcpack` of `.mcstructure` pieces.

This is **phase one only**: skeleton, editor, expander, export. No wave
function collapse code exists yet, by design — the skeleton has to produce
architecture you actually want before interiors are worth building.

```
index.html          page shell and styling
main.js             UI, camera, editing, wiring              HYPOSTYLE_VERSION
engine/
  spacegroups.js    GENERATED — 163 groups, 48 rotations, 3764 operations
  symmetry.js       operations acting on whole blocks; orbits; dimension rules
  unit.js           the asymmetric unit cell you edit
  expander.js       unit -> full cell -> tiled building
  voids.js          connected air regions, sealed or open
  export.js         axis map, split, placement guide, pack assembly
  presets.js        five worked units
  renderer.js       WebGL1 renderer (one program, batched, fogged)
  mat4.js           4x4 matrix helpers
  blockcore/        shared block engine (see "blockcore" below)
tools/
  gen-spacegroups.py  regenerates engine/spacegroups.js from spglib
  validate.mjs        headless validation, 193 checks
```

Run `node tools/validate.mjs` from the repo root. No build step, no
dependencies, no server needed — open `index.html`.

## The conventions that matter

**A block is not a point.** Block `i` occupies `[i, i+1)`, so its centre sits
at `i + 1/2`. Every symmetry operation is applied to the centre:

```
p'_k = sum_j R_kj (p_j + 1/2) - 1/2 + t_k * c_k / 12
```

Applying the operation to the index instead is the obvious thing to do and it
is wrong: mirror planes land one block off, and every even-order rotation axis
eats a row of blocks. `applyOp` keeps the arithmetic in halves so the result is
exact integer, never rounded.

**Cell edges are multiples of 12.** Translations in the 163 groups are
twelfths of a cell edge (in practice 0, 3, 6, 9 — quarters). A multiple of 12
puts every glide plane and screw axis on a block boundary. The UI snaps edges
for you; the default is 24.

**Edge ties come from the matrices, not the system name.** If any rotation in
the group carries edge *j* onto edge *k*, those two edges must be equal.
`SpaceGroup.edgeGroups()` derives this directly: cubic ties all three,
tetragonal ties a = b, orthorhombic ties nothing. No lookup table to get wrong.

**163 groups, not 230.** Orthorhombic (59), tetragonal (68) and cubic (36) are
the ones whose operations are signed permutation matrices — exact on a cubic
block lattice. Triclinic and monoclinic cells are oblique; trigonal and
hexagonal need 3- and 6-fold rotations, which have no integer representation on
a cube grid. Faking them would mean rounding, and rounding breaks the group.

**The c axis is up inside the engine.** That keeps operation strings matching
the International Tables, which is what makes the data auditable. Export
applies one rotation on the way out:

```
X = x,  Y = z,  Z = -y        determinant +1
```

A plain `(x, z, y)` swap is a reflection, determinant -1, and it would silently
turn every 4₁ screw into a 4₃. The validator checks the determinant and checks
that 4₁ and 4₃ still put a block at different heights.

**Enclosure is reported honestly.** `findVoids` labels each connected air
region `sealed` or `open`, where open means it reaches the edge of the excerpt.
A periodic building with doors and windows will always have openings cut by the
excerpt boundary, so "no fully sealed region" is the expected, correct answer
for most of the presets — not a failure. Phase two's WFC will fill the *large
connected* regions, which is the signal that actually matters.

**Cubic groups cannot tell a floor from a wall.** They map z onto x, so any
cubic unit is equally a floor, a ceiling and four walls. That makes beautiful
crypts and lousy rooms. Enclosure comes from the tetragonal and orthorhombic
groups, where the vertical is distinguishable.

## Data provenance

`engine/spacegroups.js` is generated, not typed. `tools/gen-spacegroups.py`
pulls the operations from **spglib 2.7.0** and asserts, before writing:

* exactly 59 / 68 / 36 = 163 groups
* every rotation is a signed permutation with determinant ±1
* every translation is a multiple of 1/4 of a cell edge
* the Hall symbol used for each group is recorded in the file

Origin choice 2 is used where the International Tables give two, otherwise the
standard setting. spglib is an authoring-time dependency only — nothing at
runtime imports anything.

The validator independently re-derives what it can: it checks closure and
inverses for all 163 groups as abstract groups, checks that every operation
permutes a 12³ cell bijectively, and checks known orders (Pm-3m 48,
Fm-3m 192, Ia-3d 96, P222 4).

## blockcore

`engine/blockcore/` is the shared block engine: sparse voxel map, palette,
greedy mesher, DDA picking, NBT, `.mcstructure`, splitting, ZIP, `.mcpack`.

**It is a rebuild, not the original.** The canonical copy was written during
the Fieldcraft session and shipped inside `fieldcraft-v0.1.0.zip`. That file is
not in this container, so this repo carries a reimplementation against the same
API surface — same filenames, same exported names — marked
`BLOCKCORE_VERSION = '0.2.0'`.

That means two copies now exist, which is exactly the thing the brief said to
prevent. Drop `fieldcraft-v0.1.0.zip` into a chat and the two can be diffed and
reconciled into one canonical standalone module that both projects import.

Targets Bedrock 1.26.51: block states are written flat, `format_version 1`
structures, `format_version 2` manifests, deterministic seeded UUIDs so
re-exporting the same build produces a byte-identical pack.

## Presets

Five worked units, each authored in a single asymmetric unit:

| Preset | Group | Cell | Authored | In cell | Fill |
|---|---|---|---|---|---|
| Hypostyle hall | P4mm (99) | 24³ | 688 | 2,968 | 21.5% |
| Arcade and clerestory | Pmm2 (25) | 24×24×36 | 1,045 | 4,180 | 20.2% |
| Cloister cells | P4mm (99) | 24³ | 559 | 3,164 | 22.9% |
| Staggered hall | I4mm (107) | 36³ | 1,552 | 13,512 | 29.0% |
| Cubic crypt | Pm-3m (221) | 24³ | 232 | 6,032 | 43.6% |

Collision counts in the expander are cosmetic — two orbit images landing on the
same block with different materials. First write wins, deterministically.
Staggered hall and cubic crypt have them by construction; the others are clean.

## Phase two — wave function collapse (not built)

Planned, from the brief, so the phase one shape doesn't foreclose it:

* 3×3×3 modules. Adjacency derived from block content — two modules fit across
  a face when their 3×3 boundary slices match — never hand-typed sockets.
  Authoring a module means placing blocks; the adjacency table falls out,
  including all lattice rotations.
* The skeleton enters as pre-collapsed cells, so interiors meet doorways and
  window openings correctly.
* Modules tagged floor / interior / ceiling, constrained to the matching
  vertical band.
* Contradictions restart the failing region only, with capped retries and a
  reported failure — never a whole-build restart, never a hang.
* After collapse, flood-fill from the skeleton's entrances and report orphans.

Symmetry stays on the skeleton. Interiors are deliberately asymmetric; that
contrast is the point of the combination.

## Keys

`f` frame · `[` `]` move the work plane · `g` toggle the grid ·
drag orbits · middle-drag or shift-drag pans · wheel zooms · `Esc` cancels a
box.
