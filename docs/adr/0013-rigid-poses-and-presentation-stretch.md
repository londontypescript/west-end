# ADR 0013: Rigid poses and presentation stretch

Date: 2026-11-14. Status: proposed. Amends ADR 0012.

## Context

0.1.0 needs to drive one Godot joint within its limits. ADR 0012 fixes part identity across looks and defines how mirrored instances resolve their limits, but leaves the pose input unspecified. It also forbids non-uniform scale over a moving part. Rad Dad’s head needs a 16% horizontal stretch after jaw movement. Applying the stretch to rest coordinates alone changes the motion.

## Decision

- A complete rigid pose is a bounded mapping from existing part paths to finite clockwise angles in degrees relative to resolved rest. Measure the angle in the rig’s articulation frame before any presentation transform. Omitted joints use rest. Reject unknown paths, duplicates and angles outside resolved limits. An input can specify any joint at most once, so the resolved part-count budget bounds the mapping.
- Keep the existing mirror rule. Mirroring a template resolves its geometry and limits once. A pose targets the resolved instance. Drawing the entire scene under a reflection does not re-sign the pose.
- Use the same pose specification and independent expected joint frames for SVG and Godot. Keep native Skeleton2D posing and rigid binding in 0.1.0. Looks retain the same rig. A clip remains in its owner’s frame and may clip moving descendants. Pose input leaves layer order fixed.
- Preserve ADR 0012’s existing restrictions on authored scale for 0.1.0. For Rad Dad in 0.2.0, design an explicit nested presentation boundary with the contract that local articulation happens before the stretch. Keep the authored field and the exact backend mapping open until a Rad Dad conformance fixture verifies representative poses. Direct Bone2D scaling is the leading Godot implementation candidate for rigid forward posing.

## Evidence and scope

On pinned Godot 4.7.2, direct head bone scaling preserved all three registered bones and matched expected jaw geometry to within 0.000008 px at three angles. An intervening Node2D preserved the draw positions but disconnected the jaw from the native chain. The separate synthetic render matched the SVG silhouette within one pixel at the edges. These experiments did not exercise native IK, skin weights, or real Rad Dad artwork.

This proposal narrows the earlier format design. It retains paths as published binding identities and reserves signatures for separately packaged poses or clips. It defines a common contract across the TypeScript and GDScript implementations.

## What would end it

Replace or extend this contract when representative Rad Dad poses validate the nested presentation model, when external clips require compatibility metadata, or when cross-boundary IK and skinning provide evidence for broader articulation semantics.
