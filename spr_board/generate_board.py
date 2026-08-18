"""
SP Robotic Works grid baseplate — parametric FreeCAD generator.

Recreates the perforated lattice baseplate:
  - 16 x 20 grid of ringed through-holes
  - octagon-and-square weave (full orthogonal grid + checkerboard diagonals)
  - central large hole with support struts
  - perimeter rings tied into a raised border frame
  - recessed mid-plane web filling the gaps
  - every hole is a real through-hole (struts are retracted so they never plug a bore)

Usage:
  * Inside FreeCAD:  open the Python console and `exec(open(".../generate_board.py").read())`
  * Headless:        `freecadcmd generate_board.py`
Exports SPR_Board.stl and SPR_Board.step next to this script.
"""

import os
import math
import FreeCAD as App
import Part

try:
    import MeshPart
    HAVE_MESHPART = True
except Exception:
    HAVE_MESHPART = False

# ---------------- parameters (mm) ----------------
NX, NY   = 16, 20        # ring nodes across / down (4:5 aspect)
P        = 12.0          # grid pitch (hole centre spacing)
H        = 6.0           # full lattice / ring / frame height
tb       = 2.0           # recessed gap-fill web thickness
r_o, r_i = 4.2, 2.6      # ring outer / bore radius   (hole dia = 5.2)
wo, wd   = 2.6, 2.0      # orthogonal / diagonal strut width
margin   = 8.0           # gap between grid and frame inner edge
gw       = 6.0           # frame wall width
R_o, R_i = 11.0, 6.5     # central big ring outer / bore radius (hole dia = 13)
ret      = 3.3           # strut retract from node centre (> r_i, < r_o) keeps bores clear

GX, GY = (NX - 1) * P, (NY - 1) * P
cx, cy = GX / 2.0, GY / 2.0        # board centre (a cell centre for even grid)
clear  = 13.0                       # radius around centre cleared of small nodes
zf     = (H - tb) / 2.0             # recessed web z start (centred in thickness)


def node_ok(i, j):
    """True if a small ring node exists (outside the cleared central zone)."""
    return math.hypot(i * P - cx, j * P - cy) > clear


def ring(x, y, ro, ri):
    outer = Part.makeCylinder(ro, H, App.Vector(x, y, 0))
    bore  = Part.makeCylinder(ri, H + 2, App.Vector(x, y, -1))
    return outer.cut(bore)


def bar(x1, y1, x2, y2, w, retA=ret, retB=ret):
    """A rectangular strut from (x1,y1) to (x2,y2), retracted at each end so it
    butts against ring walls without covering the bore."""
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    ax, ay = x1 + ux * retA, y1 + uy * retA
    bx, by = x2 - ux * retB, y2 - uy * retB
    LL = math.hypot(bx - ax, by - ay)
    b = Part.makeBox(LL, w, H, App.Vector(0, -w / 2, 0))
    b.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), math.degrees(math.atan2(dy, dx)))
    b.translate(App.Vector(ax, ay, 0))
    return b


def build():
    solids, kept = [], []

    # rings
    for i in range(NX):
        for j in range(NY):
            if node_ok(i, j):
                solids.append(ring(i * P, j * P, r_o, r_i))
                kept.append((i, j))
    solids.append(ring(cx, cy, R_o, R_i))

    # full orthogonal grid
    for i in range(NX):
        for j in range(NY):
            x, y = i * P, j * P
            if node_ok(i, j) and i < NX - 1 and node_ok(i + 1, j):
                solids.append(bar(x, y, x + P, y, wo))
            if node_ok(i, j) and j < NY - 1 and node_ok(i, j + 1):
                solids.append(bar(x, y, x, y + P, wo))

    # checkerboard diagonals -> octagon / square weave
    for i in range(NX - 1):
        for j in range(NY - 1):
            if (i + j) % 2 == 0:
                if node_ok(i, j) and node_ok(i + 1, j + 1):
                    solids.append(bar(i * P, j * P, (i + 1) * P, (j + 1) * P, wd))
                if node_ok(i + 1, j) and node_ok(i, j + 1):
                    solids.append(bar((i + 1) * P, j * P, i * P, (j + 1) * P, wd))

    # central big ring -> 4 nearest surrounding rings
    for (i, j) in sorted(kept, key=lambda ij: math.hypot(ij[0] * P - cx, ij[1] * P - cy))[:4]:
        solids.append(bar(cx, cy, i * P, j * P, wo, retA=R_o - 0.5, retB=r_o - 0.5))

    # perimeter rings -> border frame
    xl, xr = -margin, GX + margin
    yb, yt = -margin, GY + margin
    for j in range(NY):
        if node_ok(0, j):      solids.append(bar(0,  j * P, xl, j * P, wo, retA=r_o, retB=-1.0))
        if node_ok(NX - 1, j): solids.append(bar(GX, j * P, xr, j * P, wo, retA=r_o, retB=-1.0))
    for i in range(NX):
        if node_ok(i, 0):      solids.append(bar(i * P, 0,  i * P, yb, wo, retA=r_o, retB=-1.0))
        if node_ok(i, NY - 1): solids.append(bar(i * P, GY, i * P, yt, wo, retA=r_o, retB=-1.0))

    # raised border frame
    outer = Part.makeBox(GX + 2 * margin + 2 * gw, GY + 2 * margin + 2 * gw, H,
                         App.Vector(-margin - gw, -margin - gw, 0))
    inner = Part.makeBox(GX + 2 * margin, GY + 2 * margin, H + 2,
                         App.Vector(-margin, -margin, -1))
    solids.append(outer.cut(inner))

    # recessed gap-fill web, perforated by all holes
    floor = Part.makeBox(GX + 2 * margin + 2 * gw, GY + 2 * margin + 2 * gw, tb,
                         App.Vector(-margin - gw, -margin - gw, zf))
    cut = [Part.makeCylinder(r_i, tb + 2, App.Vector(i * P, j * P, zf - 1)) for (i, j) in kept]
    cut.append(Part.makeCylinder(R_i, tb + 2, App.Vector(cx, cy, zf - 1)))
    solids.append(floor.cut(Part.makeCompound(cut)))

    return Part.makeCompound(solids), kept


def main():
    doc = App.newDocument("SPR_Board")
    board, kept = build()
    obj = doc.addObject("Part::Feature", "Board")
    obj.Shape = board
    doc.recompute()

    here = os.path.dirname(os.path.abspath(__file__))
    stl  = os.path.join(here, "SPR_Board.stl")
    step = os.path.join(here, "SPR_Board.step")

    if HAVE_MESHPART:
        mesh = MeshPart.meshFromShape(Shape=board, LinearDeflection=0.4,
                                      AngularDeflection=0.8, Relative=False)
        mesh.write(stl)
    else:
        board.exportStl(stl)  # fallback (coarser control)
    board.exportStep(step)

    print("Board size: %.0f x %.0f x %.0f mm | holes: %d | STEP+STL written to %s"
          % (board.BoundBox.XLength, board.BoundBox.YLength, board.BoundBox.ZLength,
             len(kept) + 1, here))
    return doc


if __name__ == "__main__":
    main()
