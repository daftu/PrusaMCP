import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { parseModel } from "./analyze-mesh.js";
import { analyzeMesh } from "../mesh-analyzer.js";
import { detectPrintIssues } from "../print-issues.js";

export function registerCheckPrintability(server: McpServer) {
  server.registerTool(
    "check_printability",
    {
      title: "Vérifier la printabilité d'un modèle",
      description:
        "Analyse un modèle 3D (STL/3MF) pour détecter les problèmes d'impression : " +
        "murs trop fins, ponts trop longs, overhangs, mesh non-manifold, stabilité, etc. " +
        "Retourne un score de printabilité et des recommandations.",
      inputSchema: {
        file_path: z.string().describe("Chemin absolu vers le fichier STL ou 3MF"),
        nozzle_diameter: z
          .number()
          .default(0.4)
          .describe("Diamètre de buse en mm (pour calibrer les seuils)"),
      },
    },
    async ({ file_path, nozzle_diameter }) => {
      try {
        if (!existsSync(file_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Fichier non trouvé : ${file_path}` }],
          };
        }

        console.error(`[check_printability] Analyzing ${file_path}...`);
        const mesh = await parseModel(file_path);
        const analysis = analyzeMesh(mesh);
        const report = detectPrintIssues(mesh.triangles, analysis, nozzle_diameter);

        const lines: string[] = [
          `## Rapport de printabilité`,
          `**Score** : ${report.score}/100`,
          `**Verdict** : ${report.summary}`,
          `**Buse** : ${nozzle_diameter}mm`,
          "",
        ];

        if (report.issues.length === 0) {
          lines.push("Aucun problème détecté. La pièce est prête à imprimer.");
        } else {
          // Group by severity
          const errors = report.issues.filter((i) => i.severity === "error");
          const warnings = report.issues.filter((i) => i.severity === "warning");
          const infos = report.issues.filter((i) => i.severity === "info");

          if (errors.length > 0) {
            lines.push("### Erreurs critiques");
            for (const issue of errors) {
              lines.push(`- **[${issue.category}]** ${issue.message}`);
              if (issue.detail) lines.push(`  _${issue.detail}_`);
            }
            lines.push("");
          }

          if (warnings.length > 0) {
            lines.push("### Avertissements");
            for (const issue of warnings) {
              lines.push(`- **[${issue.category}]** ${issue.message}`);
              if (issue.detail) lines.push(`  _${issue.detail}_`);
            }
            lines.push("");
          }

          if (infos.length > 0) {
            lines.push("### Informations");
            for (const issue of infos) {
              lines.push(`- **[${issue.category}]** ${issue.message}`);
              if (issue.detail) lines.push(`  _${issue.detail}_`);
              if (issue.bibleFdmRef) lines.push(`  _Bible FDM: ${issue.bibleFdmRef}_`);
            }
          }
        }

        // Bible FDM diagnostic hints
        if (report.diagnosticHints && report.diagnosticHints.length > 0) {
          lines.push("");
          lines.push("### Diagnostic Bible FDM");
          for (const hint of report.diagnosticHints) {
            lines.push(`**${hint.defect}**`);
            lines.push(`  Causes probables : ${hint.causes.join(", ")}`);
            lines.push(`  Actions recommandées :`);
            for (const fix of hint.fixes) {
              lines.push(`  - ${fix}`);
            }
            lines.push("");
          }
        }

        return {
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
