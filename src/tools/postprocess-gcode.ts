import { registerContractTool } from "../register-tool.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, basename, join, resolve, extname } from "node:path";
import { assertOutputAvailable, createArtifactStage, publishArtifact, removeArtifactStage } from "../artifacts.js";

export function registerPostprocessGcode(server: McpServer) {
  registerContractTool(server,
    "postprocess_gcode",
    {
      title: "Post-traiter un G-code",
      description:
        "Modifie un fichier G-code existant pour insérer des actions : " +
        "pause à une couche, changement de filament (M600), changement de température, " +
        "ou commande custom. Crée un nouveau fichier sans écraser l'original.",
      inputSchema: {
        gcode_path: z.string().describe("Chemin du fichier G-code à modifier"),
        actions: z.array(z.object({
          layer: z.number().int().describe("Numéro de couche (commence à 1)"),
          type: z
            .enum(["pause", "color_change", "temperature", "custom"])
            .describe("Type d'action"),
          value: z
            .string()
            .optional()
            .describe("Valeur selon le type : température (ex: '220'), ou commande G-code custom"),
          comment: z.string().optional().describe("Commentaire optionnel dans le G-code"),
        })).describe("Liste d'actions à insérer"),
        output_path: z.string().optional().describe("Chemin de sortie (sinon _modified.gcode)"),
      },
    },
    async ({ gcode_path, actions, output_path }) => {
      let stage: { directory: string; path: string } | undefined;
      try {
        if (!existsSync(gcode_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Fichier non trouvé : ${gcode_path}` }],
          };
        }

        const inputPath = resolve(gcode_path);
        const name = basename(inputPath);
        const stem = name.slice(0, name.length - extname(name).length);
        const outPath = resolve(output_path ?? join(dirname(inputPath), `${stem}_modified.gcode`));
        if (outPath === inputPath) throw new Error("output_is_input: output_path must differ from gcode_path");
        // Existing entries include symlinks and hard links to the source.
        await assertOutputAvailable(outPath);

        const content = await readFile(gcode_path, "utf-8");
        const lines = content.split(/\r?\n/);

        // Find layer change markers in G-code
        // PrusaSlicer uses ";LAYER_CHANGE" or ";BEFORE_LAYER_CHANGE"
        const layerPositions = new Map<number, number>(); // layer number → line index
        let currentLayer = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          // PrusaSlicer format
          if (line === ";LAYER_CHANGE") {
            currentLayer++;
            layerPositions.set(currentLayer, i);
          }
          // Also check for ";LAYER:N" format (Cura)
          const layerMatch = line.match(/^;LAYER:(\d+)/);
          if (layerMatch) {
            currentLayer = parseInt(layerMatch[1], 10) + 1; // Cura is 0-indexed
            layerPositions.set(currentLayer, i);
          }
        }

        // Insert from the bottom; reverse ties so repeated splices preserve request order.
        const sortedActions = actions.map((action, index) => ({ ...action, index }))
          .sort((a, b) => b.layer - a.layer || b.index - a.index);
        const insertions: string[] = [];
        const skipped: string[] = [];

        for (const action of sortedActions) {
          const lineIndex = layerPositions.get(action.layer);
          if (lineIndex === undefined) {
            skipped.push(`Couche ${action.layer} non trouvée (max: ${layerPositions.size})`);
            continue;
          }

          let gcodeToInsert: string;
          const comment = action.comment ? ` ; ${action.comment}` : "";

          switch (action.type) {
            case "pause":
              gcodeToInsert = [
                `; === PAUSE at layer ${action.layer} (PrusaMCP) ===`,
                `M601${comment}`,  // PrusaSlicer pause
                `; === END PAUSE ===`,
              ].join("\n");
              break;

            case "color_change":
              gcodeToInsert = [
                `; === COLOR CHANGE at layer ${action.layer} (PrusaMCP) ===`,
                `M600${comment}`,  // Filament change
                `; === END COLOR CHANGE ===`,
              ].join("\n");
              break;

            case "temperature":
              const temp = action.value ?? "210";
              gcodeToInsert = [
                `; === TEMP CHANGE at layer ${action.layer} (PrusaMCP) ===`,
                `M104 S${temp}${comment}`,  // Set nozzle temp (no wait)
                `; === END TEMP CHANGE ===`,
              ].join("\n");
              break;

            case "custom":
              gcodeToInsert = [
                `; === CUSTOM at layer ${action.layer} (PrusaMCP) ===`,
                `${action.value ?? ""}${comment}`,
                `; === END CUSTOM ===`,
              ].join("\n");
              break;
          }

          // Insert after the layer marker
          lines.splice(lineIndex + 1, 0, gcodeToInsert);
          insertions.push(`${action.type} @ couche ${action.layer}`);
        }

        const changed = insertions.length > 0;
        if (changed) {
          stage = await createArtifactStage(outPath);
          await writeFile(stage.path, lines.join("\n"), { encoding: "utf-8", flag: "wx" });
          await publishArtifact(stage.path, outPath);
        }

        const partial = skipped.length > 0;
        const resultLines = [
          changed ? (partial ? "## G-code partiellement modifié" : "## G-code modifié") : "## Aucune modification",
          ...(changed ? [`**Fichier** : ${outPath}`] : []),
          `**Couches totales** : ${layerPositions.size}`,
          `**Actions insérées** : ${insertions.length}`,
          `**Actions ignorées** : ${skipped.length}`,
          "",
          ...insertions.map((s) => `- ${s}`),
          ...skipped.map((s) => `- ${s}`),
        ];

        return {
          structuredContent: {
            source: "file",
            coverage: partial ? "partial" : "complete",
            status: partial ? "partial" : "confirmed",
            warnings: skipped,
            data: {
              changed,
              inserted: insertions.length,
              skipped: skipped.length,
              ...(changed ? { output_path: outPath } : {}),
            },
          },
          content: [{ type: "text" as const, text: resultLines.join("\n") }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: `Erreur : ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      } finally {
        if (stage) await removeArtifactStage(stage.directory);
      }
    },
  );
}
