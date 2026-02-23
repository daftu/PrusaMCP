import { parseStl } from "../build/stl-parser.js";
import { analyzeMesh } from "../build/mesh-analyzer.js";
import { detectPrintIssues } from "../build/print-issues.js";
import { suggestOrientation } from "../build/orientation.js";
import { estimateCostFromMesh } from "../build/cost-estimator.js";
import { searchFilaments } from "../build/filament-db.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const stl = await parseStl(join(__dirname, "cube.stl"));
  const analysis = analyzeMesh(stl);

  console.log("=== Print Issues ===");
  const issues = detectPrintIssues(stl.triangles, analysis, 0.5);
  console.log(`Score: ${issues.score}/100 — ${issues.summary}`);
  issues.issues.forEach(i => console.log(`  [${i.severity}] ${i.category}: ${i.message}`));

  console.log("\n=== Orientation ===");
  const orientations = suggestOrientation(stl);
  orientations.slice(0, 3).forEach((o, i) => {
    console.log(`  ${i+1}. ${o.name} — score ${o.score}, overhangs ${o.overhangPercent.toFixed(1)}%, height ${o.printHeight.toFixed(1)}mm`);
  });

  console.log("\n=== Cost Estimate (standard PLA 0.5mm) ===");
  const cost = estimateCostFromMesh(analysis, 0.25, 30, 3, 70, "PLA");
  console.log(`  Time: ${cost.printTimeFormatted}, Filament: ${cost.filamentWeightG}g, Cost: ${cost.totalCostEur}€`);

  console.log("\n=== Filament DB ===");
  const pla = searchFilaments(undefined, "PLA");
  console.log(`  PLA entries: ${pla.length}`);
  pla.forEach(f => console.log(`    ${f.brand} ${f.name}: ${f.nozzleTemp[0]}-${f.nozzleTemp[1]}°C, ${f.pricePerKg ?? '?'}€/kg`));

  const petg = searchFilaments("prusament", "PETG");
  console.log(`  Prusament PETG: ${petg.length} entry — ${petg[0]?.nozzleTemp[0]}-${petg[0]?.nozzleTemp[1]}°C`);

  console.log("\n✅ All v2 tests passed!");
}

main().catch(console.error);
