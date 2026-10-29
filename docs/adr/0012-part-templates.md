# ADR 0012: Part templates, part paths and mirrored rigs

Date: 2026-10-29. Status: accepted. Amends ADR 0011.

## Context

ADR 0011 made characters typed data files: a literal tree of named parts,
plus `outlines` (named path commands) and `symbols` (named drawings placed
with `use`, which may hold no parts, slots or variants). Part names are
unique across the whole character, and so are slot names and variant
names, each in its own namespace. That rule is the phase E reader's own;
no ADR set it. Nothing yet says in what order a transform's parts apply,
or how a flip treats a joint.

Two needs came up while the format is still unreleased:

- **Reuse of rigged parts.** Two hands that differ only in position and a
  left-right flip, each with movable fingers. A symbol can share the
  drawing but not the fingers' rig; copying the hand keeps the rig but lets
  the two copies drift apart.
- **Readable rig trees for hand-authors.** London TypeScript members
  writing characters by hand, and live talks, need the skeleton to read at
  a glance, with big parts defined elsewhere.

Options weighed, with ChatGPT Sol 6.1 reviewing them unranked:

- **No change:** a symbol for the drawing, a named wrapper part per copy.
  Fine for rigid hands; can't share articulated ones.
- **Top-level `const` declarations** for any value. Good extraction, and
  the names are TypeScript identifiers the editor can follow. Alone, a
  part const can't be placed twice (duplicate names); with path addressing
  and a placement field it works, but it reverses ADR 0011's ban on
  variables, and errors must then be traced through declarations.
- **`extends` on a part,** like Godot's inherited scenes. Blurs definition
  and copy: editing the left hand changes the right. Nested parts still
  need a naming rule.
- **Object spread** (`{ ...hand, part: 'handR' }`). Key order changes the
  result, `children` is replaced wholesale, and nested names still clash.
- **Part templates,** proposed by Sol's review: a table of rigged parts,
  each copy named where it's placed.

Other formats split the same way. Rig formats (Spine, DragonBones) share
drawings, never bones. Scene and animation formats (Lottie precomps, Rive
nested artboards, Godot scene instancing) place a self-contained thing many
times and reach its insides through the copy. None we know of flips joint
limits for you.

## Decision

### Templates

- **A new top-level `templates` table** holds rigged parts without names:
  pivot, limits, layer, paint, clip and children. Children may be anything
  a part's may: shapes, groups, named parts, variants, slots, symbol
  placements and template placements.

  ```ts
  templates: {
    hand: {
      pivot: [0, 0],
      limits: [-20, 60],
      children: [{ part: 'finger', pivot: [8, 0], limits: [0, 90], children: [/* … */] }],
    },
  },
  parts: [
    { part: 'handL', template: 'hand', at: [140, 300] },
    { part: 'handR', template: 'hand', at: [260, 300], mirror: true },
  ],
  ```

- **A placement** names the copy (`part`), names the template, and may set
  `at`, `mirror`, `transform`, `opacity`, `layer`, `limits` and paint
  defaults (`fill`, `stroke`, `width`, `texture`, `cap`, `join`, `dash`).
  Nothing else; never `children` or `pivot`. A different structure is a
  different template.
- **Overrides replace the template's root fields in the template's own
  terms, before placement and mirroring.** `mirror: true, limits: [0, 30]`
  means the copy bends as `[0, 30]` would bend the unmirrored template.
  An omitted field keeps the template's value; there is no syntax to
  delete one. A child with its own paint or layer keeps it, as inheritance
  already works; finish fields (`opacity`, `glow`, `blur`) are never
  inherited.
- **Copies share nothing at run time.** The template's artwork (outlines,
  gradients, symbols) is read-only and shared; each copy's rig is its own,
  so posing `handL.finger` never moves `handR.finger`, and mirroring the
  right hand never changes data the left hand uses.
- **A template used once** is how a big part leaves the rig tree.

### Coordinates and transforms

- **A transform applies in the parent's frame:** scale, then rotate, both
  about `origin`, then translate. As SVG writes it:
  `translate(t) translate(o) rotate(r) scale(s) translate(−o)`. Defaults:
  no translation, rotation 0, scale 1, origin `[0, 0]`. This holds for
  every node that takes a transform.
- **Symbols and templates are drawn about their own origin.** A placement
  maps a point `p` of the definition into the parent's frame by: mirror
  (`x → −x`) about the origin, then translate by `at`, then the
  placement's `transform`, in the parent's frame. So `origin` on a
  placement is in the parent's coordinates, as the flower fixture already
  writes it, and existing symbol placements keep their meaning:

  ```ts
  { use: 'pair', at: [200, 200], transform: { rotate: 180, origin: [200, 200] } }
  ```

- **Inside a template, everything is in the template's frame,** through
  any depth of groups and nested placements. A part's pivot is a point in
  that frame; it does not start a new coordinate origin.
- **Rig-bearing transforms are similarities.** On a part, a template
  placement, or a group or symbol placement that contains a part, `scale`
  must be one positive number, and the only flip is `mirror` on a
  placement. Non-uniform and negative scales stay allowed on artwork that
  holds no parts. Scale and rotation don't commute, so a stretched
  ancestor can't be turned into ordinary rotating joints; artwork has no
  joints, so it can be stretched freely.

### Mirroring

