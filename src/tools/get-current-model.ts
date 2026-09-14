import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, extname, basename } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { PrusaConfig } from "../types.js";
import { getMacWindow } from "../macos.js";
import { parseStl } from "../stl-parser.js";
import { analyzeMesh } from "../mesh-analyzer.js";

// ─── PrusaSlicer Window Title Detection ──────────────────────

/**
 * Read the PrusaSlicer window title via PowerShell.
 * The title shows the current file: "filename.stl - PrusaSlicer-2.9.x based on Slic3r"
 * Or "*Sans titre - PrusaSlicer..." if no file is saved.
 */
function getPrusaSlicerWindowTitle(windowId?: number): Promise<string | null> {
  if (process.platform === "darwin") return getMacWindow(windowId).then(w => w.title);
  if (process.platform !== "win32") throw new Error("Window detection is supported on macOS and Windows only.");
  return new Promise((resolve) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Get-Process -Name 'prusa-slicer' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty MainWindowTitle",
      ],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout?.trim()) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

/**
 * Extract the filename from PrusaSlicer's window title.
 * Formats:
 *   "filename.stl - PrusaSlicer-2.9.4 basé sur Slic3r"
 *   "*filename.stl - PrusaSlicer-2.9.4 basé sur Slic3r"  (modified)
 *   "*Sans titre - PrusaSlicer-2.9.4 basé sur Slic3r"    (untitled)
 */
export function extractFilenameFromTitle(title: string): string | null {
  // Remove the " - PrusaSlicer..." suffix
  const dashIndex = title.indexOf(" - PrusaSlicer");
  if (dashIndex === -1) return null;

  let name = title.substring(0, dashIndex).trim();

  // Remove leading * (unsaved changes marker)
  if (name.startsWith("*")) name = name.substring(1);

  // Check if it's "Sans titre" / "Untitled"
  if (/^sans titre$/i.test(name) || /^untitled$/i.test(name)) {
    return null;
  }

  return name;
}

// ─── File Search ─────────────────────────────────────────────

/**
 * Search for a file by name across common directories.
 */
async function findFileByName(
  fileName: string,
  searchDirs: string[],
): Promise<string | null> {
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;

    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (entry.toLowerCase() === fileName.toLowerCase()) {
          return join(dir, entry);
        }
      }
      if (!extname(fileName)) {
        const candidates = entries.filter(entry =>
          [".3mf", ".stl", ".obj"].includes(extname(entry).toLowerCase()) &&
          basename(entry, extname(entry)).toLowerCase() === fileName.toLowerCase());
        if (candidates.length === 1) return join(dir, candidates[0]);
        // Never guess between saved files with the same project stem.
        if (candidates.length > 1) return null;
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return null;
}

/**
 * Find the most recently modified STL/3MF files in a directory.
 */
async function findRecentModels(
  dir: string,
  limit: number = 5,
): Promise<Array<{ path: string; mtime: Date }>> {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir);
  const models: Array<{ path: string; mtime: Date }> = [];

  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (ext !== ".stl" && ext !== ".3mf" && ext !== ".obj") continue;

    const fullPath = join(dir, entry);
    try {
      const stats = await stat(fullPath);
      models.push({ path: fullPath, mtime: stats.mtime });
    } catch {
      // skip
    }
  }

  models.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  return models.slice(0, limit);
}

// ─── PrusaSlicer.ini State ───────────────────────────────────

interface PrusaSlicerState {
  skeinDirectory: string | null;
  currentPrinter: string | null;
  currentFilament: string | null;
  currentPrintProfile: string | null;
}

async function readPrusaSlicerState(profilesDir: string): Promise<PrusaSlicerState> {
  const iniPath = join(profilesDir, "PrusaSlicer.ini");
  if (!existsSync(iniPath)) {
    return { skeinDirectory: null, currentPrinter: null, currentFilament: null, currentPrintProfile: null };
  }

  const content = await readFile(iniPath, "utf-8");
  const state: PrusaSlicerState = {
    skeinDirectory: null,
    currentPrinter: null,
    currentFilament: null,
    currentPrintProfile: null,
  };

  const skeinMatch = content.match(/skein_directory\s*=\s*(.+)/);
  if (skeinMatch) state.skeinDirectory = skeinMatch[1].trim();

  const printerMatch = content.match(/^printer\s*=\s*(.+)$/m);
  if (printerMatch) state.currentPrinter = printerMatch[1].trim();

  const filamentMatch = content.match(/^filament\s*=\s*(.+)$/m);
  if (filamentMatch) state.currentFilament = filamentMatch[1].trim();

  const printMatch = content.match(/^print\s*=\s*(.+)$/m);
  if (printMatch) state.currentPrintProfile = printMatch[1].trim();

  return state;
}

// ─── Tool Registration ───────────────────────────────────────

