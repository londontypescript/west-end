# ADR 0011: Characters are data files, with our own SVG writer and Godot builder

Date: 2026-10-28. Status: proposed. Supersedes ADR 0001 and ADR 0005, and
parts of ADR 0006 and ADR 0010 (see the end).

## Context

ADR 0001 took SVG as the character input and converted it into Godot
primitives, and ADR 0005 used Chromium to resolve its styles, sandboxed
against hostile SVGs. That made a browser, a hostile-input container policy
and a general SVG parser part of the pipeline, for drawings that are ours.
The characters were never drawn in a vector tool: their SVGs were made from
reference photos, and only Rad Dad, the base for Nnsée (ADR 0009), carries
forward. None of them uses CSS.

A throwaway spike in the owner's lab repo, recorded in its README, tested
the alternative on Rad Dad in both looks (everyday and rad), against
reference renders of the original SVG from resvg, at 2× (ADR 0004). "Off"
below is the share of pixels where a colour channel differs by more than
32 of 255.

- Rad Dad as a typed TypeScript object literal: 31.7 KB against the SVG's
  26.0 KB, curves kept as curves, colours by name.
- An SVG writer from that data: no pixels off, in either look.
- Godot through a third-party addon (Scalable Vector Shapes 2D, MIT): 0.65%
  and 0.73% off, only after a Godot-specific SVG and workarounds for its SVG
  importer (gradients, overlapping contours, multi-shape clips, re-centred
  groups). The addon is about 13,000 lines, most of it editor tooling.
- Our own builder, about 380 lines of GDScript reading JSON: 0.27% and
  0.34% off at rest, 0.28% and 0.35% posed. The eyes, small shapes with
  jagged edges, are about 6% off in both Godot routes. It builds in about
  10 ms at load, with 548 nodes and a 247 KB scene; it draws the shirt's
  twill; clips stay correct on moving parts; and a fixture with real holes
  is 0.42% off.

The spike posed parts by setting Node2D transforms. It did not exercise
Skeleton2D, joint limits or IK (ADR 0002), and its code is evidence, not
what ships: review found gaps in its validation that the decision below
closes.

## Decision

- **A character is a typed data file:**
  `export default { ... } satisfies Character`. The CLI reads it with the
  TypeScript parser and never runs it. Only literals are accepted; any call, import of values, variable,
  spread or computed value is refused with its line.
- **The reader is the trust boundary.** A character file may come from
  someone else, so the reader treats it as hostile and checks the whole
  file at run time, not only its syntax: every field's type and numeric
  range (finite, within coordinate limits, dashes that make progress),
  references resolved transitively with cycles refused, and budgets on the
  file and on the expanded drawing (nodes, path commands, flattened
  vertices, texture sizes, output bytes). IDs match `[A-Za-z0-9_]`. Both
  outputs escape every string they write, and the SVG output never contains
  scripts, external references or raw markup.
- **Two formats, each versioned.** The character file is the authoring
  format; the JSON the builder reads is a separate, simpler wire format
  with its own version. The builder refuses a wire version it doesn't
  know, and the CLI and builder ship together (ADR 0007).
- **One description.** Named parts with pivots, joint limits and draw
  order; paths (absolute M/L/Q/C/A/Z), circles, ellipses and rects; fills
  and strokes by palette name; linear gradients; clips that never nest;
  opacity per child; variants and named looks; reusable symbols with
  mirroring; attachment slots. Contours in one path are unioned; holes are
  listed separately, must lie inside the path and must not overlap. Both
  outputs follow those rules, or the reader refuses the shape.
- **A capability table per output.** For every feature, each output either
  draws it, approximates it in a stated way, or refuses with an error. No
  output drops a feature silently. Glow, blur and pattern textures start
  as "approximate" in Godot.
- **Two outputs now, from our own code:**
  - _SVG,_ written directly, curves kept as curves: for print, the web and
    stills, and the reference the Godot output is checked against.
  - _Godot 2D,_ through a plain GDScript builder in our addon (ADR 0007)
    that builds Polygon2D and Line2D nodes once at load. Curves are
    flattened at a tolerance chosen for the largest output scale we
    support, and the builder can rebuild if a larger one is asked for.
    No third-party addon and no SVG between the two.
- **Rigging stays as ADR 0002 says.** Joint limits are carried into the
  wire format, and the builder's parts are what Skeleton2D drives. The
  0.1.0 work must show Skeleton2D and the limits on the builder's output,
  and the milestone that adds IK must show the fallback solver there; if
  either can't, that reopens ADR 0002.
- **Chromium leaves the project.** No SVG input means no CSS to resolve.
  resvg renders reference images for checks, with no browser. Character
  files never enter the container; only the reader's checked wire JSON
  does, and it runs under ADR 0010's render/check policy, which gains a
  bound on output size.
- **What we didn't take:**
  - SVG input with a sandboxed browser (ADRs 0001 and 0005).
  - The third-party addon: its SVG importer caused every failure in the
    spike, and most of its bulk we'd carry without using. Its MIT code
    stays a reference for hole cutting and gradient mapping, credited
    where we follow it.
  - A node that re-flattens curves whenever its on-screen scale changes.
  - JSON or YAML with a JSON Schema: simpler to parse, but without
    comments, the TypeScript type checking in the editor, or one type the
    reader and editor share. The owner chose the TypeScript literal.
- **Deferred, not ruled out:** a 2.5D output in a later milestone (its
  renderer reopens ADR 0003 if it needs more than GL Compatibility); parts
  shared between characters by reference, in local coordinates, as a later
  format version; SVG import, as its own milestone with its own defences;
  text in characters.
- **0.1.0 is revised before any of this is built,** through its own plan
  pull request.

## What would end it

- A character must be drawn in a vector tool by someone who won't edit
  data files, which brings back SVG import. The owner decides.
- The Godot render of the fixtures can't be kept within the thresholds set
  in the render check (whole frame and per part, every look and pose)
  without the builder growing into a general vector renderer.
- The 2.5D output needs a description the 2D one can't share.

## Changes to earlier ADRs

- **ADR 0001** and **ADR 0005:** status "superseded by ADR 0011".
- **ADR 0006:** status "partly superseded by ADR 0011": the CLI stays
  TypeScript, but it reads character files and writes SVG and JSON,
  rather than converting SVGs.
- **ADR 0010:** status "partly superseded by ADR 0011": the image no longer
  carries Chromium, the _convert_ run policy goes, and the render/check
  policy gains an output size bound. Its title and context still name
  Chromium, as the record of what was decided then.
