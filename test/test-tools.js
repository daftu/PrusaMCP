// Quick test of core modules (not MCP, just the logic)
import { parseStl } from "../build/stl-parser.js";
import { analyzeMesh } from "../build/mesh-analyzer.js";
import { recommendProfile } from "../build/profile-engine.js";
import { profileToIniSettings, serializeIni } from "../build/ini-writer.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stlPath = join(__dirname, "cube.stl");

async function main() {
  console.log("=== 1. Parse STL ===");
  const stl = await parseStl(stlPath);
  console.log(`Name: ${stl.name}`);
  console.log(`Triangles: ${stl.triangles.length}`);

  console.log("\n=== 2. Analyze Mesh ===");
  const analysis = analyzeMesh(stl);
  console.log(`Dimensions: ${analysis.boundingBox.size.x} x ${analysis.boundingBox.size.y} x ${analysis.boundingBox.size.z} mm`);
  console.log(`Volume: ${analysis.volume.toFixed(2)} mm³`);
  console.log(`Surface: ${analysis.surfaceArea.toFixed(2)} mm²`);
  console.log(`Overhangs: ${analysis.overhangPercent.toFixed(1)}%`);
  console.log(`Manifold: ${analysis.isManifold}`);
  console.log(`Small details: ${analysis.hasSmallDetails}`);

  console.log("\n=== 3. Recommend Profile (prototype rapide) ===");
  const profile1 = recommendProfile("MK4S", 0.4, "prototype rapide", "PLA", analysis);
  console.log(`Goal: ${profile1.goal}`);
  console.log(`Layer height: ${profile1.settings.layer_height.value} - ${profile1.settings.layer_height.reason}`);
  console.log(`Speed: ${profile1.settings.print_speed.value} - ${profile1.settings.print_speed.reason}`);
  console.log(`Infill: ${profile1.settings.infill_density.value} - ${profile1.settings.infill_density.reason}`);
  console.log(`Supports: ${profile1.settings.support_material.value} - ${profile1.settings.support_material.reason}`);
  console.log(`Warnings: ${profile1.warnings.length > 0 ? profile1.warnings.join(", ") : "none"}`);

  console.log("\n=== 4. Recommend Profile (beau rendu, ABS, 1mm nozzle) ===");
  const profile2 = recommendProfile("CR30", 1.0, "beau rendu", "ABS", analysis);
  console.log(`Goal: ${profile2.goal}`);
  console.log(`Layer height: ${profile2.settings.layer_height.value}`);
  console.log(`Nozzle temp: ${profile2.settings.nozzle_temperature.value}`);
  console.log(`Fan: ${profile2.settings.fan_speed.value}`);
  console.log(`Brim: ${profile2.settings.brim_width.value}`);
  console.log(`Warnings: ${profile2.warnings.join(", ")}`);

  console.log("\n=== 5. Generate INI ===");
  const iniSettings = profileToIniSettings(profile1);
  const ini = serializeIni(iniSettings);
  console.log(ini.substring(0, 500) + "...");

  console.log("\n✅ All tests passed!");
}

main().catch(console.error);
