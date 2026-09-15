import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { detectCliCapabilities } from "./capabilities.js";
import { fileRevision } from "./contracts.js";
import { runPrusaSlicer } from "./prusa-cli.js";
import { readIni, serializeNativeSettings, omitPrivateSettings } from "./ini-reader.js";
import { assertOutputAvailable, createArtifactStage, publishArtifact, removeArtifactStage } from "./artifacts.js";
import { ProfileService, copyProfileData } from "./profiles.js";
import type { PrusaConfig } from "./types.js";

export interface ConfigurationSnapshot {
  snapshot_id: string;
  revision: ReturnType<typeof fileRevision>;
  version: "2.9.6";
  technology: "FFF" | "SLA";
  extruder_count: number;
  settings: Record<string, string>;
  layers: { source: "saved_file" | "presets" | "overrides"; description: string }[];
  omitted_fields: string[];
  unsupported_fields: string[];
  converted_fields: string[];
  input_diagnostics_known: boolean;
}

export class ConfigurationService {
  private snapshots = new Map<string, ConfigurationSnapshot>();
  private workspaces = new Map<string, string>();
  readonly profiles: ProfileService;
  constructor(readonly config: PrusaConfig) { this.profiles = new ProfileService(config); }

  getSnapshot(snapshot_revision: string): ConfigurationSnapshot {
    const snapshot = this.snapshots.get(snapshot_revision);
    if (!snapshot) throw new Error("unknown_snapshot: resolve the configuration in this server session first");
    return structuredClone(snapshot);
  }

  async requireVersion() {
    const capabilities = await detectCliCapabilities(this.config.executablePath);
    if (capabilities.version !== "2.9.6") throw new Error("unsupported_version: configuration operations require verified PrusaSlicer 2.9.6");
  }

