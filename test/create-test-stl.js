// Generate a simple binary STL cube for testing
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// A cube: 8 vertices, 12 triangles (2 per face)
const vertices = [
  // Front face (z=20)
  [[0,0,20], [20,0,20], [20,20,20]],
  [[0,0,20], [20,20,20], [0,20,20]],
  // Back face (z=0)
  [[20,0,0], [0,0,0], [0,20,0]],
  [[20,0,0], [0,20,0], [20,20,0]],
  // Right face (x=20)
  [[20,0,20], [20,0,0], [20,20,0]],
  [[20,0,20], [20,20,0], [20,20,20]],
  // Left face (x=0)
  [[0,0,0], [0,0,20], [0,20,20]],
  [[0,0,0], [0,20,20], [0,20,0]],
  // Top face (y=20)
  [[0,20,20], [20,20,20], [20,20,0]],
  [[0,20,20], [20,20,0], [0,20,0]],
  // Bottom face (y=0)
  [[0,0,0], [20,0,0], [20,0,20]],
  [[0,0,0], [20,0,20], [0,0,20]],
];

const normals = [
  [0,0,1], [0,0,1],     // front
  [0,0,-1], [0,0,-1],   // back
  [1,0,0], [1,0,0],     // right
  [-1,0,0], [-1,0,0],   // left
  [0,1,0], [0,1,0],     // top
  [0,-1,0], [0,-1,0],   // bottom
];

const numTriangles = 12;
const bufSize = 84 + numTriangles * 50;
const buf = Buffer.alloc(bufSize);

// Header (80 bytes)
buf.write("Binary STL test cube 20x20x20mm", 0);

// Triangle count
buf.writeUInt32LE(numTriangles, 80);

let offset = 84;
for (let i = 0; i < numTriangles; i++) {
  const n = normals[i];
  const tri = vertices[i];

  // Normal
  buf.writeFloatLE(n[0], offset); offset += 4;
  buf.writeFloatLE(n[1], offset); offset += 4;
  buf.writeFloatLE(n[2], offset); offset += 4;

  // 3 vertices
  for (const v of tri) {
    buf.writeFloatLE(v[0], offset); offset += 4;
    buf.writeFloatLE(v[1], offset); offset += 4;
    buf.writeFloatLE(v[2], offset); offset += 4;
  }

  // Attribute byte count
  buf.writeUInt16LE(0, offset); offset += 2;
}

const outPath = join(__dirname, "cube.stl");
writeFileSync(outPath, buf);
console.log(`Created: ${outPath} (${buf.length} bytes)`);
