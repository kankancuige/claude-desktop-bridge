---
name: digital-twin-cad
description: Create, convert, validate, and publish CAD assets for digital twins, industrial twins, robot twins, equipment visualization, telemetry bindings, and twin manifests. Do not use for standalone CAD or viewer-only work without twin integration.
---

# Digital Twin CAD

## Purpose

Coordinate the design-time path from CAD source to a versioned digital-twin asset and its runtime bindings. Use existing CAD, Viewer, URDF, SRDF, or SDF tooling when available; this Skill owns the integration contract and acceptance checks rather than reimplementing those tools.

## Trigger Boundary

Use this Skill only when the request combines a twin context with one or more of:

- creating or changing a CAD, STEP, GLB, or glTF asset;
- mapping CAD parts or runtime nodes to equipment, device, or component IDs;
- generating URDF, SRDF, SDF, robot, or simulator assets;
- producing a twin manifest or versioned asset;
- binding geometry, joints, materials, alarms, commands, or properties to telemetry and live state.

Do not apply it to ordinary frontend work, standalone CAD, or viewer-only preview unless the request also includes twin integration.

## Project Configuration

Read the nearest project rules and an optional `twin.config.yaml` at the project root. Project values override only the fields they declare. When no project configuration exists, use these defaults:

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

Treat `stateTransport` as a project integration choice. Never invent broker URLs, credentials, device addresses, topics, ports, or API keys.

## Required Output Contract

Keep parametric CAD source as the source of truth and produce only artifacts required by the target system:

- source generator such as `<name>.step.py` when the project uses generated CAD;
- validated STEP as the engineering artifact;
- GLB or another runtime mesh as a derived visualization artifact;
- `twin.manifest.json` with asset identity, version, units, coordinate system, artifact paths, stable node IDs, and device or component bindings;
- URDF, SRDF, or SDF only when required by a robot or simulator.

Do not regenerate STEP for telemetry updates. Runtime state updates node transforms, joints, materials, or properties; regenerate geometry only for an intentional model-version change.

## Workflow

1. Establish the twin system, runtime, consumers, coordinate system, units, artifacts, and whether this is a geometry version or runtime-state change.
2. Resolve project rules and `twin.config.yaml`; record unresolved assumptions.
3. Build or update the parametric CAD source with the repository's established tooling.
4. Validate engineering geometry before exporting runtime assets.
5. Map every runtime-relevant part or joint to a stable `nodeId` and optional `deviceId` or `componentId`; display names are not stable identifiers.
6. Add robot or simulator semantics only when the target requires links, joints, inertials, physics, sensors, planning groups, or worlds.
7. Validate bounding boxes, units, coordinates, node coverage, mesh references, joint limits, inertials, and manifest-to-artifact consistency.
8. Review locally with an available Viewer, then publish through the project's asset service rather than exposing a local Viewer as a production service.

## Twin Manifest Minimum

```json
{
  "schemaVersion": 1,
  "assetId": "example-001",
  "version": "v1",
  "source": {"generator": "example.step.py", "commit": "source-commit-hash"},
  "units": {"design": "mm", "runtime": "m"},
  "coordinateSystem": "z_up",
  "artifacts": {"step": "example.step", "glb": "example.glb"},
  "nodes": [
    {"nodeId": "motor", "deviceId": "MOTOR-001", "glbNode": "Motor"}
  ]
}
```

Add telemetry, joint, collision, or simulator fields only when required. Never store credentials or secrets in the manifest.

## Safety And Acceptance

- Treat generated CAD code as untrusted in server or multi-user workflows; isolate execution, pin dependencies, and limit resources.
- Keep local viewers on loopback. They are not authenticated production asset services.
- Preserve source provenance, generator and dependency versions, validation results, and artifact hashes.
- A build pass is not acceptance. Report skipped runtime, simulator, deployment, credential, and hardware checks explicitly.
