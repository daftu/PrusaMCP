import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { detectCliCapabilities } from "./capabilities.js";
import { fileRevision } from "./contracts.js";
import { runPrusaSlicer } from "./prusa-cli.js";
import { readIni, serializeNativeSettings, omitPrivateSettings } from "./ini-reader.js";
import { assertOutputAvailable, createArtifactStage, publishArtifact, removeArtifactStage } from "./artifacts.js";
import { nativeConfiguration, type NativeProfile } from "./native-config.js";
import { ProfileService, copyProfileData, type PresetReference } from "./profiles.js";
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
  private imported = new Map<string, { reference: PresetReference; bundle: string }>();
  private selectedBundles = new Map<string, { content: string; omitted_fields: string[] }>();
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
      const inputPath = resolve(path);
      const args = isProject ? [inputPath] : ["--load", inputPath];
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
    const importedPrinter = this.imported.get(tuple.printer_profile_id);
    if (importedPrinter) {
      const references = [tuple.printer_profile_id, tuple.print_profile_id, ...tuple.material_profile_ids].map(id => this.imported.get(id));
      if (references.some(item => !item || item.bundle !== importedPrinter.bundle)) throw new Error("incompatible_preset: select profiles from the same imported bundle");
      const [printer, print, ...materials] = references.map(item => item!.reference);
      const technology = printer.technology;
      if (printer.kind !== "printer" || print.kind !== (technology === "FFF" ? "print" : "sla_print") || materials.some(p => p.kind !== (technology === "FFF" ? "filament" : "sla_material"))) throw new Error("incompatible_preset: selected profile kinds do not form a tuple");
      return this.resolveNativeTuple({ printer: printer.name, print: print.name, materials: materials.map(p => p.name) }, overrides, importedPrinter.bundle);
    }
    const printer = this.profiles.getReference(tuple.printer_profile_id);
    const print = this.profiles.getReference(tuple.print_profile_id);
    const materials = tuple.material_profile_ids.map(id => this.profiles.getReference(id));
    const technology = printer.technology;
    if (printer.kind !== "printer" || print.kind !== (technology === "FFF" ? "print" : "sla_print") || !print.compatible_printer_ids.includes(printer.id) ||
      materials.length !== (technology === "FFF" ? printer.extruder_count : 1) || materials.some(material => material.kind !== (technology === "FFF" ? "filament" : "sla_material") || !material.compatible_printer_ids.includes(printer.id) || !material.compatible_print_ids.includes(print.id))) {
      throw new Error("incompatible_preset: select a complete compatible native tuple for every extruder");
    }
    for (const reference of [printer, print, ...materials]) this.profiles.assertUnambiguous(reference);
    if (process.env.PRUSAMCP_NATIVE_CONFIG_PATH) return this.resolveNativeTuple({ printer: printer.name, print: print.name, materials: materials.map(p => p.name) }, overrides);
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

  private async resolveNativeTuple(selection: { printer: string; print: string; materials: string[] }, overrides: Record<string, string>, bundle?: string) {
    if (omitPrivateSettings(overrides).omitted_fields.length) throw new Error("protected_setting: host secrets and scripts cannot be overrides");
    const temporary = await mkdtemp(join(tmpdir(), "prusamcp-native-resolve-"));
    const datadir = bundle ? join(temporary, "data") : await copyProfileData(this.config.profilesDir);
    if (bundle) await mkdir(datadir);
    try {
      const output = join(temporary, "effective.ini");
      const outputBundle = join(temporary, "selected.ini");
      const overridePath = join(temporary, "overrides.ini");
      await writeFile(overridePath, serializeNativeSettings(overrides), { mode: 0o600 });
      const result = await nativeConfiguration({operation: "resolve", datadir, ...(bundle ? {bundle_path: bundle} : {}), selection,
        ...(Object.keys(overrides).length ? {overrides_path: overridePath} : {}), output_flat_path: output, output_bundle_path: outputBundle}, temporary);
      const effective = readIni(await readFile(output, "utf8")).settings;
      const snapshot = this.saveSnapshot(effective, overrides, [{source: "presets", description: "Native selected preset tuple, resolved in isolation. Unsaved GUI state is not included."},
        ...(Object.keys(overrides).length ? [{source: "overrides" as const, description: "Explicit native override layer after selected presets."}] : [])], false);
      snapshot.omitted_fields = [...new Set([...snapshot.omitted_fields, ...result.omitted_fields])].sort();
      snapshot.converted_fields = [...new Set([...snapshot.converted_fields, ...result.substitutions.map(item => item.key)])].sort();
      this.snapshots.set(snapshot.snapshot_id, structuredClone(snapshot));
      this.snapshots.set(snapshot.revision.sha256, structuredClone(snapshot));
      this.selectedBundles.set(snapshot.snapshot_id, {content: await readFile(outputBundle, "utf8"), omitted_fields: result.bundle_omitted_fields});
      return snapshot;
    } finally { await rm(temporary, {recursive: true, force: true}); await rm(datadir, {recursive: true, force: true}); }
  }

  private async importBundle(path: string, workspace_id: string) {
    await this.requireVersion();
    const directory = await mkdtemp(join(tmpdir(), "prusamcp-bundle-"));
    const datadir = await copyProfileData(this.config.profilesDir);
    let retained = false;
    try {
      const bundle = join(directory, "imported.ini");
      const result = await nativeConfiguration({operation: "import", datadir, bundle_path: resolve(path), output_bundle_path: bundle}, directory);
      const profiles = result.profiles.map((profile: NativeProfile): PresetReference => {
        const technology = profile.kind.startsWith("sla_") || profile.settings.printer_technology === "SLA" ? "SLA" : "FFF";
        return {id: createHash("sha256").update(JSON.stringify([workspace_id, directory, profile.kind, profile.name])).digest("hex"),
          kind: profile.kind, name: profile.name, origin: "user", vendor_id: null, directory, technology,
          ...(profile.kind === "printer" ? {extruder_count: technology === "FFF" ? (profile.settings.nozzle_diameter ?? "").split(",").length : 0} : {}),
          compatible_printer_ids: [], compatible_print_ids: []};
      });
      for (const reference of profiles) this.imported.set(reference.id, {reference, bundle});
      retained = true;
      return {workspace_id, format: "bundle" as const, profiles, artifact: {path: bundle, media_type: "text/plain"}, native_validated: true as const,
        omitted_fields: result.omitted_fields, converted_fields: [...new Set(result.substitutions.map(item => item.key))],
        input_diagnostics_known: false, unsupported_fields: [] as string[]};
    } finally { await rm(datadir, {recursive: true, force: true}); if (!retained) await rm(directory, {recursive: true, force: true}); }
  }

  async importConfiguration(path: string, workspace_id: string) {
    const parsed = readIni(await readFile(path, "utf8"));
    if (parsed.format === "bundle") return this.importBundle(path, workspace_id);
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
    const snapshot = this.getSnapshot(snapshot_id);
    const selected = format === "bundle" ? this.selectedBundles.get(snapshot.snapshot_id) : undefined;
    if (format === "bundle" && !selected) throw new Error("bundle_selection_required: resolve an explicit preset tuple with the native bundle backend before exporting its selected presets");
    await assertOutputAvailable(output_path);
    const stage = await createArtifactStage(output_path);
    try {
      await writeFile(stage.path, selected?.content ?? serializeNativeSettings(snapshot.settings), { mode: 0o600 });
      await publishArtifact(stage.path, output_path);
    } finally { await removeArtifactStage(stage.directory); }
    return { artifact: { path: output_path, media_type: "text/plain" }, source_revision: snapshot.revision, format, omitted_fields: [...new Set([...snapshot.omitted_fields, ...(selected?.omitted_fields ?? [])])].sort(), bundle_omitted_fields: selected?.omitted_fields ?? [] };
  }
}
