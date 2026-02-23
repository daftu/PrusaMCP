import * as yauzl from "yauzl-promise";
import type { Triangle, Vec3, StlData } from "./types.js";

/**
 * Parse a 3MF file (ZIP containing XML model + mesh data).
 * 3MF spec: the mesh is in 3D/3dmodel.model as XML with <vertices> and <triangles>.
 */
export async function parse3mf(filePath: string): Promise<StlData> {
  const zip = await yauzl.open(filePath);
  let modelXml: string | null = null;

  try {
    for await (const entry of zip) {
      // The main model is typically at 3D/3dmodel.model
      if (entry.filename.endsWith(".model")) {
        const stream = await entry.openReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        modelXml = Buffer.concat(chunks).toString("utf-8");
        break;
      }
    }
  } finally {
    await zip.close();
  }

  if (!modelXml) {
    throw new Error("No .model file found in 3MF archive");
  }

  return parseModelXml(modelXml);
}

/**
 * Parse the 3MF model XML to extract triangles.
 * Uses regex parsing (no XML dep needed) since 3MF mesh format is simple.
 *
 * Format:
 *   <vertices>
 *     <vertex x="0" y="0" z="0" />
 *   </vertices>
 *   <triangles>
 *     <triangle v1="0" v2="1" v3="2" />
 *   </triangles>
 */
function parseModelXml(xml: string): StlData {
  // Extract all vertices
  const vertices: Vec3[] = [];
  const vertexRegex = /<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = vertexRegex.exec(xml)) !== null) {
    vertices.push({
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      z: parseFloat(match[3]),
    });
  }

  // Extract all triangles (indices into vertices array)
  const triangles: Triangle[] = [];
  const triRegex = /<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g;

  while ((match = triRegex.exec(xml)) !== null) {
    const i1 = parseInt(match[1], 10);
    const i2 = parseInt(match[2], 10);
    const i3 = parseInt(match[3], 10);

    if (i1 >= vertices.length || i2 >= vertices.length || i3 >= vertices.length) {
      continue; // skip invalid indices
    }

    const v1 = vertices[i1];
    const v2 = vertices[i2];
    const v3 = vertices[i3];

    // Compute face normal from vertices
    const normal = computeNormal(v1, v2, v3);

    triangles.push({ normal, v1, v2, v3 });
  }

  return {
    triangles,
    name: "3mf_model",
  };
}

function computeNormal(v1: Vec3, v2: Vec3, v3: Vec3): Vec3 {
  const ax = v2.x - v1.x, ay = v2.y - v1.y, az = v2.z - v1.z;
  const bx = v3.x - v1.x, by = v3.y - v1.y, bz = v3.z - v1.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: nx / len, y: ny / len, z: nz / len };
}
