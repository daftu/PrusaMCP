import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { analyzeModel } from "../model-analysis.js";
import { detectPrintIssues } from "../print-issues.js";
import { suggestOrientation } from "../orientation.js";
import { recommendProfile } from "../profile-engine.js";
import { estimateCostFromMesh } from "../cost-estimator.js";
import { profileToIniSettings, serializeIni } from "../ini-writer.js";

export function registerPrintWizard(server: McpServer) {
  registerContractTool(server,
    "print_wizard",
    {
      title: "Assistant d'impression complet",
      description:
        "Analyse complète d'un modèle 3D avec recommandations. " +
        "Retourne : analyse mesh, problèmes détectés, meilleure orientation, " +
        "profil recommandé, estimation de coût, et questions à poser à l'utilisateur " +
        "pour affiner les paramètres. Idéal comme point d'entrée pour un nouveau print.",
      inputSchema: {
        file_path: z.string().describe("Chemin absolu vers le fichier STL ou 3MF"),
        printer: z.string().optional().describe("Imprimante (si connue)"),
        nozzle: z.number().optional().describe("Buse en mm (si connue)"),
        material: z.string().optional().describe("Matériau (si connu)"),
        goal: z.string().optional().describe("Objectif (si connu)"),
      },
    },
    async ({ file_path, printer, nozzle, material, goal }) => {
      try {
        if (!existsSync(file_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Fichier non trouvé : ${file_path}` }],
          };
        }

        console.error(`[print_wizard] Full analysis of ${file_path}...`);
        const {mesh, analysis, evidence} = await analyzeModel(file_path);
        const issues = detectPrintIssues(mesh.triangles, analysis, nozzle ?? 0.4);
        const orientations = suggestOrientation(mesh);
        const bestOrientation = orientations[0];

        const bb = analysis.boundingBox;
        const lines: string[] = [];

        // ─── Section 1: Analyse mesh ──────────────────
        lines.push("## 1. Analyse du modèle");
        lines.push(`- **Dimensions** : ${bb.size.x.toFixed(1)} × ${bb.size.y.toFixed(1)} × ${bb.size.z.toFixed(1)} mm`);
        lines.push(`- **Source mesh volume (not sliced consumption)** : ${(analysis.volume / 1000).toFixed(2)} cm³`);
        lines.push(`- **Triangles** : ${analysis.triangleCount.toLocaleString()}`);
        lines.push(`- **Manifold** : ${analysis.isManifold ? "OK" : "NON — repair nécessaire"}`);
        lines.push("");

        // ─── Section 2: Printabilité ──────────────────
        lines.push(`## 2. Printabilité : ${issues.score}/100`);
        lines.push(`_${issues.summary}_`);
        if (issues.issues.length > 0) {
          for (const issue of issues.issues) {
            const icon = issue.severity === "error" ? "ERREUR" : issue.severity === "warning" ? "ATTENTION" : "INFO";
            lines.push(`- **[${icon}] ${issue.category}** : ${issue.message}`);
          }
        }
        lines.push("");

        // ─── Section 3: Orientation ───────────────────
        lines.push("## 3. Orientation recommandée");
        lines.push(`**${bestOrientation.name}** (score ${bestOrientation.score}/100)`);
        lines.push(`- Overhangs : ${bestOrientation.overhangPercent.toFixed(1)}% | Hauteur : ${bestOrientation.printHeight.toFixed(1)}mm | Contact : ${bestOrientation.bedContact.toFixed(1)}mm²`);
        if (bestOrientation.rotation.axisX !== 0 || bestOrientation.rotation.axisY !== 0) {
          lines.push(`- _Rotation : X=${bestOrientation.rotation.axisX}° Y=${bestOrientation.rotation.axisY}°_`);
        }
        lines.push("");

        // ─── Section 4: Profil si infos disponibles ──
        let wizardProfile: ReturnType<typeof recommendProfile> | undefined;
        let wizardCost: ReturnType<typeof estimateCostFromMesh> | undefined;
        if (goal && material) {
          const p = printer ?? "Generic";
          const n = nozzle ?? 0.4;
          const profile = recommendProfile(p, n, goal, material, analysis);

          wizardProfile = profile;
          lines.push(`## 4. Profil recommandé (${profile.goal})`);
          const keySettings = [
            `Layer : ${profile.settings.layer_height.value}mm`,
            `Vitesse : ${profile.settings.print_speed.value}mm/s`,
            `MVS : ${profile.settings.max_volumetric_speed.value}mm³/s`,
            `Infill : ${profile.settings.infill_density.value}%`,
            `Périmètres : ${profile.settings.perimeters.value}`,
            `Buse : ${profile.settings.nozzle_temperature.value}°C`,
            `Plateau : ${profile.settings.bed_temperature.value}°C`,
            `Supports : ${profile.settings.support_material.value ? "Oui" : "Non"}`,
          ];
          lines.push(keySettings.join(" | "));

          // Estimation de coût
          const cost = estimateCostFromMesh(
            analysis,
            profile.settings.layer_height.value as number,
            profile.settings.infill_density.value as number,
            profile.settings.perimeters.value as number,
            profile.settings.print_speed.value as number,
            material,
          );
          wizardCost = cost;
          lines.push(`**Temps estimé** : ${cost.printTimeFormatted} | **Coût** : ~${cost.totalCostEur}€ (${cost.filamentWeightG}g de filament)`);
          lines.push("");
        }

        // ─── Section 5: Questions QCM ─────────────────
        lines.push("## 5. Questions pour affiner");
        lines.push("_Pour optimiser les paramètres, demande à l'utilisateur :_");
        lines.push("");

        // Questions dynamiques basées sur l'analyse
        const questions: Array<{ question: string; options: string[] }> = [];

        if (!goal) {
          questions.push({
            question: "Quel est l'objectif de cette impression ?",
            options: [
              "Prototype rapide (vite fait, qualité secondaire)",
              "Standard (bon compromis qualité/temps)",
              "Haute qualité (beau rendu, détails fins)",
              "Solide / structurel (résistance mécanique)",
              "Le plus rapide possible",
            ],
          });
        }

        if (!material) {
          questions.push({
            question: "Quel matériau vas-tu utiliser ?",
            options: ["PLA", "PETG", "ABS", "TPU (flexible)", "Autre"],
          });
        }

        if (analysis.overhangPercent > 5) {
          questions.push({
            question: `Le modèle a ${analysis.overhangPercent.toFixed(0)}% d'overhangs. Tu veux des supports ?`,
            options: [
              "Oui, supports partout",
              "Oui, uniquement où c'est nécessaire",
              "Non, je tente sans (risqué)",
              "Réorienter la pièce pour éviter les supports",
            ],
          });
        }

        if (bb.size.z > 2 * Math.max(bb.size.x, bb.size.y) || analysis.overhangPercent < 2) {
          questions.push({
            question: "Tu veux un brim pour l'adhésion au plateau ?",
            options: [
              "Oui, brim 5mm (recommandé pour cette pièce)",
              "Non, pas de brim",
              "Raft complet (adhésion maximale)",
            ],
          });
        }

        if (!nozzle) {
          questions.push({
            question: "Quelle buse est montée sur ton imprimante ?",
            options: ["0.4mm (standard)", "0.5mm", "0.6mm", "0.8mm", "1.0mm"],
          });
        }

        for (const q of questions) {
          lines.push(`**${q.question}**`);
          for (let i = 0; i < q.options.length; i++) {
            lines.push(`  ${i + 1}. ${q.options[i]}`);
          }
          lines.push("");
        }

        if (questions.length === 0) {
          lines.push("_Toutes les infos nécessaires sont disponibles. Prêt à générer la config !_");
        }

        return {
          resultStatus: evidence.coverage === "partial" ? "partial" : "confirmed",
          warnings: evidence.warnings,
          data: {evidence,analysis,report:issues,orientations,profile:wizardProfile,cost:wizardCost,questions},
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur wizard : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
