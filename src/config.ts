import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { PrusaConfig } from "./types.js";

const DEFAULT_INSTALL_PATHS = [
  "C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe",
  "C:\\Program Files (x86)\\Prusa3D\\PrusaSlicer\\prusa-slicer-console.exe",
];

export function detectPrusaSlicerPath(): string | null {
  // 1. Environment variable
  const envPath = process.env.PRUSASLICER_PATH;
  if (envPath) return envPath; // An explicit override must never silently select another binary.

  // 2. Platform-specific install locations
  if (process.platform === "darwin") {
    for (const app of ["/Applications/PrusaSlicer.app", join(homedir(), "Applications/PrusaSlicer.app"), "/Applications/Original Prusa Drivers/PrusaSlicer.app"]) {
      const executable = join(app, "Contents/MacOS/PrusaSlicer");
      if (existsSync(executable)) return executable;
    }
    return null;
  }
  if (process.platform !== "win32") return null;

  // Windows install locations
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
  const override = process.env.PRUSASLICER_PROFILES_DIR;
  if (override) return existsSync(override) ? override : null;
  if (process.platform === "darwin") {
    const dir = join(homedir(), "Library/Application Support/PrusaSlicer");
    return existsSync(dir) ? dir : null;
  }
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

  const trustedScripts = z.record(z.string().min(1)).parse(
    JSON.parse(process.env.PRUSASLICER_TRUSTED_SCRIPTS ?? "{}"),
  );
  return { executablePath, profilesDir, trustedScripts };
}
