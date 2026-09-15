import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { dirname, basename, resolve, join } from "node:path";
import { stat } from "node:fs/promises";
import { assertOutputAvailable, createArtifactStage, publishArtifact, removeArtifactStage } from "../artifacts.js";
import type { PrusaConfig } from "../types.js";
import { runPrusaSlicer, parseGCodeStats } from "../prusa-cli.js";
import { recommendProfile } from "../profile-engine.js";
import { writeRawIniFile, profileToIniSettings } from "../ini-writer.js";
import { analyzeModel } from "../model-analysis.js";

export function registerSlice(server: McpServer, config: PrusaConfig, runner = runPrusaSlicer) {
  registerContractTool(server,
    "slice_prusaslicer",
    {
      title: "Slicer un modèle 3D avec PrusaSlicer",
      description:
        "Slice un fichier STL/3MF avec PrusaSlicer CLI et retourne le G-code + statistiques. " +
        "Peut utiliser un fichier .ini existant ou générer une config depuis une intention.",
      inputSchema: z.object({
        stl_path: z.string().describe("Chemin absolu vers le fichier STL ou 3MF"),
        config_path: z.string().optional().describe("Chemin vers un fichier .ini PrusaSlicer existant"),
        output_gcode: z.string().optional().describe("Chemin de sortie pour le G-code"),
        trusted_script_id: z.string().optional().describe("ID du script autorisé dans la configuration serveur"),
        // Alternative: generate config from intent
        goal: z.string().optional().describe("Si pas de config_path : intention pour générer un profil auto"),
        printer: z.string().optional().describe("Nom de l'imprimante (pour génération auto)"),
        nozzle: z.number().optional().describe("Diamètre de buse (pour génération auto)"),
        material: z.string().optional().describe("Matériau (pour génération auto)"),
      }).strict(),
    },
    async ({ stl_path, config_path, output_gcode, goal, printer, nozzle, material, trusted_script_id }) => {
      let stage: { directory: string; path: string } | undefined;
      const policy = trusted_script_id === undefined ? "disabled" : `trusted:${trusted_script_id}`;
      try {
        if (trusted_script_id !== undefined && !Object.hasOwn(config.trustedScripts ?? {}, trusted_script_id)) {
          throw new Error("unknown_trusted_script: Unknown trusted_script_id");
        }
        if (!config.executablePath) {
          throw new Error("spawn_failed: PrusaSlicer non trouvé. Installe PrusaSlicer ou configure PRUSASLICER_PATH.");
        }
        if (!existsSync(stl_path)) {
          throw new Error(`input_missing: Fichier non trouvé : ${stl_path}`);
        }

        const gcodePath = resolve(output_gcode ?? resolve(dirname(stl_path), basename(stl_path).replace(/\.[^.]+$/, ".gcode")));
        await assertOutputAvailable(gcodePath);
        stage = await createArtifactStage(gcodePath);
        let iniPath = config_path;
        let model: Awaited<ReturnType<typeof analyzeModel>> | undefined;

        // If no config provided but goal is given, generate one
        if (!iniPath && goal) {
          console.error("[slice] Generating config from intent...");

          model = await analyzeModel(stl_path);
          const meshAnalysis = model.analysis;

          const profile = recommendProfile(
            printer ?? "Generic",
            nozzle ?? 0.4,
            goal,
            material ?? "PLA",
            meshAnalysis,
          );

          const settings = profileToIniSettings(profile);
          iniPath = join(stage.directory, "generated.ini");
          await writeRawIniFile(settings, iniPath);
          console.error(`[slice] Generated config at: ${iniPath}`);
        }

        // Build CLI args
        const args: string[] = ["--export-gcode"];

        if (iniPath) {
          args.push("--load", iniPath);
        }

        args.push("--output", stage.path);
        args.push(resolve(stl_path));

        const result = await runner(config, args, undefined, trusted_script_id);
        if (result.exitCode !== 0) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `${result.errorCode ?? "process_failed"}: Slicing échoué (exit code ${result.exitCode}).\n${result.stderr || result.stdout}\nPost-process policy: ${policy}` }],
          };
        }
        const output = await stat(stage.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (!output?.isFile() || output.size === 0) {
          throw new Error(`output_missing: CLI exit code 0 without a nonempty output file\n${result.stderr || result.stdout}`);
        }
        await publishArtifact(stage.path, gcodePath);

        // Parse G-code stats
        let statsText = "";
        let stats: Awaited<ReturnType<typeof parseGCodeStats>> = {};
        if (existsSync(gcodePath)) {
          try {
            stats = await parseGCodeStats(gcodePath);
            statsText = [
              stats.estimatedTime ? `**Temps estimé** : ${stats.estimatedTime}` : null,
              stats.filamentUsedG ? `**Filament** : ${stats.filamentUsedG}g` : null,
              stats.filamentUsedMm ? `**Longueur filament** : ${stats.filamentUsedMm}mm` : null,
              stats.filamentCost != null ? `**Coût estimé** : ${stats.filamentCost}€` : null,
              stats.layerCount ? `**Couches** : ${stats.layerCount}` : null,
            ]
              .filter(Boolean)
              .join("\n");
          } catch {
            statsText = "(Impossible de parser les statistiques G-code)";
          }
        }

        const lines = [
          `## Slicing terminé`,
          `**G-code** : ${gcodePath}`,
          `**Exit code** : 0`,
          `**Post-process policy** : ${policy}`,
          "",
          statsText || "(Pas de statistiques disponibles)",
        ];

        if (result.stderr && !result.stderr.includes("Done")) {
          lines.push("", "### Warnings", "```", result.stderr.trim(), "```");
        }

        return {
          warnings: model?.evidence.warnings ?? [],
          data: {auto_config_evidence:model?.evidence,artifact:{path:gcodePath,media_type:"text/x.gcode"},exit_code:0,stats,post_process_policy:policy},
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur de slicing : ${error instanceof Error ? error.message : String(error)}\nPost-process policy: ${policy}`,
          }],
        };
      } finally {
        if (stage) await removeArtifactStage(stage.directory);
      }
    },
  );
}
