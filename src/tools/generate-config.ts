import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recommendProfile } from "../profile-engine.js";
import { writeRawIniFile, profileToIniSettings, serializeIni } from "../ini-writer.js";
import { analyzeModel } from "../model-analysis.js";

export function registerGenerateConfig(server: McpServer) {
  registerContractTool(server,
    "generate_prusaslicer_config",
    {
      title: "Générer un fichier config PrusaSlicer",
      description:
        "Génère un fichier .ini compatible PrusaSlicer à partir d'une intention ou de paramètres custom. " +
        "Le fichier peut être chargé directement avec --load dans PrusaSlicer.",
      inputSchema: {
        printer: z.string().default("Generic").describe("Nom de l'imprimante"),
        nozzle: z.number().default(0.4).describe("Diamètre de buse en mm"),
        goal: z.string().describe("Intention d'impression"),
        material: z.string().default("PLA").describe("Matériau"),
        stl_path: z.string().optional().describe("Chemin STL ou 3MF pour analyse auto"),
        output_path: z.string().optional().describe("Chemin de sortie pour le .ini (sinon fichier temporaire)"),
        custom_settings: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .optional()
          .describe("Paramètres custom PrusaSlicer à overrider (ex: {\"layer_height\": 0.15})"),
      },
    },
    async ({ printer, nozzle, goal, material, stl_path, output_path, custom_settings }) => {
      try {
        const model = stl_path ? await analyzeModel(stl_path) : undefined;
        const meshAnalysis = model?.analysis;

        // Generate recommendation
        const profile = recommendProfile(printer, nozzle, goal, material, meshAnalysis);
        const settings = profileToIniSettings(profile);

        // Apply custom overrides (preserve MVS if not explicitly set)
        if (custom_settings) {
          const hasMvs = "max_volumetric_speed" in custom_settings ||
                         "filament_max_volumetric_speed" in custom_settings;
          for (const [key, value] of Object.entries(custom_settings)) {
            settings[key] = value;
          }
          // Ensure MVS is always present — critical for PrusaSlicer speed limiting
          if (!hasMvs && !settings["filament_max_volumetric_speed"]) {
            settings["filament_max_volumetric_speed"] = settings["max_volumetric_speed"] ?? 15;
          }
        }

        // Determine output path
        const finalPath =
          output_path ??
          join(tmpdir(), `prusaslicer-${profile.goal}-${Date.now()}.ini`);

        await writeRawIniFile(settings, finalPath);

        // Also return the ini content as text for immediate use
        const iniContent = serializeIni(settings);

        const lines = [
          `## Config PrusaSlicer générée`,
          `**Fichier** : ${finalPath}`,
          `**Objectif** : ${profile.goal} | **Matériau** : ${profile.material} | **Buse** : ${profile.nozzle}mm`,
          "",
          "```ini",
          iniContent.trim(),
          "```",
          "",
          `Usage PrusaSlicer CLI :`,
          "```",
          `prusa-slicer-console.exe --load "${finalPath}" --export-gcode model.stl`,
          "```",
        ];

        return {
          warnings: model?.evidence.warnings ?? ["Generated settings are estimates; no resolved printer profile or toolpaths were validated."],
          resultStatus: model?.evidence.coverage === "partial" ? "partial" : "confirmed",
          data: {evidence:model?.evidence,artifact:{path:finalPath,media_type:"text/plain"},settings,ini:iniContent},
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur de génération : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    },
  );
}
