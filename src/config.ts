import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { PrusaConfig } from "./types.js";

const DEFAULT_INSTALL_PATHS = [
  "C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe",
  "C:\\Program Files (x86)\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe",
];

export function detectPrusaSlicerPath(): string | null {
  // 1. Environment variable
  const envPath = process.env.PRUSASLICER_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Default install locations
  for (const p of DEFAULT_INSTALL_PATHS) {
    if (existsSync(p)) return p;
  }

  // 3. Try 'where' command on Windows
  try {
    const result = execFileSync("where", ["prusa-slicer-console.exe"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const firstLine = result.trim().split("\n")[0].trim();
    if (firstLine && existsSync(firstLine)) return firstLine;
  } catch {
    // not found on PATH
  }

  return null;
}

export function getProfilesDir(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const dir = join(appData, "PrusaSlicer");
  return existsSync(dir) ? dir : null;
}

export function loadConfig(): PrusaConfig {
  const executablePath = detectPrusaSlicerPath() ?? "";
  const profilesDir = getProfilesDir() ?? "";

  if (!executablePath) {
    console.error(
      "[config] PrusaSlicer not found. Install PrusaSlicer or set PRUSASLICER_PATH env var. " +
      "Slicing tools will not work, but analysis and recommendation tools are still available."
    );
  }

  if (!profilesDir) {
    console.error(
      "[config] PrusaSlicer profiles directory not found. " +
      "Profile listing will not work."
    );
  }

  return { executablePath, profilesDir };
}
