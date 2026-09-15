import { parseStl } from "./stl-parser.js";
import { read3mfAnalysisInput } from "./threemf-parser.js";
import { analyzeMesh } from "./mesh-analyzer.js";

/** Saved, transformed source geometry only; no CSG, toolpaths or live GUI state. */
export async function analyzeModel(path: string) {
  const extension = path.toLowerCase();
  const input = extension.endsWith(".3mf") ? await read3mfAnalysisInput(path)
    : extension.endsWith(".stl") ? {mesh: await parseStl(path), excludedRoles: [] as string[], printableInstances: 1}
    : undefined;
  if (!input) throw new Error("unsupported_format: expected STL or 3MF");
  if (!input.mesh.triangles.length) throw new Error("geometry_unavailable: no printable ModelPart triangles");
  const warnings = [
    "Source mesh measurements only: volume is a signed-mesh sum, not a CSG union or sliced material consumption.",
    "Supports, small details, orientation, strength, time and pre-slicing costs are heuristics, not toolpath results.",
    ...(input.excludedRoles.length ? [`Excluded volume roles: ${input.excludedRoles.join(", ")}. Their effects require the slicer; effective volume and material consumption are unknown.`] : []),
  ];
  const evidence = {
    source: "file" as const,
    coverage: input.excludedRoles.length ? "partial" as const : "complete" as const,
    volume_basis: "source_mesh_sum" as const,
    effective_volume: "unknown" as const,
    heuristic_source: "estimate" as const,
    printable_instances: input.printableInstances,
    excluded_roles: input.excludedRoles,
    warnings,
  };
  return {mesh: input.mesh, analysis: analyzeMesh(input.mesh), evidence};
}

export async function parseModel(path: string) { return (await analyzeModel(path)).mesh; }
