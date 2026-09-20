#!/usr/bin/env python3
"""Regenerate engine/spacegroups.js from spglib's space group database.

Authoring-time only. Hypostyle itself has no dependencies; this script exists so
the 163 groups in engine/spacegroups.js are traceable to a source rather than
transcribed by hand.

    pip install spglib
    python3 tools/gen-spacegroups.py

Selection: space groups 16-74 (orthorhombic), 75-142 (tetragonal), 195-230
(cubic) - 59 + 68 + 36 = 163. Those are exactly the groups whose operations are
signed permutation matrices with translations on quarters of a cell edge, i.e.
the ones that map a cubic block lattice onto itself.

Setting: origin choice 2 where a group has two origins (the ITA default), else
the standard axis setting. The chosen setting's Hall symbol is recorded in the
output so the convention is auditable.
"""

import itertools
import json
import os
import sys
from collections import defaultdict
from fractions import Fraction

try:
    import spglib
except ImportError:  # pragma: no cover - authoring script
    sys.exit("spglib not installed: pip install spglib")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, os.pardir, "engine", "spacegroups.js")


def system(n):
    if 16 <= n <= 74:
        return "o"
    if 75 <= n <= 142:
        return "t"
    if 195 <= n <= 230:
        return "c"
    return None


def canonical_rotations():
    """The 48 signed permutation matrices, in a fixed deterministic order."""
    rots = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product((1, -1), repeat=3):
            m = [[0] * 3 for _ in range(3)]
            for i in range(3):
                m[i][perm[i]] = signs[i]
            rots.append(sum(m, []))
    assert len(rots) == 48 and len(set(map(tuple, rots))) == 48
    return rots


def collect():
    by = defaultdict(list)
    for hall in range(1, 531):
        t = spglib.get_spacegroup_type(hall)
        by[t["number"]].append((hall, t["international_short"], t["choice"], t["hall_symbol"]))

    rots = canonical_rotations()
    index = {tuple(r): i for i, r in enumerate(rots)}
    out = []
    for number in range(1, 231):
        sys_code = system(number)
        if not sys_code:
            continue
        settings = by[number]
        chosen = None
        for want in ("2", "", "1"):
            for entry in settings:
                if entry[2] == want:
                    chosen = entry
                    break
            if chosen:
                break
        hall, hm, choice, hall_symbol = chosen or settings[0]

        data = spglib.get_symmetry_from_database(hall)
        codes = []
        for r, t in zip(data["rotations"], data["translations"]):
            mat = tuple(int(round(x)) for row in r for x in row)
            if mat not in index:
                sys.exit(f"group {number}: rotation is not a signed permutation: {mat}")
            twelfths = []
            for x in t:
                f = Fraction(float(x)).limit_denominator(24) * 12
                if f.denominator != 1:
                    sys.exit(f"group {number}: translation {x} is not a multiple of 1/12")
                twelfths.append(int(f) % 12)
            codes.append(index[mat] * 1728 + twelfths[0] * 144 + twelfths[1] * 12 + twelfths[2])
        codes = sorted(set(codes))
        if len(codes) != len(data["rotations"]):
            sys.exit(f"group {number}: duplicate operations after packing")
        out.append((number, hm, choice, hall_symbol, sys_code, codes))
    return rots, out


HEADER = """// engine/spacegroups.js
// GENERATED FILE - do not hand-edit. Source: tools/gen-spacegroups.py (spglib).
//
// The 163 space groups whose operations map exactly onto a cubic block lattice:
// orthorhombic 16-74 (59), tetragonal 75-142 (68), cubic 195-230 (36).
// Triclinic, monoclinic, trigonal and hexagonal are excluded by construction -
// oblique cells, or 3- and 6-fold rotations with no integer matrix on the grid.
//
// Every rotation below is a signed permutation matrix (det +/-1), so it carries
// block centres to block centres. Every translation is a multiple of a quarter
// cell edge; translations are stored in twelfths, so a cell edge that is a
// multiple of 12 puts every glide plane and screw axis on a block boundary
// rather than through the middle of a block.
//
// Encoding: one integer per operation,
//     code = rotIndex * 1728 + tx * 144 + ty * 12 + tz
// where rotIndex indexes ROTS and tx,ty,tz are twelfths of a cell edge.
// Group record: [number, hermannMauguin, setting, hallSymbol, system, ops].
"""