  /** Native normalization/validation only: no slicing, GUI, or post-processing. */
  async nativeSave(args: string[], datadir: string): Promise<Record<string, string>> {
    const temporary = await mkdtemp(join(tmpdir(), "prusamcp-config-"));
    try {
      const output = join(temporary, "resolved.ini");
      const result = await runPrusaSlicer(this.config, ["--datadir", datadir, ...args, "--save", output], 30_000);
      // Do not expose native diagnostics: they may contain values from input files.
      if (result.exitCode !== 0) throw new Error(`native_validation_failed: PrusaSlicer rejected configuration (${result.errorCode ?? "process_failed"})`);
      return readIni(await readFile(output, "utf8")).settings;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  async resolveFile(path: string, overrides: Record<string, string> = {}): Promise<ConfigurationSnapshot> {
    await this.requireVersion();
    const temporary = await mkdtemp(join(tmpdir(), "prusamcp-resolve-"));
    try {
      const datadir = join(temporary, "data");
      await mkdir(datadir);
      const isProject = extname(path).toLowerCase() === ".3mf";
      let original: Record<string, string> = {};
      if (!isProject) {
        const parsed = readIni(await readFile(path, "utf8"));
        if (parsed.format !== "flat_ini") throw new Error("bundle_requires_import: import preset bundles before resolving their selected presets");
        original = parsed.settings;
      }
      const args = isProject ? [path] : ["--load", path];
      if (Object.keys(overrides).length) {
        const safe = omitPrivateSettings(overrides);
        if (safe.omitted_fields.length) throw new Error("protected_setting: host secrets and post_process cannot be configuration overrides");
        const overridePath = join(temporary, "overrides.ini");
        await writeFile(overridePath, serializeNativeSettings(overrides), { mode: 0o600 });
        args.push("--load", overridePath);
      }
      const effective = await this.nativeSave(args, datadir);
      return this.saveSnapshot(effective, { ...original, ...overrides }, [
        { source: "saved_file", description: "Configuration read from a saved file; unsaved GUI state is not included." },
        ...(Object.keys(overrides).length ? [{ source: "overrides" as const, description: "Explicit --load layer after the saved base; native CLI post_process policy is applied last." }] : []),
      ], !isProject);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  async resolvePresets(tuple: { printer_profile_id: string; print_profile_id: string; material_profile_ids: string[] }, overrides: Record<string, string> = {}): Promise<ConfigurationSnapshot> {
    await this.requireVersion();
    const printer = this.profiles.getReference(tuple.printer_profile_id);
    const print = this.profiles.getReference(tuple.print_profile_id);
    const materials = tuple.material_profile_ids.map(id => this.profiles.getReference(id));
    const technology = printer.technology;
    if (printer.kind !== "printer" || print.kind !== (technology === "FFF" ? "print" : "sla_print") || !print.compatible_printer_ids.includes(printer.id) ||
      materials.length !== (technology === "FFF" ? printer.extruder_count : 1) || materials.some(material => material.kind !== (technology === "FFF" ? "filament" : "sla_material") || !material.compatible_printer_ids.includes(printer.id) || !material.compatible_print_ids.includes(print.id))) {
      throw new Error("incompatible_preset: select a complete compatible native tuple for every extruder");
    }
    for (const reference of [printer, print, ...materials]) this.profiles.assertUnambiguous(reference);
    const temporary = await copyProfileData(this.config.profilesDir);
    try {
      const args = ["--printer-profile", printer.name, "--print-profile", print.name, "--material-profile", materials.map(material => material.name).join(",")];
      if (Object.keys(overrides).length) {
        if (omitPrivateSettings(overrides).omitted_fields.length) throw new Error("protected_setting: host secrets and post_process cannot be configuration overrides");
        const path = join(temporary, "overrides.ini");
        await writeFile(path, serializeNativeSettings(overrides), { mode: 0o600 });
        args.push("--load", path);
      }
      const effective = await this.nativeSave(args, temporary);
      return this.saveSnapshot(effective, overrides, [{ source: "presets", description: "Native preset tuple; inheritance and compatibility are resolved by PrusaSlicer. Unsaved GUI state is not included." },
        ...(Object.keys(overrides).length ? [{ source: "overrides" as const, description: "Explicit --load overrides take precedence over native presets." }] : [])], false);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  saveSnapshot(effective: Record<string, string>, requested: Record<string, string>, layers: ConfigurationSnapshot["layers"], input_diagnostics_known = true): ConfigurationSnapshot {
    const safe = omitPrivateSettings(effective);
    const requestedSafe = omitPrivateSettings(requested);
    const content = serializeNativeSettings(safe.settings);
    const snapshot: ConfigurationSnapshot = {
      snapshot_id: randomUUID(), revision: fileRevision(content), version: "2.9.6",
      technology: effective.printer_technology === "SLA" ? "SLA" : "FFF",
      extruder_count: effective.printer_technology === "SLA" ? 0 : (effective.nozzle_diameter ?? "").split(",").length,
      settings: safe.settings, layers, input_diagnostics_known,
      omitted_fields: [...new Set([...safe.omitted_fields, ...requestedSafe.omitted_fields])].sort(),
      unsupported_fields: Object.keys(requestedSafe.settings).filter(key => !Object.hasOwn(effective, key)).sort(),
      converted_fields: Object.keys(requestedSafe.settings).filter(key => Object.hasOwn(effective, key) && requestedSafe.settings[key] !== effective[key]).sort(),
    };
    this.snapshots.set(snapshot.snapshot_id, snapshot);
    this.snapshots.set(snapshot.revision.sha256, snapshot);
    return structuredClone(snapshot);
  }

  async validateNative(snapshot: ConfigurationSnapshot, overrides: Record<string, string>): Promise<void> {
    await this.requireVersion();
    const temporary = await mkdtemp(join(tmpdir(), "prusamcp-validate-"));
    try {
      const path = join(temporary, "input.ini");
      const data = join(temporary, "data");
      await mkdir(data);
      await writeFile(path, serializeNativeSettings({ ...snapshot.settings, ...overrides }), { mode: 0o600 });
      await this.nativeSave(["--load", path], data);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }

  async importConfiguration(path: string, workspace_id: string) {
    const parsed = readIni(await readFile(path, "utf8"));
    if (parsed.format === "bundle") throw new Error("blocked_by_capability: stock CLI does not import preset bundles; sparse preset files do not resolve inheritance");
    const snapshot = await this.resolveFile(path);
    let directory = this.workspaces.get(workspace_id);
    if (!directory) {
      directory = await mkdtemp(join(tmpdir(), "prusamcp-workspace-"));
      this.workspaces.set(workspace_id, directory);
    }
    const artifact = await this.exportConfiguration(snapshot.snapshot_id, "flat_ini", join(directory, `${snapshot.snapshot_id}.ini`));
    return { workspace_id, format: "flat_ini" as const, profiles: [], snapshot, artifact: artifact.artifact, native_validated: true as const };
  }

  async exportConfiguration(snapshot_id: string, format: "flat_ini" | "bundle", output_path: string) {
    if (format === "bundle") throw new Error("blocked_by_capability: native flattened selected-preset bundle roundtrip is not verified on stock CLI");
    const snapshot = this.getSnapshot(snapshot_id);
    await assertOutputAvailable(output_path);
    const stage = await createArtifactStage(output_path);
    try {
      await writeFile(stage.path, serializeNativeSettings(snapshot.settings), { mode: 0o600 });
      await publishArtifact(stage.path, output_path);
    } finally { await removeArtifactStage(stage.directory); }
    return { artifact: { path: output_path, media_type: "text/plain" }, source_revision: snapshot.revision, format: "flat_ini" as const, omitted_fields: snapshot.omitted_fields };
  }
}