export function registerGetCurrentModel(server: McpServer, config: PrusaConfig) {
  server.registerTool(
    "get_current_model",
    {
      title: "Voir le modèle ouvert dans PrusaSlicer",
      description:
        "Détecte le fichier actuellement ouvert dans PrusaSlicer en lisant le titre de la fenêtre. " +
        "Retourne le chemin du fichier, les presets actifs (imprimante, filament, profil), " +
        "et une analyse du STL enregistré. Les presets proviennent du disque, pas des modifications actives non enregistrées.",
      inputSchema: {
        window_id: z.number().int().positive().optional().describe("macOS window ID; required when multiple PrusaSlicer project windows are open"),
        analyze: z
          .boolean()
          .default(true)
          .describe("Lancer l'analyse mesh automatiquement"),
      },
    },
    async ({ analyze, window_id }) => {
      try {
        const lines: string[] = [];

        // 1. Read PrusaSlicer state from ini
        let state: PrusaSlicerState = {
          skeinDirectory: null,
          currentPrinter: null,
          currentFilament: null,
          currentPrintProfile: null,
        };
        if (config.profilesDir) {
          state = await readPrusaSlicerState(config.profilesDir);
        }

        // 2. Get window title to find current file
        const windowTitle = await getPrusaSlicerWindowTitle(window_id);

        if (!windowTitle) {
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text: "PrusaSlicer ne semble pas être ouvert. Lance PrusaSlicer et charge un modèle.",
            }],
          };
        }

        lines.push("## État PrusaSlicer");
        lines.push(`**Fenêtre** : ${windowTitle}`);
        lines.push("**Source des presets** : PrusaSlicer.ini enregistré sur disque; peut différer des réglages actifs. Les modifications non enregistrées et les overrides objet/modificateur ne sont pas lus.");
        if (windowTitle.startsWith("*")) lines.push("**Attention** : le titre signale des modifications non enregistrées. Le fichier disque ne représente pas nécessairement le projet actuel.");
        lines.push(`**Imprimante** : ${state.currentPrinter || "non définie"}`);
        lines.push(`**Filament** : ${state.currentFilament || "non défini"}`);
        lines.push(`**Profil** : ${state.currentPrintProfile || "non défini"}`);
        lines.push("");

        // 3. Extract filename from window title
        const fileName = extractFilenameFromTitle(windowTitle);

        if (!fileName) {
          lines.push("**Modèle** : Aucun nom de fichier détectable dans le titre; un projet non enregistré peut contenir des objets.");
          lines.push("");
          lines.push("_Charge un fichier STL/3MF dans PrusaSlicer pour que je puisse l'analyser._");
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        lines.push(`## Fichier détecté : ${fileName}`);

        // 4. Search for the file on disk
        const home = homedir();
        const searchDirs = [
          state.skeinDirectory,
          join(home, "Downloads"),
          join(home, "Bureau"),
          join(home, "Desktop"),
          join(home, "Documents"),
          join(home, "OneDrive", "Bureau"),
          join(home, "OneDrive", "Documents"),
          join(home, "OneDrive", "Downloads"),
        ].filter(Boolean) as string[];

        const filePath = await findFileByName(fileName, searchDirs);

        if (!filePath) {
          lines.push(`**Chemin** : Fichier "${fileName}" introuvable dans les dossiers habituels.`);
          lines.push(`Dossiers cherchés : ${searchDirs.join(", ")}`);
          lines.push("");
          lines.push("_Donne-moi le chemin complet pour que je puisse l'analyser._");
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        lines.push(`**Chemin** : ${filePath}`);

        // 5. Get file stats
        try {
          const fileStats = await stat(filePath);
          const sizeMB = (fileStats.size / 1024 / 1024).toFixed(2);
          lines.push(`**Taille** : ${sizeMB} MB`);
          lines.push(`**Modifié** : ${fileStats.mtime.toLocaleString()}`);
        } catch { /* skip */ }

        lines.push("");

        // 6. Analyze mesh if STL
        if (analyze && filePath.toLowerCase().endsWith(".stl")) {
          console.error(`[get_current_model] Analyzing: ${filePath}`);
          const stl = await parseStl(filePath);
          const analysis = analyzeMesh(stl);
          const bb = analysis.boundingBox;

          lines.push("## Analyse Mesh");
          lines.push(`**Dimensions** : ${bb.size.x.toFixed(2)} × ${bb.size.y.toFixed(2)} × ${bb.size.z.toFixed(2)} mm`);
          lines.push(`**Volume** : ${analysis.volume.toFixed(2)} mm³ (${(analysis.volume / 1000).toFixed(2)} cm³)`);
          lines.push(`**Surface** : ${analysis.surfaceArea.toFixed(2)} mm²`);
          lines.push(`**Triangles** : ${analysis.triangleCount.toLocaleString()}`);
          lines.push("");
          lines.push(`**Overhangs** : ${analysis.overhangPercent.toFixed(1)}%${analysis.overhangPercent > 5 ? " — supports recommandés" : " — OK, pas de support nécessaire"}`);
          lines.push(`**Manifold** : ${analysis.isManifold ? "OK (mesh fermé)" : "NON — " + analysis.nonManifoldEdges + " arêtes problématiques, repair recommandé"}`);
          lines.push(`**Détails fins** : ${analysis.hasSmallDetails ? "Oui (" + analysis.smallDetailPercent.toFixed(1) + "% de petits triangles)" : "Non"}`);
          lines.push("");
        } else if (filePath.toLowerCase().endsWith(".3mf")) {
          lines.push("_Fichier 3MF détecté — l'analyse mesh n'est disponible que pour les STL pour l'instant._");
        }

        // 7. Other recent files in same directory
        const dir = state.skeinDirectory || join(filePath, "..");
        const recentModels = await findRecentModels(dir);
        const others = recentModels.filter((m) => basename(m.path) !== basename(filePath));
        if (others.length > 0) {
          lines.push("## Autres fichiers dans le dossier");
          for (const m of others) {
            lines.push(`- ${basename(m.path)} (${m.mtime.toLocaleString()})`);
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