TAIL = r"""
export const SYSTEM_NAMES = Object.freeze({ o: 'orthorhombic', t: 'tetragonal', c: 'cubic' });

/** One space group, decoded lazily from the packed op codes. */
export class SpaceGroup {
  constructor(number, hm, choice, hall, system, ops) {
    this.number = number;
    this.hm = hm;
    this.choice = choice;
    this.hall = hall;
    this.system = system;
    this.ops = Int32Array.from(ops);
    this.order = ops.length;
    Object.freeze(this);
  }

  /** Row-major 3x3 integer rotation of operation i. */
  rot(i) { return ROTS[(this.ops[i] / 1728) | 0]; }

  /** [tx,ty,tz] translation of operation i, in twelfths of a cell edge. */
  trans(i) {
    const t = this.ops[i] % 1728;
    return [(t / 144) | 0, ((t / 12) | 0) % 12, t % 12];
  }

  /**
   * Which cell edges the rotations force to be equal.
   * An operation that sends axis col onto axis row ties those two edges
   * together. Returns [gx,gy,gz]; axes sharing a value must share a length.
   * Cubic groups return [0,0,0], tetragonal [0,0,2], orthorhombic [0,1,2].
   */
  edgeGroups() {
    const p = [0, 1, 2];
    for (let i = 0; i < this.order; i++) {
      const r = this.rot(i);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          if (r[row * 3 + col] !== 0 && row !== col) {
            const a = p[row], b = p[col];
            if (a !== b) for (let k = 0; k < 3; k++) if (p[k] === b) p[k] = a;
          }
        }
      }
    }
    return p;
  }

  /** Display label, e.g. "#225 Fm-3m". */
  get label() {
    return `#${this.number} ${this.hm}${this.choice ? ' (' + this.choice + ')' : ''}`;
  }
}

export const GROUPS = Object.freeze(RAW.map((r) => new SpaceGroup(r[0], r[1], r[2], r[3], r[4], r[5])));

const BY_NUMBER = new Map(GROUPS.map((g) => [g.number, g]));
const BY_HM = new Map(GROUPS.map((g) => [g.hm.replace(/\s+/g, ''), g]));

export function groupByNumber(n) { return BY_NUMBER.get(n | 0) || null; }
export function groupByHM(s) { return BY_HM.get(String(s).replace(/\s+/g, '')) || null; }
export function groupsBySystem(sys) { return GROUPS.filter((g) => g.system === sys); }
"""


def main():
    rots, groups = collect()
    counts = defaultdict(int)
    for g in groups:
        counts[g[4]] += 1
    if dict(counts) != {"o": 59, "t": 68, "c": 36}:
        sys.exit(f"unexpected group counts: {dict(counts)}")

    lines = [HEADER, "/** The 48 signed permutation matrices, row-major 3x3. */", "export const ROTS = Object.freeze(["]
    for i in range(0, 48, 4):
        lines.append("  " + " ".join(
            "[%s]," % ",".join("%2d" % x for x in rots[j]) for j in range(i, min(i + 4, 48))))
    lines.append("]);")
    lines.append("")
    lines.append("export const TWELFTHS = 12;")
    lines.append("")
    lines.append("const RAW = [")
    for number, hm, choice, hall, sys_code, codes in groups:
        lines.append('  [%d,"%s","%s","%s","%s",[%s]],'
                     % (number, hm, choice, hall, sys_code, ",".join(map(str, codes))))
    lines.append("];")
    lines.append(TAIL)

    with open(OUT, "w") as fh:
        fh.write("\n".join(lines))
    total = sum(len(g[5]) for g in groups)
    print(f"wrote {OUT}: {len(groups)} groups, {total} operations")
    print(json.dumps(dict(counts), sort_keys=True))


if __name__ == "__main__":
    main()
