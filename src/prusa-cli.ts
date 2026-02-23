import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { PrusaConfig, CliResult, GCodeStats } from "./types.js";

const DEFAULT_TIMEOUT = 300_000; // 5 minutes

export function runPrusaSlicer(
  config: PrusaConfig,
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<CliResult> {
  if (!config.executablePath) {
    return Promise.resolve({
      exitCode: 1,
      stdout: "",
      stderr: "PrusaSlicer not found. Install PrusaSlicer or set PRUSASLICER_PATH.",
    });
  }

  return new Promise((resolve) => {
    execFile(
      config.executablePath,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        let exitCode = 0;
        if (error && "code" in error && typeof error.code === "number") {
          exitCode = error.code;
        } else if (error) {
          exitCode = 1;
        }
        resolve({
          exitCode,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });
}

/**
 * Parse G-code file for slicing statistics (embedded as comments by PrusaSlicer).
 */
export async function parseGCodeStats(gcodePath: string): Promise<GCodeStats> {
  const content = await readFile(gcodePath, "utf-8");
  const stats: GCodeStats = {};

  const timeMatch = content.match(
    /;\s*estimated printing time \(normal mode\)\s*=\s*(.+)/i,
  );
  if (timeMatch) {
    stats.estimatedTime = timeMatch[1].trim();
    stats.estimatedTimeSeconds = parseTimeToSeconds(timeMatch[1].trim());
  }

  const filamentMmMatch = content.match(
    /;\s*filament used \[mm\]\s*=\s*([\d.]+)/i,
  );
  if (filamentMmMatch) {
    stats.filamentUsedMm = parseFloat(filamentMmMatch[1]);
  }

  const filamentGMatch = content.match(
    /;\s*total filament used \[g\]\s*=\s*([\d.]+)/i,
  );
  if (filamentGMatch) {
    stats.filamentUsedG = parseFloat(filamentGMatch[1]);
  }

  const costMatch = content.match(
    /;\s*total filament cost\s*=\s*([\d.]+)/i,
  );
  if (costMatch) {
    stats.filamentCost = parseFloat(costMatch[1]);
  }

  const layerMatch = content.match(
    /;\s*total layers count\s*=\s*(\d+)/i,
  );
  if (layerMatch) {
    stats.layerCount = parseInt(layerMatch[1], 10);
  }

  return stats;
}

function parseTimeToSeconds(timeStr: string): number {
  let total = 0;
  const h = timeStr.match(/(\d+)\s*h/);
  const m = timeStr.match(/(\d+)\s*m/);
  const s = timeStr.match(/(\d+)\s*s/);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total;
}
