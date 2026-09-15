import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { analyzeModel } from "../model-analysis.js";
import { estimateCostFromMesh } from "../cost-estimator.js";
import { recommendProfile } from "../profile-engine.js";

export function registerEstimateCost(server: McpServer) {
  registerContractTool(server,
    "estimate_cost",
    {
      title: "Estimer le coût d'impression",
      description:
        "Estime le coût d'impression d'un modèle 3D : filament, électricité, temps. " +
        "Peut aussi comparer plusieurs profils (draft/standard/quality) côte à côte.",
      inputSchema: {
        file_path: z.string().describe("Chemin absolu vers le fichier STL ou 3MF"),
        material: z.string().default("PLA").describe("Matériau (PLA, PETG, ABS...)"),
        nozzle: z.number().default(0.4).describe("Diamètre de buse en mm"),
        filament_price_per_kg: z.number().default(22).describe("Prix du filament en EUR/kg"),
        electricity_price: z.number().default(0.25).describe("Prix électricité en EUR/kWh"),
        compare_profiles: z
          .boolean()
          .default(true)
          .describe("Comparer draft/standard/quality côte à côte"),
      },
    },
    async ({ file_path, material, nozzle, filament_price_per_kg, electricity_price, compare_profiles }) => {
      try {
        if (!existsSync(file_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Fichier non trouvé : ${file_path}` }],
          };
        }

        const {mesh, analysis, evidence} = await analyzeModel(file_path);

        const params = {
          filamentPricePerKg: filament_price_per_kg,
          electricityPricePerKwh: electricity_price,
          printerWattage: 200,
        };

        const lines: string[] = [];
        const estimates: Array<{goal:string;estimate:ReturnType<typeof estimateCostFromMesh>}> = [];

        if (compare_profiles) {
          // Compare draft / standard / quality
          const goals = ["draft", "standard", "quality", "strong"] as const;
          const comparisons: Array<{
            name: string;
            time: string;
            cost: string;
            filament: string;
            layerH: number;
          }> = [];

          lines.push("## Comparaison des profils");
          lines.push(`**Modèle** : ${mesh.name} | **Matériau** : ${material} | **Buse** : ${nozzle}mm`);
          lines.push(`**Prix filament** : ${filament_price_per_kg}€/kg | **Électricité** : ${electricity_price}€/kWh`);
          lines.push("");

          for (const goal of goals) {
            const profile = recommendProfile("Generic", nozzle, goal, material);
            const lh = profile.settings.layer_height.value as number;
            const infill = profile.settings.infill_density.value as number;
            const perimeters = profile.settings.perimeters.value as number;
            const speed = profile.settings.print_speed.value as number;

            const estimate = estimateCostFromMesh(
              analysis, lh, infill, perimeters, speed, material, params,
            );

            estimates.push({goal,estimate});
            comparisons.push({
              name: goal,
              time: estimate.printTimeFormatted,
              cost: `${estimate.totalCostEur}€`,
              filament: `${estimate.filamentWeightG}g`,
              layerH: lh,
            });
          }

          // Table
          lines.push("| Profil | Layer | Temps | Filament | Coût total |");
          lines.push("|--------|-------|-------|----------|------------|");
          for (const c of comparisons) {
            lines.push(`| **${c.name}** | ${c.layerH}mm | ${c.time} | ${c.filament} | ${c.cost} |`);
          }

          // Savings
          if (comparisons.length >= 2) {
            const fastest = comparisons[0];
            const slowest = comparisons[comparisons.length - 1];
            lines.push("");
            lines.push(`**Économie draft vs strong** : ${slowest.cost} → ${fastest.cost} en passant de ${slowest.time} à ${fastest.time}`);
          }
        } else {
          // Single profile estimate
          const profile = recommendProfile("Generic", nozzle, "standard", material);
          const lh = profile.settings.layer_height.value as number;
          const infill = profile.settings.infill_density.value as number;
          const perimeters = profile.settings.perimeters.value as number;
          const speed = profile.settings.print_speed.value as number;

          const estimate = estimateCostFromMesh(
            analysis, lh, infill, perimeters, speed, material, params,
          );

          estimates.push({goal:"standard",estimate});
          lines.push("## Estimation de coût");
          lines.push(`**Temps** : ${estimate.printTimeFormatted}`);
          lines.push(`**Filament** : ${estimate.filamentWeightG}g (${estimate.filamentLengthMm.toFixed(0)}mm)`);
          lines.push(`**Coût filament** : ${estimate.filamentCostEur}€`);
          lines.push(`**Coût électricité** : ${estimate.electricityCostEur}€`);
          lines.push(`**Coût total** : ${estimate.totalCostEur}€`);
        }

        return {
          resultStatus: evidence.coverage === "partial" ? "partial" : "confirmed",
          warnings: evidence.warnings,
          data: {evidence,estimates},
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
