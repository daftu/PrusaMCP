import { readArchive } from "./project-archive.js";
import { sceneFromArchive, point } from "./project-model.js";
import { metadataFromArchive } from "./project-metadata.js";
import type { Triangle, Vec3, StlData } from "./types.js";
/** Flatten only printable build instances and native ModelPart volumes, in millimeters.
 * This is source mesh analysis; negative-volume CSG and overlap union are not evaluated. */
export async function parse3mf(filePath: string): Promise<StlData> {
  const archive = await readArchive(filePath);
  const { scene } = sceneFromArchive(archive);
  const metadata = metadataFromArchive(archive);
  const triangles: Triangle[] = [];
  for (const instance of scene.instances.filter((i) => i.printable))
    for (const mesh of instance.meshes) {
      const obj = scene.objects.find((o) => o.object_id === mesh.object_id)!;
      const meta = metadata.objects.find(
        (o) => o.object_id === mesh.object_id,
      )!;
      for (const volume of meta.volumes.filter((v) => v.role === "ModelPart"))
        for (let i = volume.first_triangle; i <= volume.last_triangle; i++) {
          const [v1, v2, v3] = obj.triangles[i].map((index) =>
            point(obj.vertices[index], mesh.transform_mm),
          );
          triangles.push({ v1, v2, v3, normal: normal(v1, v2, v3) });
        }
    }
  return { triangles, name: "3mf_model" };
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