- **Geometry is mapped by the composed transform,** mirror included, so
  rotations inside mirrored content need no special rule. Mapping keeps
  what each shape means: a flipped arc negates its axis rotation and
  swaps its sweep; holes and contours keep their relationship (winding
  corrected where coordinates are baked); a gradient's direction flips
  with its shape. Drawing-wide hatches stay anchored to the drawing, not
  baked into a part; how they behave when a part moves is ADR 0011's
  capability table's business.
- **Angles are clockwise on screen, everywhere a person or tool reads
  them** (ADR 0011's convention). A part rests at angle 0 in its authored
  pose; `limits` are relative to that rest. For a part under an odd number
  of mirrors, the reader converts its limits once to `[−max, −min]` and
  bakes the mirrored rest geometry. The wire format carries those resolved
  limits and no reflected frames, so the builder's bones are ordinary
  Skeleton2D bones and nothing is negated again at run time. Poses, IK and
  animation are always written in on-screen angles.
- **Layers and authored child order stay as written:** a flip never
  reverses depth. Two mirrors cancel.

### Addresses

- **A part's address is the dotted list of its named-part ancestors and
  itself:** `handL.finger`. Groups, symbol placements and template
  placements add no segment of their own; a template placement contributes
  the copy's name as its root part.
- **A part's name is unique among the parts sharing its nearest named
  parent,** counted through groups. Slots and variants are addressed the
  same way, each in its own namespace (`handL.grip`, `handL.gesture`), and
  `looks` select variants by path.
- **The rig sits outside variants.** A variant option may hold artwork,
  symbol placements and groups of them, but no parts, slots or template
  placements. So every look has the same rig, and an address never
  depends on which option is shown.
- **Segments keep `[A-Za-z0-9_]`,** and a whole path has a length bound the
  phase E brief sets. Paths are read by their own parser, not the name
  check, which refuses dots. No output ever generates a suffix for an
  author to guess.
- **Output ids come from the character id, the kind (part, slot, variant)
  and the path's segments,** encoded so no two can collide (a part and a
  slot may both be `hand.grip`), with generated resources (clip, gradient
  and drawing nodes) in a separate namespace. The Godot builder maps each
  part address to its bone explicitly.

### Bounds and errors

- **Expansion is bounded before it happens.** Templates are summarised
  like symbols: nodes, shapes, commands, parts, clips and depth, counted
  with every placement's multiplicity and every variant option, before any
  copy is built. A template placement counts as one node, and its root as
  one part.
- **A new resolved-depth budget** bounds the depth of the built tree
  through groups, parts, variants, symbol placements and template
  placements together, enforced before expansion or path building. The
  existing source-nesting and symbol-depth budgets stay; neither bounds
  this. The phase E brief sets the number.
- **References resolve transitively with cycles refused,** templates as
  symbols are. A template holding a clip, placed inside a clip, is refused
  at that placement.
- **Every template is checked, used or not:** structure, references and
  cycles.
- **Errors name both places.** A fault inside a template is reported at
  the template, with a bounded trace of the placements that reached it
  (none if it's unused). A fault caused by a placement (a budget crossed,
  a nested clip, a clashing name, a non-similarity scale over a part) is
  reported at the placement, with the template. The order of errors is
  deterministic.

### Format and editor

- **Editor types come from `Character`.** `templates` is a field of the
  exported literal, so it is typed in context like everything else; no new
  imports. The editor can't check that a template name exists, as it
  can't for symbols today; the reader checks every reference.
- **Format 1 is revised in place.** Nothing has been released, so there is
  no format 2; the wire format's first version carries paths, resolved
  geometry and resolved limits.
- **Kept:** `outlines` for shared geometry (a shape and its matching clip),
  `symbols` for unrigged drawings. Each of the three tables has its own
  job: geometry, drawing, rig.
- **What we didn't take:** general `const` declarations, deferred (see
  below); `extends`; object spread; letting symbols hold parts, which would
  leave copies unnamed; generated suffixes; parts inside variants.

### Acceptance

- **Phase E's reader gains all of the above.** Its fixtures add two
  articulated hands, one mirrored, with fingers, asymmetric limits, a
  slot, a gradient, a clip, a hole and an asymmetric rotated arc, sharing
  outlines and gradients, placed beside a variant of artwork; plus
  negative and non-uniform scales on artwork, nested mirrors, and hostile
  files for template fan-out, long template chains, deep resolved nesting,
  cycles, clashing paths, parts inside variants and stretched rigs.
- **The 0.1.0 work that shows Skeleton2D** (ADR 0011) must pose the two
  hands independently and show the mirrored hand's joints moving the right
  way within its limits, not only a matching rest image. If they can't,
  that reopens the mirror rule.

## What would end it

- Real hand-written characters show that string names and the three
  tables aren't enough, for example authors needing to extract paint sets
  or arrays, or wanting the editor to follow a template's name. That
  brings back literal `const` declarations, on top of templates.
- Skeleton2D or IK can't drive mirrored joints correctly under this rule.
- A character needs a different rig under different looks, or a stretched
  part that still moves, both of which this forbids.
- Parts shared between characters (deferred in ADR 0011) arrive:
  templates are the natural thing to share, and that ADR decides how.

## Changes to earlier ADRs

- **ADR 0011:** status "accepted, amended by ADR 0012". Its "One
  description" gains part templates, part paths, the transform order and
  the mirror rule, and parts leave variants; its ban on variables and
  spread stands.
