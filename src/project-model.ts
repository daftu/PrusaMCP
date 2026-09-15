import { posix } from "node:path";
import {
  child,
  children,
  CORE,
  readArchive,
  xmlEntry,
  type ProjectArchive,
  type XmlNode,
} from "./project-archive.js";
import type { Vec3 } from "./types.js";
export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
export function transform(value?: string): number[] {
  if (value === undefined) return [...IDENTITY];
  const m = value.trim().split(/\s+/).map(Number);
  if (m.length !== 12 || !m.every(Number.isFinite))
    throw new Error("invalid_transform: expected twelve finite values");
  return m;
}
export function point(p: Vec3, m: number[]): Vec3 {
  return {
    x: p.x * m[0] + p.y * m[3] + p.z * m[6] + m[9],
    y: p.x * m[1] + p.y * m[4] + p.z * m[7] + m[10],
    z: p.x * m[2] + p.y * m[5] + p.z * m[8] + m[11],
  };
}
export function compose(local: number[], parent: number[]): number[] {
  const out: number[] = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      out.push(
        local[row * 3] * parent[col] +
          local[row * 3 + 1] * parent[3 + col] +
          local[row * 3 + 2] * parent[6 + col],
      );
  const p = point({ x: local[9], y: local[10], z: local[11] }, parent);
  return [...out, p.x, p.y, p.z];
}
export interface SceneObject {
  object_id: string;
  resource_id: string;
  name: string;
  vertices: Vec3[];
  triangles: number[][];
  components: { object_id: string; transform: number[] }[];
}
export interface SceneInstance {
  instance_id: string;
  object_id: string;
  printable: boolean;
  transform: number[];
  meshes: { object_id: string; transform_mm: number[] }[];
  bounding_box: { min: Vec3; max: Vec3 } | null;
}
export function objectId(id: string) {
  return `object:${id}`;
}
export function sceneFromArchive(archive: ProjectArchive) {
  const relations = xmlEntry(archive, "_rels/.rels");
  const models = children(relations, "Relationship").filter(
    (n) =>
      n.attrs.Type ===
      "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel",
  );
  if (models.length !== 1)
    throw new Error("missing_reference: expected one root model relationship");
  const target = models[0].attrs.Target;
  if (
    models[0].attrs.TargetMode === "External" ||
    !target ||
    /^[a-z]+:|\\|[?#]/i.test(target)
  )
    throw new Error("external_reference: model must be a package part");
  const model_path = posix.normalize(
    decodeURIComponent(target).replace(/^\//, ""),
  );
  if (model_path.startsWith("../"))
    throw new Error("external_reference: invalid package path");
  const root = xmlEntry(archive, model_path);
  if (root.name !== "model" || root.uri !== CORE)
    throw new Error("unsupported_geometry: unknown model namespace");
  if (root.attrs.requiredextensions?.trim())
    throw new Error(
      "unsupported_geometry: required extensions are not supported",
    );
  const unit = root.attrs.unit ?? "millimeter";
  const factor: Record<string, number> = {
    micron: 0.001,
    millimeter: 1,
    centimeter: 10,
    inch: 25.4,
    foot: 304.8,
    meter: 1000,
  };
  if (!factor[unit]) throw new Error("unsupported_geometry: unknown unit");
  const nodes = children(child(root, "resources"), "object");
  const objects: SceneObject[] = [];
  const nodeMap = new Map<string, XmlNode>();
  const reference = (node: XmlNode) => {
    if (
      Object.keys(node.attrs).some((k) => k.endsWith(":path") || k === "path")
    )
      throw new Error("external_reference: cross-part geometry is unsupported");
    if (!node.attrs.objectid)
      throw new Error("missing_reference: objectid is absent");
    return objectId(node.attrs.objectid);
  };
  for (const node of nodes) {
    const id = node.attrs.id;
    if (!id || nodeMap.has(objectId(id)))
      throw new Error("invalid_project: duplicate or absent object id");
    nodeMap.set(objectId(id), node);
    const vertices: Vec3[] = [];
    const triangles: number[][] = [];
    const components: SceneObject["components"] = [];
    const mesh = children(node, "mesh");
    const componentNodes = children(node, "components");
    if (mesh.length + componentNodes.length !== 1)
      throw new Error(
        "unsupported_geometry: object must contain one mesh or components",
      );
    if (mesh.length) {
      for (const v of children(child(mesh[0], "vertices"), "vertex")) {
        const xyz = ["x", "y", "z"].map((k) =>
          v.attrs[k] === undefined ? NaN : Number(v.attrs[k]),
        );
        if (!xyz.every(Number.isFinite))
          throw new Error("invalid_geometry: nonfinite vertex");
        vertices.push({ x: xyz[0], y: xyz[1], z: xyz[2] });
      }
      for (const t of children(child(mesh[0], "triangles"), "triangle")) {
        const indices = ["v1", "v2", "v3"].map((k) =>
          Number(t.attrs[k] ?? NaN),
        );
        if (
          !indices.every(
            (i) => Number.isInteger(i) && i >= 0 && i < vertices.length,
          )
        )
          throw new Error(
            "invalid_geometry: triangle index outside local vertices",
          );
        triangles.push(indices);
      }
    } else
      for (const c of children(componentNodes[0], "component"))
        components.push({
          object_id: reference(c),
          transform: transform(c.attrs.transform),
        });
    objects.push({
      object_id: objectId(id),
      resource_id: id,
      name: node.attrs.name ?? "",
      vertices,
      triangles,
      components,
    });
  }
  const byId = new Map(objects.map((o) => [o.object_id, o]));
  const buildNodes = children(child(root, "build"), "item");
  const instances: SceneInstance[] = [];
  for (const [i, item] of buildNodes.entries()) {
    const meshes: SceneInstance["meshes"] = [];
    const initial = transform(item.attrs.transform);
    const scale = [
      factor[unit],
      0,
      0,
      0,
      factor[unit],
      0,
      0,
      0,
      factor[unit],
      0,
      0,
      0,
    ];
    const visit = (id: string, matrix: number[], ancestors: Set<string>) => {
      const obj = byId.get(id);
      if (!obj)
        throw new Error("missing_reference: referenced object is absent");
      if (ancestors.has(id))
        throw new Error("invalid_geometry: cyclic components");
      if (obj.components.length) {
        const next = new Set(ancestors).add(id);
        for (const c of obj.components)
          visit(c.object_id, compose(c.transform, matrix), next);
      } else meshes.push({ object_id: id, transform_mm: matrix });
    };
    const id = reference(item);
    visit(id, compose(initial, scale), new Set());
    let min: Vec3 = { x: Infinity, y: Infinity, z: Infinity },
      max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
    let count = 0;
    for (const mesh of meshes)
      for (const p of byId.get(mesh.object_id)!.vertices) {
        const q = point(p, mesh.transform_mm);
        count++;
        for (const k of ["x", "y", "z"] as const) {
          min[k] = Math.min(min[k], q[k]);
          max[k] = Math.max(max[k], q[k]);
        }
      }
    instances.push({
      instance_id: `instance:${i}`,
      object_id: id,
      printable:
        item.attrs.printable !== "0" && item.attrs.printable !== "false",
      transform: initial,
      meshes,
      bounding_box: count ? { min, max } : null,
    });
  }
  return {
    scene: { revision: archive.revision, model_path, unit, objects, instances },
    root,
    nodeMap,
    buildNodes,
  };
}
export async function readProjectGeometry(path: string) {
  const archive = await readArchive(path);
  const scene = sceneFromArchive(archive).scene;
  const { metadataFromArchive } = await import("./project-metadata.js");
  const metadata = metadataFromArchive(archive);
  return {
    ...scene,
    objects: scene.objects.map((obj) => ({
      ...obj,
      name: metadata.objects.find((m) => m.object_id === obj.object_id)!.name,
      volumes: metadata.objects.find((m) => m.object_id === obj.object_id)!
        .volumes,
    })),
  };
}
