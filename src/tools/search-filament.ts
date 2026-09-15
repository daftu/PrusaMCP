import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchFilaments } from "../filament-db.js";

export function registerSearchFilament(server: McpServer) {
  registerContractTool(server,
    "search_filament",
    {
      title: "Chercher un filament dans la base de données",
      description:
        "Recherche des filaments par marque, matériau ou mot-clé. " +
        "Retourne les températures recommandées, densité, prix, et notes.",
      inputSchema: {
        query: z.string().optional().describe("Recherche libre (marque, matériau, mot-clé)"),
        material: z.string().optional().describe("Filtrer par matériau (PLA, PETG, ABS, TPU...)"),
        brand: z.string().optional().describe("Filtrer par marque (Prusament, eSUN, Polymaker...)"),
      },
    },
    async ({ query, material, brand }) => {
      const results = searchFilaments(query, material, brand);

      if (results.length === 0) {
        return {
          data:{filaments:results},
          content: [{
            type: "text" as const,
            text: "Aucun filament trouvé. Essaie avec d'autres critères.",
          }],
        };
      }

      const lines = [`## Filaments trouvés (${results.length})`, ""];

      for (const f of results) {
        lines.push(`### ${f.brand} ${f.name} (${f.material})`);
        lines.push(`- **Buse** : ${f.nozzleTemp[0]}-${f.nozzleTemp[1]}°C`);
        lines.push(`- **Plateau** : ${f.bedTemp[0]}-${f.bedTemp[1]}°C`);
        lines.push(`- **Ventilateur** : ${f.fanSpeed[0]}-${f.fanSpeed[1]}%`);
        lines.push(`- **MVS** : ${f.maxVolumetricSpeed} mm³/s`);
        lines.push(`- **Densité** : ${f.density} g/cm³`);
        if (f.pricePerKg) lines.push(`- **Prix** : ~${f.pricePerKg}€/kg`);
        if (f.requiresEnclosure) lines.push(`- **Enceinte** : obligatoire`);
        if (f.recommendedSurface) lines.push(`- **Surface** : ${f.recommendedSurface}`);
        lines.push(`- _${f.notes}_`);
        lines.push("");
      }

      return {
        data: {filaments:results},
          content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );
}
