---
name: digital-twin-cad
description: >-
  Create, convert, validate, and publish CAD assets for digital twins,
  industrial twins, robot twins, and equipment visualization. Use when a task
  involves STEP/GLB assets, image-to-3D runtime proxies, CAD-to-twin node
  mapping, URDF/SDF, telemetry-driven model state, or a twin manifest. Do not
  use for standalone CAD modeling that has no digital-twin integration.
---

# Digital Twin CAD

## Purpose

Coordinate the complete design-time path from a CAD or reference-image request
to a versioned digital-twin asset. Reuse the installed `$cad`, `$cad-viewer`,
`$urdf`, `$sdf`, and `$img2threejs` skills when available; this skill owns the
integration contract and acceptance checks, not the underlying CAD, image
reconstruction, or simulator implementation.

## Trigger boundary

Use this skill when the request combines a twin context with one or more of:

- creating or changing a CAD/STEP/GLB asset;
- turning one or more reference images into a procedural Three.js model or a
  generative mesh proxy for a twin runtime;
- mapping CAD parts or GLB nodes to equipment, device, or component IDs;
- generating robot descriptions or simulator assets;
- producing a twin manifest or asset version;
- binding geometry or joints to telemetry, commands, alarms, or live state.

Do not apply it to ordinary frontend work, standalone CAD, or a viewer-only
review unless the user also asks for twin integration.

## Project configuration

At the start, read the nearest `AGENTS.md` and look for an optional
`twin.config.yaml` at the project root. Global defaults apply when the file is
absent; project configuration overrides only the fields it declares.

Supported configuration keys include:

```yaml
schemaVersion: 1
sourceFormat: step
runtimeFormat: glb
designUnits: mm
runtimeUnits: m
coordinateSystem: z_up
manifestPath: twin.manifest.json
stateTransport: mqtt
```

For an image-only route, set `sourceFormat: image-procedural` or
`sourceFormat: image-proxy` explicitly in the project configuration. These
routes produce a visualization asset, not a dimensionally authoritative CAD
part.

Treat `stateTransport` as a project integration choice. Do not invent broker
URLs, credentials, device addresses, or topic names.

## Required output contract

For a generated asset, keep the parametric CAD source as the source of truth
and produce only the artifacts the target system needs:

- source generator, normally `<name>.step.py` with `gen_step()`;
- validated STEP as the engineering artifact;
- GLB or another runtime mesh as a derived visualization artifact;
- `twin.manifest.json` containing asset identity, version, units, coordinate
  system, artifact paths, stable node IDs, and device/component bindings;
- URDF/SRDF/SDF only when the target is a robot or simulator.

For an image-only asset, the source-of-truth contract must be recorded in the
manifest:

- `image-procedural`: the reference image, `ObjectSculptSpec`, and generated
  TypeScript `THREE.Group` factory are the source artifacts; export GLB only
  after browser rendering and review.
- `image-proxy`: a generated GLB/OBJ is a visual or measurement aid only. It
  cannot establish manufacturing dimensions, hidden geometry, tolerances,
  collision safety, inertials, or device semantics.

If the target needs engineering truth, use the image route to establish visual
requirements, then rebuild and validate a STEP-first model with `$cad`. Do not
silently promote an image-derived proxy to the engineering artifact.

Do not regenerate STEP for every telemetry update. Runtime state should update
node transforms, joint values, materials, or properties; regenerate geometry
only for an intentional model-version change.

## Workflow

1. **Establish scope.** Identify the twin system, target runtime, consumers,
   coordinate system, units, required artifacts, and whether the change is a
   geometry version or a runtime-state change.
2. **Resolve configuration.** Apply the nearest project `AGENTS.md`, then
   `twin.config.yaml`, then these defaults. Record unresolved assumptions.
3. **Build the CAD source.** Use `$cad` for natural-language CAD generation,
   STEP-first modeling, assemblies, parameterization, and exports. If `$cad`
   is unavailable, use the repository's documented `cadgen` commands or
   report the missing dependency before claiming generation.
4. **Use the image adapter when appropriate.** For a reference-image request,
   use `$img2threejs` for a procedural Three.js route when it is available.
   Keep the generated `ObjectSculptSpec`, factory source, render evidence,
   input-image hash, adapter commit, and confidence/unknown-region report.
   Multi-view input is preferred; a single image must mark hidden geometry as
   inferred. A hosted image-to-mesh service may be used only as an explicitly
   approved `image-proxy` route and its output must be inspected before use.
5. **Prepare runtime assets.** Export GLB from the validated CAD source or
   reviewed Three.js factory. Keep the engineering STEP and runtime mesh
   versioned together when STEP exists; image-only assets must state that no
   STEP source exists.
6. **Define stable mappings.** Map every runtime-relevant part or joint to a
   stable `nodeId` and, where applicable, a `deviceId` or `componentId`.
   Display names alone are not stable identifiers.
7. **Add robot or simulator semantics.** Use `$urdf`, `$srdf`, or `$sdf` when
   the target requires links, joints, inertials, planning groups, physics,
   sensors, or worlds. Validate against the target simulator when available.
8. **Validate before handoff.** Check geometry validity, bounding box, units,
   coordinate conversion, node coverage, mesh references, joint limits,
   inertials, and manifest-to-artifact consistency. A build pass alone is not
   acceptance evidence.
9. **Publish or integrate.** Hand explicit files to `$cad-viewer` for local
   review when available. For a production system, upload through the
   project's asset service rather than exposing the local Viewer.

## Twin manifest minimum

Use a machine-readable manifest with at least:

```json
{
  "schemaVersion": 1,
  "assetId": "example-001",
  "version": "v1",
  "source": {"kind": "cad", "generator": "example.step.py", "commit": "source-commit-hash"},
  "units": {"design": "mm", "runtime": "m"},
  "coordinateSystem": "z_up",
  "artifacts": {"step": "example.step", "glb": "example.glb"},
  "nodes": [
    {"nodeId": "motor", "deviceId": "MOTOR-001", "glbNode": "Motor"}
  ]
}
```

Add telemetry bindings, joint definitions, collision assets, or simulator
references only when the target contract requires them. Never store secrets in
the manifest.

For `image-procedural`, use `source.kind: image-procedural` and include the
reference-image hash, adapter repository/commit, `ObjectSculptSpec`, factory
path, review evidence, and per-region confidence. For `image-proxy`, use
`source.kind: image-proxy` and include the generator/service, input-view count,
compression status, bounds, and a prominent `engineeringAuthoritative: false`.

## Safety and runtime boundaries

- Treat LLM-generated CAD Python as untrusted code in multi-user or server
  workflows. Execute it in an isolated worker with resource limits and a
  pinned dependency set.
- Treat image-derived geometry as untrusted visual evidence. Do not use it for
  manufacturing, safety-critical collision, load, or inertial decisions without
  independent engineering measurements and validation.
- The `img2threejs` repository is Apache-2.0, but an optional hosted
  image-to-mesh adapter and its model/checkpoint can have separate terms and
  data handling. Record the service/model/version and obtain approval before
  uploading proprietary or personal images; prefer a local or approved
  deployment for sensitive assets.
- Keep the local CAD Viewer on loopback for review. It is not an authenticated
  production asset service.
- Preserve source provenance: prompt or requirements hash, generator version,
  dependency version, validation result, and artifact hashes belong in the
  asset registry or manifest metadata.
- Report skipped runtime, simulator, hardware, credential, or deployment
  checks explicitly; do not replace them with static validation claims.
