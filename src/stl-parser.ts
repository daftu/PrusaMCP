import { readFile } from "node:fs/promises";
import type { Triangle, Vec3, StlData } from "./types.js";

/**
 * Parse an STL file (auto-detects binary vs ASCII).
 */
export async function parseStl(filePath: string): Promise<StlData> {
  const buffer = await readFile(filePath);

  // Heuristic: if the file starts with "solid" and contains "facet", it's ASCII.
  // But some binary STLs can start with "solid" in their header, so we also
  // check if the expected binary size matches.
  if (isBinaryStl(buffer)) {
    return parseBinaryStl(buffer);
  }
  return parseAsciiStl(buffer.toString("utf-8"));
}

function isBinaryStl(buffer: Buffer): boolean {
  if (buffer.length < 84) return false;

  // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes per triangle
  const triangleCount = buffer.readUInt32LE(80);
  const expectedSize = 84 + triangleCount * 50;

  // If the size matches exactly, it's almost certainly binary
  if (buffer.length === expectedSize) return true;

  // If the file looks like ASCII ("solid" start + "facet" keyword)
  const header = buffer.subarray(0, 80).toString("utf-8");
  if (header.startsWith("solid")) {
    const peek = buffer.subarray(80, Math.min(buffer.length, 300)).toString("utf-8");
    if (peek.includes("facet") || peek.includes("vertex")) {
      return false; // ASCII
    }
  }

  // Default to binary if size is reasonable
  return buffer.length >= expectedSize;
}

// ─── Binary STL ──────────────────────────────────────────────

function parseBinaryStl(buffer: Buffer): StlData {
  const name = buffer.subarray(0, 80).toString("utf-8").replace(/\0+$/, "").trim();
  const triangleCount = buffer.readUInt32LE(80);
  const triangles: Triangle[] = new Array(triangleCount);

  let offset = 84;
  for (let i = 0; i < triangleCount; i++) {
    const normal = readVec3(buffer, offset);
    offset += 12;
    const v1 = readVec3(buffer, offset);
    offset += 12;
    const v2 = readVec3(buffer, offset);
    offset += 12;
    const v3 = readVec3(buffer, offset);
    offset += 12;
    // Skip 2-byte attribute byte count
    offset += 2;

    triangles[i] = { normal, v1, v2, v3 };
  }

  return { triangles, name: name || "binary_stl" };
}

function readVec3(buffer: Buffer, offset: number): Vec3 {
  return {
    x: buffer.readFloatLE(offset),
    y: buffer.readFloatLE(offset + 4),
    z: buffer.readFloatLE(offset + 8),
  };
}

// ─── ASCII STL ───────────────────────────────────────────────

function parseAsciiStl(content: string): StlData {
  const triangles: Triangle[] = [];

  // Extract name from "solid <name>"
  const nameMatch = content.match(/^solid\s+(.*)$/m);
  const name = nameMatch?.[1]?.trim() || "ascii_stl";

  // Match each facet block
  const facetRegex =
    /facet\s+normal\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+outer\s+loop\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+endloop\s+endfacet/g;

  let match: RegExpExecArray | null;
  while ((match = facetRegex.exec(content)) !== null) {
    const f = match.map(Number);
    triangles.push({
      normal: { x: f[1], y: f[2], z: f[3] },
      v1: { x: f[4], y: f[5], z: f[6] },
      v2: { x: f[7], y: f[8], z: f[9] },
      v3: { x: f[10], y: f[11], z: f[12] },
    });
  }

  return { triangles, name };
}
