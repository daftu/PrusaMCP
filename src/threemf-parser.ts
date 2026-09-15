import { readArchive } from "./project-archive.js";
import { sceneFromArchive, point } from "./project-model.js";
import { metadataFromArchive } from "./project-metadata.js";
import type { Triangle, Vec3, StlData } from "./types.js";
/** Flatten only printable build instances and native ModelPart volumes, in millimeters.
 * This is source mesh analysis; negative-volume CSG and overlap union are not evaluated. */
export async function read3mfAnalysisInput(filePath: string) {
  const archive = await readArchive(filePath);
  const { scene } = sceneFromArchive(archive);
  const metadata = metadataFromArchive(archive);
  const triangles: Triangle[] = [];
  const excludedRoles = new Set<string>();
  let printableInstances = 0;
  for (const instance of scene.instances.filter((i) => i.printable)) {
    printableInstances++;
    for (const mesh of instance.meshes) {
      const obj = scene.objects.find((o) => o.object_id === mesh.object_id)!;
      const meta = metadata.objects.find(
        (o) => o.object_id === mesh.object_id,
      )!;
      for (const volume of meta.volumes) if (volume.role !== "ModelPart") excludedRoles.add(volume.role);
      const m = mesh.transform_mm;
      const mirrored =
        m[0] * (m[4] * m[8] - m[5] * m[7]) -
          m[1] * (m[3] * m[8] - m[5] * m[6]) +
          m[2] * (m[3] * m[7] - m[4] * m[6]) <
        0;
      for (const volume of meta.volumes.filter((v) => v.role === "ModelPart"))
        for (let i = volume.first_triangle; i <= volume.last_triangle; i++) {
          let [v1, v2, v3] = obj.triangles[i].map((index) =>
            point(obj.vertices[index], mesh.transform_mm),
          );
          if (mirrored) [v2, v3] = [v3, v2];
          triangles.push({ v1, v2, v3, normal: normal(v1, v2, v3) });
        }
    }
  }
  return { mesh: { triangles, name: "3mf_model" }, excludedRoles: [...excludedRoles], printableInstances };
}
function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
    v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const n = {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  };
  const length = Math.hypot(n.x, n.y, n.z);
  return length
    ? { x: n.x / length, y: n.y / length, z: n.z / length }
    : { x: 0, y: 0, z: 1 };
}

export async function parse3mf(filePath: string): Promise<StlData> {
  return (await read3mfAnalysisInput(filePath)).mesh;
}
