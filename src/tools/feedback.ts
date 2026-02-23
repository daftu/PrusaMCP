import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  addFeedback,
  loadFeedback,
  computeStats,
  learnFromFeedback,
  type PrintFeedback,
} from "../feedback-store.js";
import {
  exportForCommunity,
  loadCommunityData,
  getCommunityInsight,
} from "../community-store.js";

// ─── Submit Feedback ─────────────────────────────────────────

export function registerSubmitFeedback(server: McpServer) {
  server.registerTool(
    "submit_feedback",
    {
      title: "Noter un print",
      description:
        "Enregistre un retour après impression. Note la qualité, l'adhésion, la solidité, " +
        "et les problèmes rencontrés. Ces données améliorent les futures recommandations " +
        "et peuvent être partagées anonymement avec la communauté.",
      inputSchema: {
        model_name: z.string().describe("Nom du modèle imprimé"),
        material: z.string().describe("Matériau utilisé (PLA, PETG, ABS...)"),
        printer: z.string().describe("Nom de l'imprimante"),
        nozzle: z.number().describe("Diamètre de buse en mm"),
        goal: z.string().describe("Objectif utilisé (draft, standard, quality, strong)"),
        layer_height: z.number().describe("Hauteur de couche utilisée en mm"),
        infill_percent: z.number().describe("Pourcentage de remplissage"),
        perimeters: z.number().int().describe("Nombre de périmètres"),
        print_speed: z.number().describe("Vitesse d'impression en mm/s"),
        nozzle_temp: z.number().describe("Température buse en °C"),
        bed_temp: z.number().describe("Température plateau en °C"),
        support_used: z.boolean().describe("Supports utilisés ?"),
        brim_used: z.boolean().describe("Brim utilisé ?"),
        quality_score: z.number().min(1).max(5).describe("Qualité de surface (1=terrible, 5=parfait)"),
        adhesion_score: z.number().min(1).max(5).describe("Adhésion au plateau (1=décollé, 5=parfait)"),
        strength_score: z.number().min(1).max(5).describe("Solidité perçue (1=fragile, 5=incassable)"),
        overall_score: z.number().min(1).max(5).describe("Satisfaction globale (1=raté, 5=parfait)"),
        issues: z
          .array(z.string())
          .default([])
          .describe(
            "Problèmes rencontrés : warping, stringing, under-extrusion, over-extrusion, " +
            "layer-shift, ringing, blobs, elephants-foot, cracking, poor-bridging, clogging"
          ),
        notes: z.string().default("").describe("Notes libres sur l'impression"),
      },
    },
    async (params) => {
      try {
        const feedback: PrintFeedback = {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          modelName: params.model_name,
          material: params.material,
          printer: params.printer,
          nozzle: params.nozzle,
          goal: params.goal,
          layerHeight: params.layer_height,
          infillPercent: params.infill_percent,
          perimeters: params.perimeters,
          printSpeed: params.print_speed,
          nozzleTemp: params.nozzle_temp,
          bedTemp: params.bed_temp,
          supportUsed: params.support_used,
          brimUsed: params.brim_used,
          qualityScore: params.quality_score,
          adhesionScore: params.adhesion_score,
          strengthScore: params.strength_score,
          overallScore: params.overall_score,
          issues: params.issues,
          notes: params.notes,
          success: params.overall_score >= 3,
        };

        await addFeedback(feedback);

        // Get community insight for context
        const community = await loadCommunityData();
        const insight = getCommunityInsight(
          community,
          params.material,
          params.goal,
          params.nozzle,
        );

        const lines = [
          "## Feedback enregistré",
          `**Modèle** : ${params.model_name} | **Score** : ${params.overall_score}/5`,
          `**ID** : ${feedback.id}`,
          "",
        ];

        if (params.issues.length > 0) {
          lines.push(`**Problèmes signalés** : ${params.issues.join(", ")}`);
        }

        // Learn and suggest
        const allFeedback = await loadFeedback();
        const adjustments = learnFromFeedback(allFeedback, params.material, params.printer);
        if (adjustments.warnings.length > 0) {
          lines.push("");
          lines.push("### Apprentissage automatique");
          lines.push("_Basé sur ton historique de prints :_");
          for (const w of adjustments.warnings) {
            lines.push(`- ${w}`);
          }
        }

        if (insight.hasData && insight.sampleCount > 0) {
          lines.push("");
          lines.push(`### Données communautaires (${insight.sampleCount} prints similaires)`);
          if (insight.communityScore) {
            lines.push(`- Score moyen communauté : ${insight.communityScore.toFixed(1)}/5`);
          }
          if (insight.commonIssues.length > 0) {
            lines.push(`- Problèmes fréquents : ${insight.commonIssues.join(", ")}`);
          }
        }

        lines.push("");
        lines.push("_Ce feedback sera utilisé pour améliorer les recommandations futures._");
        lines.push("_Utilise `export_feedback` pour partager anonymement avec la communauté._");

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

// ─── Feedback Stats ──────────────────────────────────────────

export function registerFeedbackStats(server: McpServer) {
  server.registerTool(
    "feedback_stats",
    {
      title: "Statistiques de prints",
      description:
        "Affiche les statistiques de tes impressions : taux de réussite, " +
        "score moyen, problèmes fréquents, et meilleurs paramètres par matériau. " +
        "Combine tes données locales et les données communautaires.",
      inputSchema: {
        material: z.string().optional().describe("Filtrer par matériau"),
      },
    },
    async ({ material }) => {
      try {
        let feedbacks = await loadFeedback();
        if (material) {
          feedbacks = feedbacks.filter(
            (f) => f.material.toUpperCase() === material.toUpperCase(),
          );
        }

        const stats = computeStats(feedbacks);
        const community = await loadCommunityData();

        const lines = [
          "## Statistiques d'impression",
          "",
        ];

        if (stats.totalPrints === 0) {
          lines.push("Aucun print enregistré. Utilise `submit_feedback` après une impression.");
          lines.push("");
          lines.push(`### Données communautaires (${community.totalPrints} prints)`);
          if (community.insights.bestPractices.length > 0) {
            lines.push("**Bonnes pratiques :**");
            for (const bp of community.insights.bestPractices) {
              lines.push(`- ${bp.recommendation} _(confiance: ${Math.round(bp.confidence * 100)}%)_`);
            }
          }
        } else {
          lines.push(`**Total prints** : ${stats.totalPrints}`);
          lines.push(`**Taux de réussite** : ${stats.successRate.toFixed(0)}%`);
          lines.push(`**Score qualité moyen** : ${stats.avgQuality.toFixed(1)}/5`);
          lines.push(`**Score adhésion moyen** : ${stats.avgAdhesion.toFixed(1)}/5`);
          lines.push(`**Score solidité moyen** : ${stats.avgStrength.toFixed(1)}/5`);
          lines.push("");

          if (stats.commonIssues.length > 0) {
            lines.push("### Problèmes fréquents");
            for (const issue of stats.commonIssues.slice(0, 5)) {
              lines.push(`- **${issue.issue}** : ${issue.count}× (${issue.percent.toFixed(0)}% des prints)`);
            }
            lines.push("");
          }

          if (stats.bestSettings.length > 0) {
            lines.push("### Meilleurs paramètres par matériau");
            for (const s of stats.bestSettings) {
              lines.push(`- **${s.material}** : layer ${s.layerHeight}mm → score ${s.avgScore}/5 (${s.count} prints)`);
            }
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

// ─── Export for Community ────────────────────────────────────

export function registerExportFeedback(server: McpServer) {
  server.registerTool(
    "export_feedback",
    {
      title: "Exporter le feedback pour la communauté",
      description:
        "Exporte tes retours d'impression de manière anonymisée pour contribuer " +
        "à la base de connaissances communautaire. Supprime les chemins de fichiers " +
        "et généralise le nom d'imprimante. Le JSON résultant peut être partagé " +
        "via GitHub PR ou autre canal.",
      inputSchema: {},
    },
    async () => {
      try {
        const feedbacks = await loadFeedback();

        if (feedbacks.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "Aucun feedback à exporter. Imprime d'abord et note tes résultats !",
            }],
          };
        }

        const anonymized = exportForCommunity(feedbacks);
        const exportData = {
          exportDate: new Date().toISOString().split("T")[0],
          printCount: anonymized.length,
          data: anonymized,
        };

        const json = JSON.stringify(exportData, null, 2);

        const lines = [
          "## Export communautaire prêt",
          `**Prints exportés** : ${anonymized.length}`,
          "",
          "Données anonymisées (pas de chemins, pas de noms exacts) :",
          "",
          "```json",
          json,
          "```",
          "",
          "Pour contribuer :",
          "1. Copie le JSON ci-dessus",
          "2. Ouvre une PR sur le repo PrusaMCP",
          "3. Ajoute tes données dans `community-contributions/`",
          "",
          "_Merci de contribuer à l'amélioration des recommandations pour tout le monde !_",
        ];

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
