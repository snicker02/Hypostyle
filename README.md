# Hypostyle v0.3.0

Procedural Minecraft Bedrock architecture from a crystallographic symmetry
skeleton. You author one asymmetric unit; a space group expands it into
columns, ribs, walls, floors and shell; the result tiles and exports as a
`.mcpack` of `.mcstructure` pieces.

Both layers are now built: the symmetry skeleton, and wave function collapse
interiors inside the rooms it encloses.

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
  wfc/
    modules.js      3x3x3 modules, lattice variants, face profiles
    library.js      the authored module set
    adjacency.js    adjacency and the skeleton boundary rule
    collapse.js     the solver
    interiors.js    regions, bands, write-back, connectivity
  renderer.js       WebGL1 renderer (one program, batched, fogged)
  mat4.js           4x4 matrix helpers
  blockcore/        shared block engine (see "blockcore" below)
tools/
  gen-spacegroups.py  regenerates engine/spacegroups.js from spglib
  validate.mjs        headless validation, 732 checks
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

## Export

Three buttons, one build:

* **.mcpack** — the pack Bedrock imports by opening it. Contains the build
  split into aligned pieces, plus `commands.txt` (the literal
  `/structure load` lines in order), `placement-guide.txt` (the same offsets as
  a table, for structure blocks) and `README.txt`.
* **Open space** — what to do with empty cells. `leave terrain` (the default)
  writes -1, meaning "don't change this block", so the build drops into terrain
  and the terrain shows through every window and fills every room.
  `clear under the build` writes explicit air in every empty cell that has part
  of the build above it in the same column, so interiors, aisles and undercrofts
  arrive hollow while the sky above the roof and the ground beside the walls are
  left alone — this is almost always the one you want. `clear the whole box`
  levels the entire bounding box. The roofed test is computed once over the
  whole build and queried per piece; worked out per piece, the topmost piece
  would have no roof above it and would come out solid.
* **Single .mcstructure** — the whole build in one file, always written, at any
  size. Over 64 blocks on an axis the structure block UI will not show it,
  because that UI clamps its size fields to 64; the file format itself has no
  such limit and `/structure load` takes the size from the file. The app warns
  and exports rather than refusing.
* **Commands** — just `commands.txt`, without opening the pack.

Commands are relative (`~`), so the player stands where the build should start
and pastes in order. The first line is always `~ ~ ~`.

```
/structure load hypostyle:arcade_000 ~ ~ ~
/structure load hypostyle:arcade_001 ~ ~ ~64
/structure load hypostyle:arcade_002 ~64 ~ ~
```

## Presets

Thirty-two worked examples, each a single asymmetric unit, grouped in the UI by
crystal system. Twenty-eight distinct space groups, orders from 4 to 192.

**Tetragonal** — Hypostyle hall (P4mm), Cloister cells (P4mm), Staggered hall
(I4mm), Spiral stair (P4₁), Spiral stair other hand (P4₃), Lantern tower
(P4/mmm), Pinwheel court (P4), Glide piers (P4bm), Water court (P4/n), Lattice
tower (I4), Deep arcade (P4cc), Hall of tombs (I4/mmm), Vaulted chamber (P-4m2),
Helical frame (I4₁).

**Orthorhombic** — Arcade and clerestory (Pmm2), Basilica (Pmm2), Chiral bays
(P222), Zigzag wall (Pba2), Long gallery (Cmm2), Terraced steps (P2₁2₁2₁),
Transept (Cmcm), Open frame (Fmm2), Braced block (Ibam), Cellular rows (Pnma),
Clerestory loft (Amm2).

**Cubic** — Cubic crypt (Pm-3m), Cubic cage (Pm-3), Octet truss (Fm-3m), Diamond
frame (Fd-3m), Gyroid cage (Ia-3d), Chiral knot (P4₁32), Space frame (Im-3m).

A few are there to make a point rather than a building. The two spiral stairs
are the same authored quarter-turn flight in P4₁ and P4₃; the only difference is
the hand of the screw, and the stairs wind opposite ways. Basilica and Arcade
are the same group in differently proportioned cells and are not remotely the
same building. Chiral bays, Pinwheel court, Terraced steps and Chiral knot have
no mirrors at all and cannot be laid over their own reflections.

**How much to author.** The rule of thumb is authored volume times group order,
less whatever lands on a special position. Pmm2 with four operations wants a
whole quadrant drawn; Fm-3m with a hundred and ninety-two wants one strut.
Author a quadrant in Fm-3m and the cell comes out solid. Every preset is checked
to land between 5% and 60% fill, which is the band where a build reads as a
building rather than as a block or a haze. The spread that comes out:

| | fill |
|---|---|
| lightest — Diamond frame, Chiral knot, Basilica | 10–13% |
| typical — halls, arcades, courts, cloisters | 15–40% |
| heaviest — Clerestory loft, Terraced steps, Transept | 45–52% |

## Phase two — interiors

The skeleton is exactly periodic. The interiors are not, deliberately: the
contrast between a shell that repeats and a fill that never does is the whole
reason for combining the two.

