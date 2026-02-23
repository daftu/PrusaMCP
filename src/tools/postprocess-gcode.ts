import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, basename, join } from "node:path";

export function registerPostprocessGcode(server: McpServer) {
  server.registerTool(
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
      try {
        if (!existsSync(gcode_path)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Fichier non trouvé : ${gcode_path}` }],
          };
        }

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

        if (layerPositions.size === 0) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: `Aucun marqueur de couche trouvé dans le G-code. ` +
                `Le fichier a-t-il été généré par PrusaSlicer ou Cura ?`,
            }],
          };
        }

        // Sort actions by layer (descending) to insert from bottom to top
        const sortedActions = [...actions].sort((a, b) => b.layer - a.layer);
        const insertions: string[] = [];

        for (const action of sortedActions) {
          const lineIndex = layerPositions.get(action.layer);
          if (lineIndex === undefined) {
            insertions.push(`Couche ${action.layer} non trouvée (max: ${layerPositions.size})`);
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

        // Write output
        const outPath = output_path ??
          join(dirname(gcode_path), basename(gcode_path).replace(".gcode", "_modified.gcode"));

        await writeFile(outPath, lines.join("\n"), "utf-8");

        const resultLines = [
          `## G-code modifié`,
          `**Fichier** : ${outPath}`,
          `**Couches totales** : ${layerPositions.size}`,
          `**Actions insérées** : ${insertions.length}`,
          "",
          ...insertions.map((s) => `- ${s}`),
        ];

        return {
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
      }
    },
  );
}
