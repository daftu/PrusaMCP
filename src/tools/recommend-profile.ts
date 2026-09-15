import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { recommendProfile } from "../profile-engine.js";
import { parseStl } from "../stl-parser.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import type { MeshAnalysis } from "../types.js";

export function registerRecommendProfile(server: McpServer) {
  registerContractTool(server,
    "recommend_profile",
    {
      title: "Recommander un profil d'impression",
      description:
        "Génère un profil d'impression complet avec justification pour chaque paramètre. " +
        "Prend en compte l'intention (prototype rapide, beau rendu, solide...), " +
        "la buse, le matériau, et optionnellement une analyse mesh.",
      inputSchema: {
        printer: z
          .string()
          .default("Generic")
          .describe("Nom de l'imprimante (ex: MK4S, MINI, CR30, Ender3)"),
        nozzle: z
          .number()
          .default(0.4)
          .describe("Diamètre de buse en mm (ex: 0.4, 0.6, 0.8, 1.0)"),
        goal: z
          .string()
          .describe(
            "Intention d'impression : 'prototype rapide', 'standard', 'beau rendu', " +
            "'production solide', 'vase', 'speedrun', ou toute description libre"
          ),
        material: z
          .string()
          .default("PLA")
          .describe("Matériau : PLA, PETG, ABS, ASA, TPU, NYLON, PC"),
        stl_path: z
          .string()
          .optional()
          .describe("Chemin optionnel vers un STL pour analyse automatique (overhangs, détails, taille)"),
      },
    },
    async ({ printer, nozzle, goal, material, stl_path }) => {
      try {
        // Optional mesh analysis
        let meshAnalysis: MeshAnalysis | undefined;
        if (stl_path && existsSync(stl_path)) {
          console.error(`[recommend_profile] Analyzing mesh: ${stl_path}`);
          const stl = await parseStl(stl_path);
          meshAnalysis = analyzeMesh(stl);
          console.error(`[recommend_profile] Mesh: ${meshAnalysis.triangleCount} tris, ${meshAnalysis.overhangPercent.toFixed(1)}% overhangs`);
        }

        const profile = recommendProfile(printer, nozzle, goal, material, meshAnalysis);

        // Format output
        const lines = [
          `## Profil recommandé`,
          `**Imprimante** : ${profile.printer} | **Buse** : ${profile.nozzle}mm | **Matériau** : ${profile.material}`,
          `**Objectif** : ${profile.goal}`,
          "",
        ];

        // Settings with justifications
        const categories: Record<string, string[]> = {
          "Couches & Dimensions": ["layer_height", "line_width"],
          "Parois & Remplissage": ["perimeters", "infill_density", "fill_pattern"],
          "Températures": ["nozzle_temperature", "first_layer_nozzle_temperature", "bed_temperature", "first_layer_bed_temperature"],
          "Vitesses & Débit": ["print_speed", "travel_speed", "first_layer_speed", "max_volumetric_speed"],
          "Supports & Adhésion": ["support_material", "support_material_style", "support_material_contact_distance", "brim_width"],
          "Refroidissement": ["fan_speed", "min_fan_speed", "bridge_fan_speed", "min_layer_time"],
          "Rétraction & Extrusion": ["retraction_length", "retraction_speed", "extrusion_multiplier"],
          "Dynamique": ["acceleration"],
        };

        for (const [category, keys] of Object.entries(categories)) {
          lines.push(`### ${category}`);
          for (const key of keys) {
            const setting = profile.settings[key as keyof typeof profile.settings];
            if (setting) {
              const displayKey = key.replace(/_/g, " ");
              lines.push(`- **${displayKey}** : \`${setting.value}\``);
              lines.push(`  _${setting.reason}_`);
            }
          }
          lines.push("");
        }

        // Warnings
        if (profile.warnings.length > 0) {
          lines.push("### Avertissements");
          for (const w of profile.warnings) {
            lines.push(`- ⚠ ${w}`);
          }
          lines.push("");
        }

        // Mesh context if available
        if (meshAnalysis) {
          const bb = meshAnalysis.boundingBox;
          lines.push("### Contexte mesh");
          lines.push(`- Dimensions : ${bb.size.x.toFixed(1)} × ${bb.size.y.toFixed(1)} × ${bb.size.z.toFixed(1)} mm`);
          lines.push(`- Volume : ${(meshAnalysis.volume / 1000).toFixed(2)} cm³`);
          lines.push(`- Overhangs : ${meshAnalysis.overhangPercent.toFixed(1)}%`);
          lines.push(`- Manifold : ${meshAnalysis.isManifold ? "Oui" : "Non"}`);
        }

        return {
          data: {profile,analysis:meshAnalysis},
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur de recommandation : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
