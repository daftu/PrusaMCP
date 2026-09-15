import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import type { CliResult } from "./types.js";
import { probeMacCapabilities } from "./macos.js";

export type DiagnosticRunner = (executable: string, args: string[]) => Promise<CliResult>;
export const runDiagnostic: DiagnosticRunner = (executable, args) => new Promise(resolve => {
  execFile(executable, args, { timeout: 10000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    resolve({ exitCode: error ? 1 : 0, stdout, stderr,
      ...(error ? { errorCode: error.killed ? "diagnostic_timeout" : "diagnostic_failed" } : {}) });
  });
});

export interface CliCapabilities {
  state: "available" | "unavailable";
  executable: string | null;
  version: string | null;
  tested_version: boolean;
  technologies: { FFF: boolean; SLA: boolean };
  options: string[];
  actions: string[];
  transforms: string[];
  limitations: string[];
  error_code?: string;
}

function options(text: string): string[] {
  return [...new Set(text.match(/--[a-z][a-z0-9-]*/g) ?? [])].sort();
}

export function parseCliHelp(executable: string, help: string, fff: string, sla: string): CliCapabilities {
  const version = help.match(/PrusaSlicer[- ](\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/)?.[1] ?? null;
  return {
    state: "available", executable, version, tested_version: version === "2.9.6",
    technologies: { FFF: options(help).includes("--help-fff") && options(fff).length > 0,
      SLA: options(help).includes("--help-sla") && options(sla).length > 0 },
    options: options([help, fff, sla].join("\n")),
    actions: options(help.split("Actions:")[1]?.split("Transform options:")[0] ?? ""),
    transforms: options(help.split("Transform options:")[1]?.split("Other options:")[0] ?? ""),
    limitations: ["Help advertises CLI options; it does not verify execution of each operation.",
      ...(version === "2.9.6" ? [] : ["This binary version has not been validated against the 2.9.6 integration contract."])],
  };
}

// One result, keyed by path and binary contents; no results survive a binary change.
export function createCliDetector(runner: DiagnosticRunner = runDiagnostic) {
  let cached: { key: string; value: CliCapabilities } | undefined;
  return async (executable: string): Promise<CliCapabilities> => {
    const unavailable = (code: string): CliCapabilities => ({ state: "unavailable", executable: executable || null,
      version: null, tested_version: false, technologies: { FFF: false, SLA: false }, options: [], actions: [], transforms: [],
      error_code: code, limitations: ["CLI capabilities could not be established."] });
    if (!executable) return unavailable("executable_missing");
    let key: string;
    try {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(executable)) hash.update(chunk);
      key = `${resolve(executable)}:${hash.digest("hex")}`;
    } catch { return unavailable("executable_unavailable"); }
    if (cached?.key === key) return cached.value;
    cached = undefined;
    const help: string[] = [];
    for (const action of ["--help", "--help-fff", "--help-sla"]) {
      const result = await runner(executable, [action]);
      if (result.exitCode !== 0) return unavailable(result.errorCode ?? "diagnostic_failed");
      help.push(result.stdout);
    }
    const value = parseCliHelp(executable, help[0], help[1], help[2]);
    cached = { key, value };
    return value;
  };
}

export const detectCliCapabilities = createCliDetector();
export async function getCapabilities(executable: string) {
  const cli = await detectCliCapabilities(executable);
  return { host: hostname(), platform: process.platform, cli, files: { state: "available" as const,
    limitations: ["Access to an individual file is checked when that file is requested."] }, macos: await probeMacCapabilities() };
}