**Modules are 3x3x3 blocks and nothing else.** There are no sockets and no
hand-typed tags. Two modules fit across a face when the 3x3 layers they present
to each other agree — read straight off the blocks. The comparison is on
solidity rather than material, which is what lets a mossy bench and a clean one
be the same bench without doubling the module set. Nine positions, nine bits,
one integer per face, so a compatibility test is a single `===`.

Every module is expanded by the lattice rotations that keep up pointing up: four
quarter turns about the vertical, with and without a mirror, deduplicated. The
full 24 rotations of the cube are not used — they would tip a floor onto a wall,
and in a building the vertical is not interchangeable with the horizontal.

**The coarse grid is offset, and that matters more than it sounds.** Laying the
3x3x3 grid from the build's minimum corner puts the skeleton's one-block floor
inside the bottom layer of cells, which makes that layer non-empty, which
excludes it — so the first usable layer starts three blocks up and everything
lands hanging in the air. All 27 alignments are tried and the best is kept.

"Best" took two goes to get right. Scoring by empty cells alone picked an
alignment for the arcade that floated two blocks clear of the floor: the layer
was empty, which is what was being counted, but nothing in it had anything
underneath, so the boundary rule forbade every module that stands on the ground
and the entire floor band came out void — 115 blocks placed in a room of 492
cells. The score now counts *supported* empty cells first, cells with solid
directly beneath them, and uses the plain empty count only to break ties. Same
build, same seed, 949 blocks.

**The skeleton enters pre-collapsed.** A coarse cell takes part only if all 27
of its blocks are air. Everything else — wall, column, a cell clipped by the box
— is a boundary condition read off its actual block content. The rule there is
not equality but one prohibition, the same in all six directions:

> a module may not put a block against air on the far side of a boundary.

Sideways that keeps doorways, arches and windows clear. Downwards it means
nothing is placed without support. Upwards it means a lamp needs a roof to hang
from. This is a judgement rather than a derivation and is worth saying plainly:
exact equality against arbitrary skeleton content would reject almost every
module, and the useful thing to forbid is blocking a passage or floating in
mid-air, not failing to mirror a wall.

**Regions and bands.** Participating cells are split into 6-connected components
and each is solved alone, so one failure does not spoil the rest. Within a
region the lowest coarse layer is the floor band, the highest the ceiling band,
the rest interior. Bands are per region and not per column, so every cell in a
layer offers the same faces sideways — a ragged room never asks a floor to meet
a ceiling edge on.

**Contradictions and sealed rooms** are both answered the same way: restart that
region with a fresh seed, capped at eight attempts, after which the least bad
answer is kept and reported. It never restarts the whole build and it never
hangs.

Connectivity has to be inside that loop rather than a report afterwards. A
partition runs floor to ceiling by construction, so a perfectly legal wave can
still cut a room in half and leave one side with no way out — it did, in 6 of 90
stress runs, before the check moved inside. What is measured is fragmentation of
the region's own air: before the fill it is one connected piece by construction,
so afterwards anything outside the largest remaining piece has been walled away.
Total air is deliberately not the measure; an earlier version scored that way
and, since filling the room with blocks lowers the air, it rewarded building
*more* wall. It made the problem worse and looked like a solver bug.

**The library is fittings, not architecture.** The skeleton already has floors,
walls and a roof. Two earlier drafts are worth recording because both failed
visibly in a cross section: a floor band that laid its own slab built a second
floor hanging above the real one; an interior band of single ornaments left
quartz blocks floating with nothing under them. The rule now is that a module
either stands on the ground, hangs from the roof, or spans between — so the
floor band holds the furniture, the ceiling band the lighting, and the interior
band almost nothing but columns passing through. A tall hall *should* be mostly
air at head height.

Three mechanisms give the solver real work rather than weighted dice:

* **Centre pieces** touch no side face, so they join anything an empty cell
  joins. Ornament is free.
* **Runs with end caps.** A bench spanning x = 0..2 leaves a bit on its -x and
  +x faces, so it can only continue into another bench; the end cap carries the
  bit on one side and nothing on the other. That pairing is what forces the
  solver to decide where runs stop.
* **Vertical families.** A pillar chains through as many cells as the room is
  tall and must finish in a cap or reach the roof. It cannot start without
  somewhere to end.

Density scales emptiness against everything else, so the same library furnishes
a room lightly or heavily without re-authoring it. Seed and density are both in
the UI; the same seed always gives the same fill.

**Partitions** are the first family that has to terminate in two directions at
once. Sideways a wall leaves the full column of its side face, so it can only
continue into another wall or an end cap. Vertically it leaves the full row of
its top and bottom faces, so it can only continue into another wall — which
means a partition always runs the whole height of the room, floor to roof. That
is what a partition is. The end cap carries the side profile on one side and
nothing on the other, and its own top and bottom rows are two thirds long, so
the end of a wall stays the end of that wall all the way up. Doorways and
hearths are floor-band variants of the same wall, with the opening cut out.

Weights on the vertical families are deliberately low. One choice of pillar in a
room eleven cells tall commits eleven cells, so a weight that looks modest
against an empty cell still turns the room into a thicket.

## Keys## Keys

`f` frame · `[` `]` move the work plane · `g` toggle the grid ·
drag orbits · middle-drag or shift-drag pans · wheel zooms · `Esc` cancels a
box.
