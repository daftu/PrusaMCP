import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { analyzeModel } from "../model-analysis.js";

export { parseModel } from "../model-analysis.js";

export function registerAnalyzeMesh(server: McpServer) {
  registerContractTool(server,
    "analyze_mesh",
    {
      title: "Analyser un mesh 3D",
      description:
        "Analyse un fichier STL ou 3MF et retourne : dimensions, volume, surface, " +
        "pourcentage d'overhangs, détection de détails fins, et vérification manifold.",
      inputSchema: {
        file_path: z.string().describe("Chemin absolu vers le fichier STL ou 3MF"),
      },
    },
    async ({ file_path }) => {
      try {
        if (!existsSync(file_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Fichier non trouvé : ${file_path}` }],
          };
        }

        const lower = file_path.toLowerCase();
        if (!lower.endsWith(".stl") && !lower.endsWith(".3mf")) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Formats supportés : STL, 3MF" }],
          };
        }

        console.error(`[analyze_mesh] Parsing ${file_path}...`);
        const {mesh, analysis, evidence} = await analyzeModel(file_path);

        const bb = analysis.boundingBox;
        const lines = [
          `## Analyse Mesh : ${mesh.name}`,
          "",
          `**Dimensions (XYZ)** : ${bb.size.x.toFixed(2)} × ${bb.size.y.toFixed(2)} × ${bb.size.z.toFixed(2)} mm`,
          `**Source mesh volume (not sliced consumption)** : ${analysis.volume.toFixed(2)} mm³ (${(analysis.volume / 1000).toFixed(2)} cm³)`,
          `**Surface** : ${analysis.surfaceArea.toFixed(2)} mm²`,
          `**Triangles** : ${analysis.triangleCount.toLocaleString()}`,
          "",
          `### Overhangs`,
          `- Faces en overhang (>45°) : **${analysis.overhangPercent.toFixed(1)}%** (${analysis.overhangTriangles} triangles)`,
          analysis.overhangPercent > 5
            ? `- Supports probablement nécessaires`
            : `- Peu d'overhangs — pas de support nécessaire a priori`,
          "",
          `### Détails fins`,
          `- Petits triangles : ${analysis.smallDetailPercent.toFixed(1)}%`,
          analysis.hasSmallDetails
            ? `- Détails fins détectés — layer height fine recommandée`
            : `- Pas de détails fins critiques`,
          "",
          `### Manifold`,
          analysis.isManifold
            ? `- Mesh manifold (fermé, prêt pour l'impression)`
            : `- Mesh non-manifold (${analysis.nonManifoldEdges} arêtes problématiques) — repair recommandé`,
        ];

        return {
          data: {name:mesh.name,analysis,evidence},
          resultStatus: evidence.coverage === "partial" ? "partial" : "confirmed",
          warnings: evidence.warnings,
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur d'analyse : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
